import assert from "node:assert/strict";
import { createContext, runInNewContext } from "node:vm";
import test from "node:test";
import {
  apiViewerSource,
  siteContentSecurityPolicy,
  spaViewerSource,
} from "../lib/yohaku-stack.js";

function rewrite(source: string, uri: string): string {
  const event = { request: { uri } };
  runInNewContext(`${source}\nhandler(event);`, createContext({ event }));
  return event.request.uri;
}

test("api prefix is removed before Axum", () => {
  assert.equal(rewrite(apiViewerSource, "/api/health"), "/health");
  assert.equal(rewrite(apiViewerSource, "/api/articles"), "/articles");
  assert.equal(
    rewrite(apiViewerSource, "/api/articles/whitespace-as-product-design"),
    "/articles/whitespace-as-product-design",
  );
});

test("extensionless site paths load the client", () => {
  assert.equal(rewrite(spaViewerSource, "/"), "/index.html");
  assert.equal(
    rewrite(spaViewerSource, "/articles/whitespace-as-product-design"),
    "/index.html",
  );
  assert.equal(rewrite(spaViewerSource, "/assets/index-abc.js"), "/assets/index-abc.js");
  assert.equal(rewrite(spaViewerSource, "/favicon.svg"), "/favicon.svg");
});

test("site CSP allows Google Fonts used by index.html", () => {
  const policy = siteContentSecurityPolicy;
  assert.match(policy, /style-src[^;]*https:\/\/fonts\.googleapis\.com/);
  assert.match(policy, /font-src[^;]*https:\/\/fonts\.gstatic\.com/);
  assert.match(policy, /default-src 'self'/);
});
