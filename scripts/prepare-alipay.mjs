// 仅生成本机密钥和独立配置草稿，不上传、不签约、不切换运行模式。
import { generateKeyPairSync } from "node:crypto";
import { mkdir, access, writeFile, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv.find((v) => v.startsWith("--mode="))?.slice(7);
if (!["sandbox", "production"].includes(mode))
  throw new Error("指定 --mode=sandbox 或 --mode=production");
const folder = path.join(root, ".secrets/alipay", mode);
await mkdir(folder, { recursive: true, mode: 0o700 });
if (process.platform === "win32")
  execFileSync(
    "icacls.exe",
    [
      folder,
      "/inheritance:r",
      "/grant:r",
      `${process.env.USERDOMAIN}\\${process.env.USERNAME}:(OI)(CI)F`,
    ],
    { windowsHide: true, stdio: "ignore" },
  );
const privateFile = path.join(folder, "application-private.pem"),
  publicFile = path.join(folder, "application-public.pem");
const exists = async (file) =>
  access(file).then(
    () => true,
    () => false,
  );
if (!(await exists(privateFile)) && !(await exists(publicFile))) {
  const pair = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  await writeFile(privateFile, pair.privateKey, { mode: 0o600, flag: "wx" });
  await writeFile(publicFile, pair.publicKey, { mode: 0o600, flag: "wx" });
} else if (!(await exists(privateFile)) || !(await exists(publicFile)))
  throw new Error("密钥对不完整，拒绝覆盖；请检查本机目录");
const uploadFile = path.join(folder, "application-public-upload.txt");
if (!(await exists(uploadFile)))
  await writeFile(
    uploadFile,
    (await readFile(publicFile, "utf8")).replace(/-----[^-]+-----|\s/g, ""),
    { mode: 0o600, flag: "wx" },
  );
const prefix = "ALIPAY_" + mode.toUpperCase();
const profile = path.join(folder, "payment.env");
if (!(await exists(profile)))
  await writeFile(
    profile,
    [
      "# 接入草稿：只含路径和待填字段，不自动应用到运行配置。",
      "PAYMENT_MODE=" + mode,
      "TRAINING_PRICE_CENTS=990",
      "PAYMENT_RECONCILE_ENABLED=true",
      `${prefix}_APP_ID=`,
      `${prefix}_SELLER_ID=`,
      `${prefix}_PRIVATE_KEY_FILE=${privateFile.replaceAll("\\", "/")}`,
      `${prefix}_PUBLIC_KEY_FILE=${path.join(folder, "alipay-public.pem").replaceAll("\\", "/")}`,
      `${prefix}_NOTIFY_URL=`,
      `${prefix}_RETURN_URL=`,
      `${prefix}_MERCHANT_CONFIRMED=false`,
      "",
    ].join("\n"),
    { mode: 0o600, flag: "wx" },
  );
console.log(
  "本机 " +
    mode +
    " 接入目录已准备：" +
    path.relative(root, folder) +
    "；未上传密钥、未更改运行模式。",
);
console.log(
  "仅将 application-public-upload.txt 填入官方应用公钥；平台返回的支付宝公钥另存 alipay-public.pem。私钥不得上传。",
);
