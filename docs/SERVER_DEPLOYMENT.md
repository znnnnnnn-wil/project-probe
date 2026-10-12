# 已有服务器的隔离部署准备

## 2026-10-12 订单超时更新

服务器现部署订单超时修复，仍 demo/sandbox。`ORDER_TTL_MINUTES=30` 保存新订单有效期；`PAYMENT_EXPIRY_SYNC_ENABLED=true` 每分钟查询过期订单并仅关闭确认待付款的交易。模板默认关闭外部查询关单，需要在具备对应沙箱或生产账号配置后主动启用。该开关与 `PAYMENT_OPERATIONS_ENABLED` 的现金操作授权分开，后者在当前服务器仍 false。

发布前已备份服务器数据库、旧 JAR 与旧前端入口，存于受保护的 `/opt/project-probe-staging`。V4 迁移在 PostgreSQL 16 成功，已付订单及其权益核验未改变。前端静态资源须允许 Nginx 读取（目录 0755、公开资源文件 0644），服务端环境及密钥保持 0600/0700，不能整体放宽部署目录权限。现有目录挂载的静态资源原位更新，保留旧资源便于恢复。

排查时区分 EXPIRED（本地到期）与 CLOSED（官方确认关闭）；网络失败不得手工改为 CLOSED 或发放权益。多实例依赖数据库条件更新及查询租约，但本次只验证单实例部署。NOT_CREATED 不后台反复轮询，必要时本人查询或等待合法迟到通知。实际关单、生产付款及完整备份还原仍需单独验收。

> 最新状态见文末“HTTPS 与沙箱运行状态”：公网 HTTPS 已启用，自动续期演练通过，服务器为 demo/sandbox。前面各阶段的未部署、未签发与 mock 描述是历史记录。

2026-10-11 已通过本人提供的 root 账号完成只读 SSH 检查，未保存登录密码，未安装软件或修改系统配置。

实际检查：Ubuntu 内核 6.8、Java 17.0.20.1、Docker 29.1.3、Compose 2.40.3；系统报告内存总计 1613 MB、可用约 899 MB，无 swap，根分区剩余约 34 GB。80 端口已有 codex-companion 容器服务，8081 有 Java 服务。不得停止、替换或覆盖这些服务。

## 可审查部署方案

使用独立目录 `/opt/project-probe-staging`（创建前核对是否存在）、独立 Compose 项目 project-probe-staging、独立 PostgreSQL 卷。前端仅监听 127.0.0.1:18088，后端和数据库没有公开端口。部署前检查该端口、项目名、卷及候选 172.30.90.0/24 网段均未被使用；发生冲突先调整，不复用其他服务资源。

本机已经完成 JAR 和 dist 构建，上传发布包而非在服务器编译。使用 deploy/server-compose.yml 和 server-backend.Dockerfile，容器内存上限合计 688 MB，仍需实际运行观察峰值；该限制不是服务器容量通过证明。首次启动会下载基础镜像，需要网络可达。数据库密码在服务器本机随机生成，保存在仅 root 可读的独立 .env，不使用 SSH 密码。

初始部署固定 MODEL_MODE=demo、PAYMENT_MODE=mock，资金操作和定时查询关闭，不上传真实模型密钥、支付私钥或本机用户库。先经 SSH 本地转发访问 http://localhost:18088，验证健康、注册、完整训练、权益与刷新恢复。SSH 转发不能代替支付宝公网回调。

当前没有域名。公开网站和沙箱通知还需要确定可达 HTTPS 入口、证书、来源配置及可信代理，并验证现有 80 端口项目的兼容方案。未获得合适入口前不开放应用端口、不改变现有网站、不宣称公网部署或支付联调完成。域名购买、备案、协议及真实付款由本人办理；本项目不会自动购买。

## 实际状态

- 已完成服务器只读检查及隔离发布文件准备。
- 尚未上传、启动项目容器或修改服务器防火墙。
- 尚未验证最新 V3 在这台 PostgreSQL 的迁移、内存峰值、重启恢复、公网 HTTPS 或支付宝回调。
- 启动失败时保留隔离目录、数据库卷和脱敏日志；不要执行 docker system prune 或删除其他项目数据。

发布包仅包含 app.jar、dist、nginx.conf、部署文件和本说明，不含根 .env、.secrets、数据库、SSH 口令或模型密钥。

## 2026-10-11 实际部署进展（更新）

发布包已上传并通过 SHA256 校验，独立目录已创建。Docker Hub 访问超时，Compose 拉取失败；没有设置未知镜像源。随后使用 Ubuntu 官方源安装 PostgreSQL 16、python3.12-venv，复用已有 Java 17 及服务器上已在使用的 Nginx 镜像。

