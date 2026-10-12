// 只填写独立支付配置，不输出私钥，不修改当前运行 .env。
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const i = arg.indexOf("=");
    return [arg.slice(2, i), arg.slice(i + 1)];
  }),
);
if (!["sandbox", "production"].includes(args.mode))
  throw new Error("指定 --mode=sandbox 或 production");
const prefix = "ALIPAY_" + args.mode.toUpperCase();
const file = path.join(root, ".secrets/alipay", args.mode, "payment.env");
let profile = await readFile(file, "utf8");
const updates = {};
for (const [flag, name] of [
  ["app-id", "APP_ID"],
  ["seller-id", "SELLER_ID"],
]) {
  if (args[flag] !== undefined) {
    if (!/^\d{10,32}$/.test(args[flag]))
      throw new Error(flag + " 须为官方平台提供的数字标识");
    updates[prefix + "_" + name] = args[flag];
  }
}
if (args["public-base-url"] !== undefined) {
  const u = new URL(args["public-base-url"]);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname !== "/"
  )
    throw new Error("公网地址须为 HTTPS 来源，例如 https://probe.example.com");
  updates[prefix + "_NOTIFY_URL"] = u.origin + "/api/payments/notify";
  updates[prefix + "_RETURN_URL"] = u.origin + "/payment-return";
}
if (args["merchant-confirmed"] !== undefined) {
  if (!["true", "false"].includes(args["merchant-confirmed"]))
    throw new Error("确认字段只能为 true 或 false");
  updates[prefix + "_MERCHANT_CONFIRMED"] = args["merchant-confirmed"];
}
for (const [key, value] of Object.entries(updates)) {
  const pattern = new RegExp("^" + key + "=.*$", "m");
  profile = pattern.test(profile)
    ? profile.replace(pattern, key + "=" + value)
    : profile + "\n" + key + "=" + value;
}
await writeFile(file, profile, { mode: 0o600 });
console.log(
  "独立 " +
    args.mode +
    " 配置已更新；未切换运行模式，未上传密钥，未进行平台认证或交易。",
);
