import { App } from "aws-cdk-lib";
import { YohakuStack } from "../lib/yohaku-stack.js";

const app = new App();
new YohakuStack(app, "Yohaku");
app.synth();
