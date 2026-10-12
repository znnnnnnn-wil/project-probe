# 官方沙箱收银台异常排查（2026-10-11）

> 最新 GET/POST 对照见文末：两种方式均未展示可付款页面，线上继续保留原 POST 实现。

## 当前结论

本人截图与已有合成测试订单均复现：支付宝沙箱收银台返回 HTTP 404。应用网站 HTTPS 正常，订单保持未付款、未发权益。尚未解决此平台页面阻塞，不能宣称沙箱支付联调通过。

实际导航链（未保存签名或临时收银台令牌）：

| 主机 | 路径 | HTTP |
| --- | --- | --- |
| openapi-sandbox.dl.alipaydev.com | /gateway.do | 302 |
| unitradeprod-sandbox.dl.alipaydev.com | /appAssign.htm | 302 |
| excashier-sandbox.dl.alipaydev.com | /standard/auth.htm | 404 |

产品为 AI 网页应用收款，接口 alipay.trade.page.pay，产品码 FAST_INSTANT_TRADE_PAY，金额 9.90 元。应用 ID 9021000169616473。错误时间约 2026-10-11 14:37—14:53（北京时间）。签名表单由官方 Java SDK 4.38.0.ALL 生成，浏览器完整提交 action 查询参数与隐藏字段。接口签名检查、官方查询交易不存在、正常公网 TLS 均已有通过记录；这些不能证明平台产品权限与可付款页面可用。

按官方示例测试 qr_pay_mode=1 后，收银台返回 HTTP 200，但正文为 USER_NOT_LOGIN JSON，并无付款二维码；按 API 文档测试 qr_pay_mode=4 仍返回 404。两次只复用合成账号已有未付款订单，未进行付款。参数调整不能证明修复，已撤回并恢复原服务 JAR。未修改用户订单状态、金额或权益，生产未启用。

## 可提交给官方技术支持的说明

> AI 网页应用收款沙箱，APP_ID=9021000169616473，调用 alipay.trade.page.pay，FAST_INSTANT_TRADE_PAY，9.90 元。2026-10-11 14:37—14:53（北京时间），官方网关 302 → unitradeprod-sandbox 的 /appAssign.htm 302 → excashier-sandbox 的 /standard/auth.htm 404 Whitelabel Error Page。qr_pay_mode=1 返回 USER_NOT_LOGIN JSON，qr_pay_mode=4 仍为 404。请核查该沙箱应用产品权限、交易路由及登录/扫码收银台可用性，告知网页应用收款沙箱支持的付款方式与恢复步骤。尚未付款。

[支付宝技术支持](https://opensupport.alipay.com/support/intelligent-services?form=payskill)。如需具体商户订单号，由本人选择订单提供；不要提交私钥、支付密码、完整签名表单、浏览器 Cookie 或完整 HAR。没有代发送工单、签署协议或修改官方账号设置。

## 验证方法与边界

新增 `frontend/sandbox-tests/cashier-availability.spec.ts`：默认跳过；显式开启且提供已有 sandbox-check- 前缀合成应用账号后，复用页面已有未付款订单检查收银台。拒绝把 HTTP 200 JSON 当成扫码付款页面，不创建订单，不填写支付宝账号或付款密码。

原准备测试仅验证订单、表单与未付款查询，不提交收银台；因此其通过不能发现本次外部跳转异常。收银台检查与准备检查、实际付款、通知/已付查询补偿分别记录，不能互相替代。

官方依据：[AI 网页应用收款指南](https://aipay.alipay.com/docs/vibe-pay/ai-web-app-payment-qianyi/ai-web-app-payment-integration-guide.html)、[page.pay 参数文档](https://developer.alibaba.com/docs/doc.htm?articleId=105901&docType=1&treeId=237)。没有修改固定沙箱网关、切换生产或改用其他收单产品绕过问题。

## SDK GET 与 POST 对照（2026-10-11 15:10—15:12，北京时间）

复用已有合成账号的订单 `43bdfacd-166d-42ad-b848-77c44ac65adb`，商户订单号 **SANDBOX_43bdfacd166d42adb84877c44ac65adb**，金额 9.90 元。由官方 SDK 4.38.0.ALL 的 `pageExecute(request, "GET")` 生成签名 URL，不是手工改签名或替换收银台域名。应用、接口、业务订单、金额、通知和返回地址与服务端 POST 请求逐项匹配。两种请求分别使用新的浏览器会话，无登录支付宝或付款操作。

| 请求时间（北京时间） | 方式 | 实际结果 |
| --- | --- | --- |
| 15:10:38 | POST | 网关及交易分配页 302，收银台 /standard/auth.htm 200；正文 USER_NOT_LOGIN JSON，无二维码 |
| 15:10:58 | GET | 沙箱 /gateway.do 404，没有收银台页面 |
| 15:12:02 | POST | 网关及交易分配页 302，收银台 /standard/auth.htm 404 Whitelabel Error Page |
| 15:12:27 | GET | 网关及交易分配页 302，但限定等待内未到达收银台；最终页面未验证，不把超时写成收银台 404 |

结论：改为 GET 尚未解决问题，响应在不同尝试中发生变化，不能确定为某个固定参数错误或例行维护。线上没有为此变更代码、部署或配置。诊断前后订单数量一致、此订单状态 PENDING。未创建订单、付款、发权益或调用模型。

记录 `.runtime/cashier-get-post-comparison.log` 为第二轮脱敏结果，仅包含主机、路径、HTTP 状态、检查时间和合成商户订单号；首轮结果列于本节。Java 与 Node 诊断程序在 `.runtime` 内，密钥由程序从已授权的受保护沙箱文件读取，没有读取根模型配置。签名 URL、完整表单和 Cookie 不写日志或 trace。初次程序因 SDK 标准输出混有其他内容导致 URL 解析失败，改用内存中的独立编码结果标记后完成检查；初次失败不算 GET 请求证据。

给人工技术支持的最新摘要：

> APP_ID 9021000169616473，AI 网页应用收款沙箱，接口 alipay.trade.page.pay，商户订单号 SANDBOX_43bdfacd166d42adb84877c44ac65adb，金额 9.90 元。2026-10-11 北京时间 15:10—15:12，以官方 Java SDK 4.38.0.ALL 比较 GET/POST，应用、订单、金额及回调参数一致。POST 的 /standard/auth.htm 有时返回 404，有时返回 USER_NOT_LOGIN JSON；GET 首次在 /gateway.do 返回 404，第二次经 /appAssign.htm 跳转后未在等待限时内进入收银台。均无可付款页面，尚未付款。请根据该商户订单号和时间查询沙箱内部日志，确认此应用的网页收款权限、收银台路由与当前维护状态，而非只返回通用排查说明。

“每周日 12:00 至周一 12:00 维护”以及正式日志工具仅支持生产的说法来自本人提供的咨询答复，未取得本次应用的官方日志或维护公告核实，仍作为待确认信息。未根据该说法自动安排复查，也未使用正式小额付款替代验证。