实际运行：project-probe-backend.service（DynamicUser、448 MB 内存上限）、独立 projectprobe_staging 数据库、project-probe-web 容器（64 MB 内存上限）。Web 采用 host 网络，仅监听 127.0.0.1:18088；后端 127.0.0.1:18089，数据库本机 5432。只信任本机 Nginx 来源，覆盖客户端来源头，不相信外部转发头。数据库密码本机随机生成且文件 0600，未保存 SSH 密码。原 deploy-web-1、deploy-relay-1 及 8081 服务未替换。

健康检查及 demo/mock 配置检查通过。PostgreSQL V1、V2、V3 迁移通过，服务器浏览器 12 项通过；后端重启后再次执行真实训练/复测及手机测试，2 项通过。支付及部分失败状态用例使用合成 API 夹具，不能称为官方沙箱验证。瞬时后端内存约 148 MB、Web 约 3.3 MB，不代表负载容量测试通过。

Certbot 5.4.0 已安装于独立 venv。HTTP-01 使用 acme-hook.py，仅在原 80 端口容器静态目录创建/清理临时验证文件；公网合成响应逐字核对通过，原网站不需要重启。systemd 续期 service/timer 校验通过，timer 已启用，每日两次并增加随机延迟。尚无证书时 ConditionPathExists 使任务跳过，因此目前不能称为实际续期通过。

当前证书协议为 https://letsencrypt.org/documents/LE-SA-v1.8-July-06-2026.pdf，由官方 ACME directory 核实。本人此前要求不代签协议，所以尚未创建 ACME 账号或签发证书。issue-ip-certificate.py 必须看到本人明确接受当前协议的记录才会申请；协议 URL 改变则拒绝继续。签发后执行 activate-ip-https.py，先校验证书 IP、有效期和 Nginx 配置，再仅替换本项目容器，配置 443、HTTPS 来源和 Secure Cookie。

后续必须真实验证公网 TLS、精确回调地址、certbot renew --dry-run --run-deploy-hooks 和证书更新后的 nginx reload。默认仍为 demo/mock；官方 sandbox 尚未启动，支付宝 IP 通知地址接受情况未验证。续期失败可通过 journalctl -u project-probe-cert-renew.service 和独立 acme-logs 排查，尚未配置外部通知告警。

## 2026-10-11 HTTPS 与沙箱运行状态

用户明确接受当前 Let’s Encrypt 订户协议后，已签发公网 IP 短期证书并启用 **https://39.96.27.134**。证书含该 IP，签发者为 Let’s Encrypt YE2；浏览器与 HTTPS 请求使用正常证书验证，没有忽略 TLS 错误。公网 443 由本项目容器监听，内部 18088、后端 18089 仍仅监听本机；原 80 网站、8081 服务保留。

`project-probe-cert-renew.timer` 已启用，每日 00:00、12:00 检查，另有最多 30 分钟随机延迟与漏跑补偿。Certbot 保存了非交互 HTTP-01 钩子，续签后自动执行 `reload-https.sh`，先检查 Nginx 配置再重载证书。实际 `renew --dry-run --run-deploy-hooks` 演练成功，后续 systemd 服务检查 Result=success。通常不需要本人手动续期；尚未经历自然到期后的实际换证，不能将演练写成已完成一次真实自动续签。

首次续期演练因证书机构次级节点访问 80 超时失败；重试通过。演练仍运行时曾有一次定时服务检查遭遇 Certbot 锁，演练结束后重新检查成功。证书与 ACME 配置仅保存在服务器，私钥没有写入网页、聊天或发布包。

运维检查（服务器执行，不输出密钥）：

```bash
systemctl list-timers project-probe-cert-renew.timer
systemctl status project-probe-cert-renew.service
journalctl -u project-probe-cert-renew.service --since '2 days ago'
```

HTTP-01 依赖公网 80 及原 `deploy-web-1` 静态验证目录。更换原网站容器、静态目录或关闭 80 前必须调整 `acme-hook.py` 并重跑续期演练。没有外部续期失败告警，需定期检查日志；服务器与公网 IP 也必须持续有效。`activate-ip-https.py` 仅用于首次激活，续期使用 timer 与 reload 钩子，不重复运行激活脚本。

服务器现在为 **MODEL_MODE=demo / PAYMENT_MODE=sandbox**，本机原模式未改变。服务器使用独立数据库；沙箱应用私钥与支付宝验签公钥通过 systemd LoadCredential 提供给 DynamicUser 服务，源文件目录 0700、文件 0600。通知地址为 `https://39.96.27.134/api/payments/notify`，返回地址为 `https://39.96.27.134/payment-return`。卖家 ID 来自本人提供的同一官方沙箱页面，配置确认不等于独立平台归属认证或正式签约。

公网沙箱准备浏览器检查通过：服务端定价、签名表单、无模拟付款入口及官方查询。实际未提交收银台，官方查询返回交易不存在，订单保持 PENDING/NOT_CREATED。现金操作与定时查询补偿仍关闭；尚未进行沙箱付款、有效通知、已付查询补偿或 production 收款。公网 12 项闭环是在切换沙箱前 demo/mock 下完成，沙箱不能免费发放模拟权益。
