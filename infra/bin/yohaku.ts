import { App } from "aws-cdk-lib";
import { YohakuStack } from "../lib/yohaku-stack.js";

const app = new App();
new YohakuStack(app, "Yohaku", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: "ap-northeast-1",
  },
});
app.synth();
