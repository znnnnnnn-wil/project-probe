import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { validateSandbox } from "./import-alipay-sandbox.mjs";
const pair = () => generateKeyPairSync("rsa", { modulusLength: 2048 });
const app = pair(), platform = pair();
const publicText = (key) => key.export({ type: "spki", format: "der" }).toString("base64");
const fixture = () => ["AIPAY_APP_ID=9021000000000000", `AIPAY_PUBLIC_KEY=${publicText(app.publicKey)}`, `AIPAY_PRIVATE_KEY=${app.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64")}`, `AIPAY_ALIPAY_PUBLIC_KEY=${publicText(platform.publicKey)}`].join("\n");
test("合成 PKCS8 密钥、应用公钥与独立支付宝公钥正确映射", () => {
  const result = validateSandbox(fixture());
  assert.equal(result.appId, "9021000000000000");
  assert.match(result.privatePem, /BEGIN PRIVATE KEY/);
  assert.notEqual(result.applicationPem, result.alipayPem);
});
test("拒绝错配的应用公钥", () => assert.throws(() => validateSandbox(fixture().replace(publicText(app.publicKey), publicText(platform.publicKey)))));
test("拒绝把应用公钥当成支付宝公钥", () => assert.throws(() => validateSandbox(fixture().replace(publicText(platform.publicKey), publicText(app.publicKey)))));
test("拒绝缺字段、重复字段、尾随 Markdown 和污染 Base64", () => {
  for (const input of [fixture().replace(/^AIPAY_APP_ID=.*\n/, ""), fixture() + "\nAIPAY_APP_ID=9021000000000000", fixture() + "**修改网关地址**", fixture().replace("AIPAY_PRIVATE_KEY=", "AIPAY_PRIVATE_KEY=!")]) assert.throws(() => validateSandbox(input));
});
test("拒绝非 Java PKCS1 私钥", () => assert.throws(() => validateSandbox(fixture().replace(app.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"), app.privateKey.export({ type: "pkcs1", format: "der" }).toString("base64")))));
