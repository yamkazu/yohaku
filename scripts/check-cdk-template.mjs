import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const path = process.argv[2];
if (!path) {
  console.error("usage: node scripts/check-cdk-template.mjs <template.json>");
  process.exit(1);
}

const template = JSON.parse(readFileSync(path, "utf8"));
const resources = Object.values(template.Resources);
const byType = (type) => resources.filter((resource) => resource.Type === type);

const tables = byType("AWS::DynamoDB::Table");
if (tables.length !== 1) {
  throw new Error(`expected 1 table, got ${tables.length}`);
}
const tableResource = tables[0];
if (tableResource.DeletionPolicy !== "Retain" || tableResource.UpdateReplacePolicy !== "Retain") {
  throw new Error(
    `table removal ${tableResource.DeletionPolicy}/${tableResource.UpdateReplacePolicy}`,
  );
}
const table = tableResource.Properties;
const keyNames = table.KeySchema.map((key) => `${key.AttributeName}:${key.KeyType}`).sort();
if (keyNames.join(",") !== "pk:HASH,sk:RANGE") {
  throw new Error(`table keys ${keyNames.join(",")}`);
}
if (table.BillingMode !== "PAY_PER_REQUEST") {
  throw new Error(`billing ${table.BillingMode}`);
}
const gsi = table.GlobalSecondaryIndexes?.find((index) => index.IndexName === "gsi1");
if (!gsi || gsi.Projection.ProjectionType !== "ALL") {
  throw new Error("missing gsi1 ALL");
}
const gsiKeys = gsi.KeySchema.map((key) => `${key.AttributeName}:${key.KeyType}`).sort();
if (gsiKeys.join(",") !== "gsi1pk:HASH,gsi1sk:RANGE") {
  throw new Error(`gsi keys ${gsiKeys.join(",")}`);
}

const functions = byType("AWS::Lambda::Function").filter(
  (resource) => resource.Properties.Runtime === "provided.al2023",
);
if (functions.length !== 1) {
  throw new Error(`expected 1 api function, got ${functions.length}`);
}
const api = functions[0].Properties;
if (api.Handler !== "bootstrap") throw new Error(`handler ${api.Handler}`);
if (api.Architectures?.[0] !== "arm64") throw new Error(`arch ${api.Architectures}`);
const env = api.Environment.Variables;
if (env.PORT !== "8080") throw new Error(`PORT ${env.PORT}`);
if (env.AWS_LWA_READINESS_CHECK_PATH !== "/health") {
  throw new Error(`readiness ${env.AWS_LWA_READINESS_CHECK_PATH}`);
}
if (!env.YOHAKU_TABLE) throw new Error("YOHAKU_TABLE missing");
for (const key of [
  "DYNAMODB_ENDPOINT",
  "AWS_ENDPOINT_URL_DYNAMODB",
  "AWS_ENDPOINT_URL",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_LAMBDA_EXEC_WRAPPER",
]) {
  if (key in env) throw new Error(`function env sets ${key}`);
}
const layer = JSON.stringify(api.Layers);
if (!layer.includes("LambdaAdapterLayerArm64:30")) {
  throw new Error(`layer ${layer}`);
}

const urls = byType("AWS::Lambda::Url");
if (urls.length !== 1 || urls[0].Properties.AuthType !== "NONE") {
  throw new Error("function URL auth");
}

const edgeFunctions = byType("AWS::CloudFront::Function");
const edgeCode = edgeFunctions.map((resource) => resource.Properties.FunctionCode).join("\n");
if (!edgeCode.includes("uri.substring(4)")) {
  throw new Error("api viewer does not strip /api");
}
if (!edgeCode.includes('"/index.html"')) {
  throw new Error("spa viewer does not rewrite to index.html");
}

const distributions = byType("AWS::CloudFront::Distribution");
if (distributions.length !== 1) throw new Error("distribution count");
const config = distributions[0].Properties.DistributionConfig;
const behaviors = config.CacheBehaviors ?? [];
const apiBehavior = behaviors.find((behavior) => behavior.PathPattern === "api/*");
if (!apiBehavior) throw new Error("missing api/* behavior");
if (apiBehavior.ViewerProtocolPolicy !== "redirect-to-https") {
  throw new Error("api behavior protocol");
}

const manifest = JSON.parse(readFileSync(join(dirname(path), "manifest.json"), "utf8"));
const environment = manifest.artifacts?.Yohaku?.environment;
if (!/^aws:\/\/(?:unknown-account|\d{12})\/ap-northeast-1$/.test(environment ?? "")) {
  throw new Error(`environment ${environment}`);
}

console.log("template ok");
