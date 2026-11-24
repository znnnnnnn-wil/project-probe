# 项目追问官

帮助准备 Java 后端实习面试的学生，把自己做过的项目讲明白，并应对连续技术追问。

包含任务型工作台、简历导入与项目自动识别、项目材料与事实核对、支持语音转写的逐题深挖、带原文证据的报告、可保存的补充任务与笔记、报告导出、关联复测，以及训练包订单和权益。

公网体验：<https://39.96.27.134:18443>。2026-10-15 重置后已重新部署，运行模式为 **真实 AI（百炼 deepseek-v4.1-flash）+ 支付宝官方沙箱**，不使用真实资金。标准80/443端口继续用于用户的LiveSync，项目使用独立18443端口。未配置环境变量时，本地使用规则演示，并关闭支付。整体改造分析见 [PRODUCT_REVIEW.md](docs/PRODUCT_REVIEW.md)。

重置后原项目目录、数据库和备份未找到，现为新的独立PostgreSQL数据库，不代表恢复了旧账号、订单或问答。多轮历史出题、完整问答记录、简历导入、语音转写及VAD均已发布。服务器旧数据需另有重置前备份才能还原，不能由源码重建。

## 本地运行（Windows）

环境：Java 17、Maven 3.9+、Node 22.12+。当前验证环境为 Java 17.0.14 / Maven 3.9.9 / Node 22.19.0。

在项目根目录打开两个 PowerShell 终端：

```powershell
# 终端一：首次运行自动迁移数据库
./scripts/start-backend.ps1
```

```powershell
# 终端二：首次运行自动安装 npm 依赖
./scripts/start-frontend.ps1
```

访问 **http://localhost:5273/**。请使用 localhost，不要改成 127.0.0.1，默认来源校验绑定前者。后端默认仅监听本机 8180。如本机执行策略阻止脚本，可分别进入 backend 执行 `mvn.cmd spring-boot:run`、进入 frontend 执行 `npm.cmd ci` 和 `npm.cmd run dev`，无需更改系统执行策略。

Linux/macOS：分别在 backend 执行 `mvn spring-boot:run`，在 frontend 执行 `npm ci` 与 `npm run dev`。需要配置时向进程提供环境变量；Spring Boot 不会自动读取根目录 .env，Windows 启动脚本和 Compose 会读取。

无需模型密钥、支付账号或 Docker 即可体验默认流程。H2 文件在 backend/data，停止和重新启动后数据仍在。请勿运行时删除数据库文件。

## 体验路径

- 首页支持免登录合成示例。登录后可新建项目或导入简历，核对材料，进入免费五轮面试室，查看复盘和复测记录。
- 启用支付后，项目档案会提供深挖训练入口。每次新建深挖或专项复测消耗 1 次训练权益，恢复同一条训练不重复扣次。
- 爱猹收的训练包从站内商店进入托管收银台。购买完成后切回站内刷新次数，服务端向平台重新核对权益余额。
- 原支付宝模式继续支持训练包订单、异步验签及查询补偿。已有账户、订单及训练的数据迁移沿用 Flyway，先备份再升级。

## 配置

复制 `.env.example` 为 `.env` 后填写。不要把 `.env`、数据库或密钥提交到仓库。

