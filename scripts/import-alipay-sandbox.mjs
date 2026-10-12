// 本机导入：不接收命令行密钥，不上传，不切换正在运行的支付模式。
import { createPrivateKey, createPublicKey } from "node:crypto";
import { readFile, writeFile, mkdir, realpath, chmod } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const folder = path.join(root, ".secrets/alipay/sandbox");
function invalid() { throw new Error("沙箱配置不完整或密钥校验失败；请使用官方完整配置，不要粘贴 Markdown 示例代码"); }

export function validateSandbox(text) {
  const values = {};
  for (const original of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = original.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(AIPAY_[A-Z_]+)=([^\s]+)$/.exec(line);
    if (!match || Object.hasOwn(values, match[1])) invalid();
    values[match[1]] = match[2];
  }
  if (!/^\d{10,32}$/.test(values.AIPAY_APP_ID || "")) invalid();
  function der(name) {
    const value = values[name];
    if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) invalid();
    const buffer = Buffer.from(value, "base64");
    if (buffer.toString("base64") !== value) invalid();
    return buffer;
  }
  try {
    const privateKey = createPrivateKey({ key: der("AIPAY_PRIVATE_KEY"), type: "pkcs8", format: "der" });
    const applicationKey = createPublicKey({ key: der("AIPAY_PUBLIC_KEY"), type: "spki", format: "der" });
    const alipayKey = createPublicKey({ key: der("AIPAY_ALIPAY_PUBLIC_KEY"), type: "spki", format: "der" });
    for (const key of [privateKey, applicationKey, alipayKey])
      if (key.asymmetricKeyType !== "rsa" || key.asymmetricKeyDetails.modulusLength < 2048) invalid();
    const publicBytes = (key) => key.export({ type: "spki", format: "der" });
    if (!publicBytes(createPublicKey(privateKey)).equals(publicBytes(applicationKey))) invalid();
    if (publicBytes(alipayKey).equals(publicBytes(applicationKey))) invalid();
    return {
      appId: values.AIPAY_APP_ID,
      privatePem: privateKey.export({ type: "pkcs8", format: "pem" }),
      applicationPem: applicationKey.export({ type: "spki", format: "pem" }),
      alipayPem: alipayKey.export({ type: "spki", format: "pem" }),
    };
  } catch { invalid(); }
}

async function secure(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform === "win32") execFileSync("icacls.exe", [directory, "/inheritance:r", "/grant:r", `${process.env.USERDOMAIN}\\${process.env.USERNAME}:(OI)(CI)F`], { windowsHide: true, stdio: "ignore" });
  else await chmod(directory, 0o700);
}

async function main() {
  if (process.argv.length > 2) throw new Error("不要通过命令行传入密钥；输入固定为受保护目录 platform-config.env");
  await secure(folder);
  const source = path.join(folder, "platform-config.env");
  const sourcePath = await realpath(source);
  const parent = await realpath(folder);
  if (path.dirname(sourcePath).toLowerCase() !== parent.toLowerCase()) throw new Error("输入必须位于本机沙箱目录，禁止链接到其他目录");
  if (process.platform === "win32") execFileSync("icacls.exe", [sourcePath, "/inheritance:r", "/grant:r", `${process.env.USERDOMAIN}\\${process.env.USERNAME}:F`], { windowsHide: true, stdio: "ignore" });
  else await chmod(sourcePath, 0o600);
  const data = validateSandbox(await readFile(sourcePath, "utf8"));
  const profilePath = path.join(folder, "payment.env");
  let profile = await readFile(profilePath, "utf8");
  const oldApp = /^ALIPAY_SANDBOX_APP_ID=(.*)$/m.exec(profile)?.[1].trim();
  if (oldApp && oldApp !== data.appId) throw new Error("草稿已有其他应用，拒绝替换；请先核对环境与历史订单");
  if (/^PAYMENT_MODE=(?!sandbox\s*$)/m.test(profile)) throw new Error("不是沙箱草稿，拒绝导入");
  // 新建独立版本，既有本机密钥永不覆盖。
  const destination = path.join(folder, `import-${Date.now()}`);
  await secure(destination);
  for (const [name, value] of [["application-private.pem", data.privatePem], ["application-public.pem", data.applicationPem], ["alipay-public.pem", data.alipayPem]])
    await writeFile(path.join(destination, name), value, { flag: "wx", mode: 0o600 });
  const updates = {
    ALIPAY_SANDBOX_APP_ID: data.appId,
    ALIPAY_SANDBOX_PRIVATE_KEY_FILE: path.join(destination, "application-private.pem").replaceAll("\\", "/"),
    ALIPAY_SANDBOX_PUBLIC_KEY_FILE: path.join(destination, "alipay-public.pem").replaceAll("\\", "/"),
    // 新密钥不能沿用旧的人工账号确认。
    ALIPAY_SANDBOX_MERCHANT_CONFIRMED: "false",
  };
  for (const [name, value] of Object.entries(updates)) {
    const pattern = new RegExp(`^${name}=.*$`, "m");
    profile = pattern.test(profile) ? profile.replace(pattern, `${name}=${value}`) : `${profile}\n${name}=${value}`;
  }
  await writeFile(profilePath, profile, { mode: 0o600 });
  console.log("本机沙箱密钥格式及匹配校验通过；独立草稿已更新。平台绑定、卖家归属和公网通知仍需核验，未切换当前模式、未发起交易。");
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(() => { console.error("导入未完成：检查本机 platform-config.env、沙箱草稿和密钥格式；不会输出密钥或底层错误。"); process.exitCode = 1; });
