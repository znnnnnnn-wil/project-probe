# 本地与部署说明

## PostgreSQL + Compose

已提供 PostgreSQL 17、后端和 Nginx 前端容器。启动前安装并运行 Docker Engine / Docker Desktop。

1. 复制 `.env.example` 为 `.env`。
2. 修改 `POSTGRES_PASSWORD` 为独立随机密码，设置 `APP_ORIGIN=http://localhost:8088`。本地 HTTP 保持 `SECURE_COOKIE=false`、`PAYMENT_MODE=mock`；真实支付的分环境配置见 PAYMENT.md。
3. 在根目录运行 `docker compose up --build -d`。
4. 打开 `http://localhost:8088`。Compose 仅将前端绑定本机，数据库及后端不对外暴露。Flyway 自动迁移。
5. 用 `docker compose logs --tail=100 backend` 查看启动状态。不要打开请求体日志。停止使用 `docker compose down`，不要附带 `-v`，以免删除数据库卷。

2026-10-10 Docker 引擎可用，已在独立 Compose 项目完成 PostgreSQL 17、后端与 Nginx 镜像构建及验收，详见 VERIFICATION.md。此前 Docker Desktop 曾出现 Inference manager 初始化异常；本次没有重置 Docker 或修改系统配置。验收只使用演示模型和模拟支付，不代表生产模型、真实收款或公网部署已验证。

## 独立部署

前端 `npm ci && npm run build`，将 dist 放到静态服务器；`/api` 反向代理到后端。后端 `mvn package` 后运行 `java -jar target/project-probe-1.0.0.jar`，设置 DB_URL/DB_USER/DB_PASSWORD。前后端必须同源，浏览器不直连模型或支付 API。生产配置 PostgreSQL，不使用本地 H2。

公开部署前准备 HTTPS 证书和域名，将 APP_ORIGIN 配成精确的 HTTPS 来源、SECURE_COOKIE=true；配置反向代理、请求限制、备份和监控。2026-10-11 已有公网 HTTPS 演示部署记录，2026-10-12 已有一次沙箱付款及通知确认，详情见 SERVER_DEPLOYMENT.md 与 VERIFICATION.md；生产实际收款仍未验证。

## 可信代理与认证限流

后端保留每个客户端每分钟 20 次登录/注册请求的共享额度；退出登录不占用该额度，仍执行来源与会话处理。计数包括成功和失败请求，超限返回 429 和 `Retry-After`。

直连后端时 `TRUSTED_PROXY_ADDRESSES` 留空，使用 TCP 来源地址。`server.forward-headers-strategy=none` 禁止 Spring 自动按转发头改写来源；客户端自行发送 `X-Forwarded-For`、`Forwarded`、`X-Real-IP` 或 `X-Probe-Client-IP` 均不能改变直连限流键。不要另行启用容器的 RemoteIpValve 或转发头过滤器。

Compose 给 web 分配专用网络固定地址 `172.30.88.10`，后端仅信任该精确地址。Nginx 将 `X-Probe-Client-IP` **覆盖**为自己看到的 `$remote_addr`，清除常见转发头；后端只在直接连接方命中精确 IP 白名单时读取该单值合法 IP。可信代理缺头、多个值或非法值会被拒绝。配置允许逗号分隔的精确 IPv4/IPv6 地址，不接受网段或主机名。

如网络与本机/VPN 冲突，在 `.env` 调整 `PROXY_NETWORK_PREFIX`（例如 `172.30.89`）；Compose 会同步专用 `/24` 子网、web 的 `.10` 和后端白名单。独立 Nginx 部署须使用 frontend/nginx.conf 中的覆盖规则，并将 `TRUSTED_PROXY_ADDRESSES` 设置为后端实际看到的 Nginx 地址。只有受控代理可占用该地址，后端端口应隔离，不能把普通访客可直连的来源加入信任列表。

当前配置针对**客户端直接连接这一层 Nginx、单后端实例**。增加 CDN、负载均衡或其他代理后，不能直接启用客户端转发头：先配置入口代理对明确的上游地址使用可信 real-IP 规则、覆盖内部头，再重新验收来源隔离。本次使用两个固定且不同 IP 的 Docker 网络客户端，通过真实 Nginx 验证额度独立及头部覆盖。经 Docker Desktop 发布端口访问的多个外部设备仍可能因 NAT 合并地址，公网/宿主机入口须单独验收，不能用本次内部网络测试替代。

## 一键隔离部署验收

安装 Docker、Java 17、Maven、Node.js 和本机 Edge，在 frontend 执行一次 `npm ci`，再从项目根目录运行：

```powershell
node scripts/verify-deployment.mjs
```

脚本使用新的 `probe-acceptance-时间戳` 项目、独立 PostgreSQL 卷及 regression 测试库，自动生成 `.runtime/deployment-时间戳` 中的合成配置。固定使用网页 18088、PostgreSQL 15439（均仅本机发布）和 `172.30.189.0/24` 验收网络；端口或网络被占用时停止，不复用已有数据库。Compose 的 `APP_ENV_FILE` 与 `WEB_PORT` 可配置，普通部署默认仍为 `.env` 与 8088；验收脚本显式指定合成文件并检查路径，不使用根目录 `.env`。