- 模型：`MODEL_MODE=live`，配置 `MODEL_PROVIDER`、`MODEL_BASE_URL`、`MODEL_NAME`、`MODEL_API_KEY`。适配 OpenAI 兼容 `/chat/completions` JSON 输出接口，要求 HTTPS。不是所有供应商都支持该参数组合，需要实测；不支持时会报错，不静默伪装为 AI 成功。
- 模型请求连接超时 8 秒、单次请求超时默认 30 秒，可用 MODEL_TIMEOUT_SECONDS 在 5–40 秒内配置；仅对瞬时服务错误、连接异常进行至多一次重试。格式或证据不合法时不保存报告，进入可恢复失败状态。
- 线上百炼当前选择 deepseek-v4.1-flash，真实调用先确认控制台“用完即停”生效；本地确认记录不代替平台开关，未确认时保持 demo。原本地 Qwen 配置与历史验收不随线上选择自动改写，详情见 docs/MODEL_INTEGRATION.md。
- 支付：`disabled` 默认关闭；`mock`、`sandbox`、`production` 对应原支付宝模拟、沙箱和正式模式。使用爱猹收时，设 `PAYMENT_MODE=watcha`，填写 `WATCHA_ENVIRONMENT`（`sandbox` 或 `live`），并在服务端提供同一应用、同环境的 `WATCHA_API_KEY` 和 `WATCHA_ENTITLEMENT_ID`。环境名用于隔离本地训练的核销记录，平台实际环境由 Key 和权益 ID 决定。正式签约、商品上架及真实交易需单独验证。
- 事实提取：相同材料和模型复用已保存结果，保留已核对内容；保存新材料后才重新提取。每账号同时最多一次提取，数据库记录 90 秒租约及每 24 小时最多 20 次的调用额度（`EXTRACTION_DAILY_LIMIT`，可配置 1–1000）。失败和材料冲突也计入额度，复用结果不计次数；这不是模型平台的账单上限。
- 语音：`SPEECH_ENABLED=true`，模型固定 `qwen3-asr-flash`；北京地域OpenAI兼容地址通过 `SPEECH_BASE_URL` 设置。密钥可用 `SPEECH_API_KEY` 单独提供，留空时仅在文字模型供应商为DashScope的情况下复用服务端密钥。按用户授权，线上 `SPEECH_PAID_ALLOWED=true`，不改变文字模型免费额度限制。仅免费模式须另设 `SPEECH_FREE_QUOTA_CONFIRMED_MODEL` 并确认平台用完即停。录音为单声道16位PCM WAV，单段0.5–180秒、最大6MB；每账号每24小时默认最多20次（`SPEECH_DAILY_LIMIT`），应用限额不是平台账单上限。
- VAD：浏览器端Silero v5语音活动模型与ONNX Runtime WASM识别语音概率，不再以音量阈值判定说话。确认约400ms语音后，静音约2秒结束；保留300ms前置音频，自动上传检测到的语音段，首段10秒未检测到语音取消、不请求ASR。RMS仅用于音量条。模型与WASM由本站 `/vad/0.0.31-ort1.22/` 提供，首次点击才加载，不把音频发送至VAD外部服务，不新增百炼调用。加载超过15秒、推理错误或积压超过64帧时提示手动结束；取消/离页释放麦克风、模型和音频资源。Vite插件同时提供开发与构建资源，Nginx为mjs/wasm配置正确MIME并仅增加 `wasm-unsafe-eval`，没有开放JavaScript `unsafe-eval` 或外部CDN。依赖固定为 `@ricky0123/vad-web@0.0.31`、`onnxruntime-web@1.22.0`；升级时需同步资源目录和适配器测试。[VAD官方模型说明](https://docs.vad.ricky0123.com/user-guide/models/)、[API及参数](https://docs.vad.ricky0123.com/user-guide/api/)。
- 简历识别：复用现有文字模型，最多提取4个项目。AI识别项目起止行与各字段的原文行号，后端直接提取原文，避免模型复制长文本时改写导致整份失败。背景/职责/架构/实现/问题/验证可选择多行，按原顺序组合；项目范围不允许重叠，字段不允许引用其他项目。名称、技术栈与求职方向仍须有原文依据，空格/换行/制表符差异映射回实际原文，不接受改写数字或补写成果。可选字段无法定位时留空并提示，合法项目仍可导入；全部项目无法定位时拒绝保存并允许重试。简历最多12页/24000字/1000个非空行，DOCX解压内容限制20MB。只做手机号、邮箱、身份证号的基础遮盖，不保证完整脱敏。每账号每24小时最多10次模型识别尝试；上传需登录和同源校验。原简历、录音不保存；简历识别结果在本账号缓存30天，选中经历仍需保存为项目材料，语音需加入回答后提交。
- 简历去重：服务端对解析、基础遮盖后的文字及模型/识别版本计算SHA-256，数据库以账号和摘要作为唯一键。文件改名、BOM及CRLF/LF差异不影响去重；不同格式仅在解析出的文字相同时复用，不保证语义相似或不同排版命中。重复上传返回 `duplicate=true` 和首次 `recognizedAt`，不请求模型、不增加识别次数。失败不缓存，内容、模型或规则版本变化和30天过期后重新识别。用户行锁、90秒租约及令牌校验保护跨实例领取和缓存提交；旧执行器不能写入缓存。每小时清理过期记录，首次上传的识别结果不会随重复上传延长有效期。当前识别版本为 `resume-v2-source-lines`，首次上传会重新识别，不复用旧逐字复制模式的缓存。哈希是去重依据，不代表完整脱敏。
- 身份：随机会话令牌、数据库存储其 SHA-256 摘要，HttpOnly/SameSite=Strict cookie；密码 BCrypt。所有项目、训练、订单按登录用户归属读取和修改。

## 构建与验证

```powershell
cd backend
mvn.cmd package
```

```powershell
cd frontend
npm.cmd ci
npm.cmd run build
# 已构建后端 JAR 且本机安装 Edge 时；自动启动隔离测试服务
npm.cmd run test:e2e
```

后端产物 `backend/target/project-probe-1.0.0.jar`，前端 `frontend/dist`。测试细节与限制见 docs/VERIFICATION.md。

Docker 可用时，可从根目录运行 `node scripts/verify-deployment.mjs`，在全新 PostgreSQL + Nginx 环境执行后端、浏览器、重启恢复和代理限流验收；需要本机 Edge、空闲 18088/15439 端口及 172.30.189.0/24 网络。脚本生成合成配置、固定演示模型与模拟支付，结束后停止测试容器并保留隔离卷和日志。详见 docs/DEPLOYMENT.md。

浏览器测试独占 5174 / 18082 端口，自动使用全新 H2 内存数据库和演示模型，不读取根目录 `.env`，不复用已运行的用户服务。请保持这两个端口空闲。真实模型分支测试通过覆盖模型调用返回合成输出，不请求外部模型。

报告严格要求显式的 `clearParts`、`findings`、`retestTopics` 数组，合法空数组可通过；缺字段、类型错误、超长内容或非法引用会进入可恢复失败状态。模型问题必须包含 `question` 和 `topic`，复测首题还需要出现在问题原文中的 `changedCondition`。首题失败时仍保存训练记录，可以从“继续复测”重试或按故障规则返还；完成后入口变为“查看复测结果”。

## 目录

- backend：Spring Boot 单体、Flyway 迁移、交易/模型服务与集成测试。
- frontend：React + TypeScript 页面、响应式样式、Playwright 流程验收；合成示例定义在 src/api.ts。
- demo/project.json：独立合成演示材料；也可设置 DEMO_USERNAME/DEMO_PASSWORD 后运行 `node scripts/seed-demo.mjs`，仅允许本机演示环境，不输出密码。
- docs/PLAN.md：产品开发方案与验收标准。
- docs/PAYMENT.md：官方依据、沙箱接入与生产待办。
- docs/DEPLOYMENT.md：PostgreSQL、Docker Compose、上线准备。
- docs/SUBMISSION.md：作品介绍与约三分钟演示脚本。
- docs/MODEL_QUALITY.md：三类合成项目的真实模型质量发现、改进与剩余问题；免费额度确认后可运行 `node scripts/verify-model-quality.mjs --free-quota-confirmed`，自动检查不能替代语义复核。

没有真实收入、用户增长或获奖数据。百炼 qwen3.8-max-0902 已在用户确认用完即停后通过合成项目的真实模型闭环，本地私有配置启用 live，模板默认仍为 demo；详情见 docs/MODEL_INTEGRATION.md。PostgreSQL/Nginx 本地隔离验收及公网 HTTPS 演示部署已有记录，官方沙箱已有一次实际付款及通知确认；重复真实通知、丢失通知补偿、现金退款与生产实际收款仍待验收，见 docs/VERIFICATION.md。不能将沙箱记录作为真实收入或生产收款验证。
