import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Aws, CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import type { Construct } from "constructs";

const repoRoot = join(import.meta.dirname, "../..");

export const apiViewerSource = `function handler(event) {
  var uri = event.request.uri;
  if (uri === "/api") {
    event.request.uri = "/";
  } else if (uri.indexOf("/api/") === 0) {
    event.request.uri = uri.substring(4);
  }
  return event.request;
}
`;

export const spaViewerSource = `function handler(event) {
  var uri = event.request.uri;
  if (uri.charAt(uri.length - 1) === "/") {
    event.request.uri = "/index.html";
  } else if (uri.indexOf(".") === -1) {
    event.request.uri = "/index.html";
  }
  return event.request;
}
`;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...walk(path));
    } else {
      out.push(path);
    }
  }
  return out;
}

function assertWebDist(dir: string) {
  const files = walk(dir);
  if (!files.some((path) => path.endsWith("/index.html") || path.endsWith("\\index.html"))) {
    throw new Error(`missing index.html in ${dir}. Run scripts/build-web-deploy.sh`);
  }
  const text = files
    .filter((path) => path.endsWith(".js") || path.endsWith(".html") || path.endsWith(".css"))
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  if (text.includes("127.0.0.1:3848")) {
    throw new Error("web/dist still calls 127.0.0.1:3848. Run scripts/build-web-deploy.sh");
  }
  if (!text.includes("/api")) {
    throw new Error("web/dist does not call /api. Run scripts/build-web-deploy.sh");
  }
}

function assertBootstrap(dir: string) {
  const bootstrap = join(dir, "bootstrap");
  if (!statSync(bootstrap, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`missing ${bootstrap}. Run scripts/build-lambda.sh`);
  }
}

export class YohakuStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const webDist = join(repoRoot, "web/dist");
    const bootstrapDir = join(repoRoot, "api/target/lambda/yohaku-api");
    assertWebDist(webDist);
    assertBootstrap(bootstrapDir);

    const table = new dynamodb.Table(this, "Articles", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    table.addGlobalSecondaryIndex({
      indexName: "gsi1",
      partitionKey: { name: "gsi1pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "gsi1sk", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const api = new lambda.Function(this, "Api", {
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.ARM_64,
      handler: "bootstrap",
      code: lambda.Code.fromAsset(bootstrapDir),
      memorySize: 512,
      timeout: Duration.seconds(30),
      environment: {
        PORT: "8080",
        AWS_LWA_READINESS_CHECK_PATH: "/health",
        YOHAKU_TABLE: table.tableName,
      },
      layers: [
        lambda.LayerVersion.fromLayerVersionArn(
          this,
          "LambdaWebAdapter",
          `arn:aws:lambda:${Aws.REGION}:753240598075:layer:LambdaAdapterLayerArm64:30`,
        ),
      ],
    });
    table.grantReadWriteData(api);

    const functionUrl = api.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });

    const siteBucket = new s3.Bucket(this, "Web", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const apiViewer = new cloudfront.Function(this, "ApiPrefix", {
      code: cloudfront.FunctionCode.fromInline(apiViewerSource),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    });
    const spaViewer = new cloudfront.Function(this, "SpaFallback", {
      code: cloudfront.FunctionCode.fromInline(spaViewerSource),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    });

    const distribution = new cloudfront.Distribution(this, "Site", {
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        functionAssociations: [
          {
            function: spaViewer,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
      additionalBehaviors: {
        "api/*": {
          origin: new origins.FunctionUrlOrigin(functionUrl),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          functionAssociations: [
            {
              function: apiViewer,
              eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
            },
          ],
        },
      },
    });

    new s3deploy.BucketDeployment(this, "DeployWeb", {
      sources: [s3deploy.Source.asset(webDist)],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ["/*"],
    });

    new CfnOutput(this, "SiteUrl", {
      value: `https://${distribution.distributionDomainName}`,
    });
  }
}