它实际执行镜像构建、nginx -t、PostgreSQL 后端回归、浏览器闭环与支付回归、并发模拟支付、后端/数据库重启恢复，以及独立网络客户端的限流与伪造头测试。实际数量与版本以 VERIFICATION.md 为准；支付真实环境的浏览器场景使用合成响应，不能当作官方付款验证。Windows Maven/npm 命令通过固定命令启动；不将密钥拼入命令，不输出配置。后端 Docker 构建缓存 Maven 依赖，使用正常 package，不预下载非运行必需插件依赖。

结束后自动 `down` 停止并移除本次容器/网络，**不删除数据库卷**；日志和 result.json 保留在对应隔离目录。result.json 的 status 必须为 PASSED；失败记录不能视作验收通过。保留卷只含合成数据，需要清理时先按记录核对项目名与卷名，不能对所有 Docker 数据执行全局清理。浏览器首题失败/返还界面仍使用合成响应夹具，真实事务失败恢复由 PostgreSQL 后端测试覆盖。

认证计数保存在单 JVM 内存，重启会重置。多实例会分别拥有额度，不构成全局 20 次限制；部署多个后端前需在可信入口实施共享限流或加入原子分布式计数，并验证同一客户端跨实例无法绕过。当前没有宣称多实例全局防暴力保障。

## 数据与备份

迁移位于 backend/src/main/resources/db/migration。项目材料版本存入 project_revisions，训练 body 保存不可变材料快照、问答和报告；订单及权益有独立关系表、唯一约束和流水。JSON 文本用于首版结构灵活性，不承担资金金额计算。

开发 H2：停止后端后备份 backend/data。PostgreSQL：使用 `pg_dump` 备份，并在独立库演练还原。不要将备份提交到代码仓库。H2 演示数据不会自动迁移到生产库。

会话七天有效。首版注册账号，无邮箱验证、找回密码、管理后台或自动数据删除 UI；公开上线前补足账号滥用限制、隐私政策、数据删除及保留策略。当前应用有单进程登录频率限制，但分布式限流、计费额度限制和安全监控需另行补齐。

## 发布验收

- 确认模型状态，使用脱敏材料实际验证模型提取/追问/报告输出。不要将规则演示标为 AI 评估。
- 在 PostgreSQL 实库运行隔离、并发权益、重复支付回调及重启恢复验收。
- 在部署域名验证 cookie、来源检查、反向代理超时、手机页面及 HTTPS。
- 支付官方沙箱联调和真实收款资格确认参见 PAYMENT.md。
- 已实现生产支付配置与账号隔离、通知校验和有界主动查询补偿；当前仍为 mock，正式平台资格与交易未验证。真实退款、关单、完整财务对账与运营管理需补齐后再开放真实付费。

## 支付环境与公网回调（2026-10-10）

mock / sandbox / production 采用独立配置。Compose 默认仅挂载 mock 空目录；实际支付需 `ALIPAY_KEY_DIRECTORY` 指向一个环境目录、只读挂载到 `/run/secrets/alipay`，容器密钥路径不含 sandbox/production 子目录。按 PAYMENT.md 填写对应前缀，禁止挂载两种环境全部密钥。生产和沙箱使用不同 Compose 项目名、配置文件与数据库卷。

提供 `deploy/nginx-https.conf.example` 外层 TLS 模板和 `nginx-internal-https.conf.example` 内层可信来源模板。替换域名、证书、经实际确认的外层 TCP 来源 IP，执行 nginx -t 后才部署。不能填 0.0.0.0/0 或直接相信访客的转发头；仅部署外层而不配置内层 real_ip 会造成认证共享额度。默认 Compose 本机模式继续使用原 nginx.conf，不自动加入新代理信任。

对外 URL：`https://你的域名/api/payments/notify` 直达后端，返回页 `https://你的域名/payment-return` 走 SPA。回调不得经过登录、验证码、重定向或响应改写，POST 表单验签后返回纯文本 success/failure；浏览器无法利用返回参数确认付款。设置 APP_ORIGIN 为精确同源 HTTPS 来源、SECURE_COOKIE=true。没有公网域名/证书和本人授权时，不建立隧道或公开发布。

本轮本机隔离 Compose 已重新通过，但这两份 HTTPS 模板仅完成准备，公网来源、证书与支付宝回调未实际验证。正式支付支持是代码能力，不等同于正式签约或可上线。完整平台配置、密钥生成和沙箱验收见 PAYMENT.md。

容器后端以 UID 10001 运行。Linux 部署时仅给该服务用户读取所选环境密钥目录的权限：目录 0700、密钥文件 0600，owner 为 10001；不要用 chmod 777、不要把私钥放入镜像或网页 dist。应在独立部署目录设置权限，本机现有密钥不作自动改权或复制。Windows Docker bind mount 权限需在真实沙箱配置后验证；本轮 mock 容器不读取密钥。隔离部署验收脚本显式挂载自己的空目录，不能继承真实密钥目录。
