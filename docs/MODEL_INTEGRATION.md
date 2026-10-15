# 百炼模型配置与联调状态

## 2026-10-15 重置后恢复

新入口为 https://39.96.27.134:18443，重新启用百炼北京接口的 `deepseek-v4.1-flash`，保留免费额度限定确认、40秒超时和不自动切换付费文本模型的策略。用户此前允许语音付费，恢复 `qwen3-asr-flash` 及每账号每日20次限制。模型密钥通过交互输入、加密SSH写入0600服务配置，不写入源码或验收输出。

`.runtime/training-history-acceptance/model-result.json`：两次真实文本模型合成调用通过，第二次携带第一轮合成回答，规范化首题哈希不同，共3053 tokens；没有真实用户材料读取或训练/订单写入。这只是定向检查，不代表普遍语义不重复、剩余额度实时查询或新库付费训练全流程。语音入口及自托管VAD资源已验证，本轮未再次执行付费ASR请求。

## 2026-10-13 线上模型更新

线上已启用 `deepseek-v4.1-flash`，使用 `https://dashscope.aliyuncs.com/compatible-mode/v1`。用户当日截图显示该模型有 1M 免费额度且“用完即停”开启。服务器配置为 `MODEL_MODE=live`、`MODEL_FREE_QUOTA_ONLY=true`，确认模型字段与所选模型一致；额度错误停止请求，不自动切换模型。截图不等于平台实时额度或账单查询。

用户提出的候选 `glm-5.3` 无法关闭思考模式。小型 JSON 探测通过，但业务事实提取在当前 2200 输出 token 上限处截断，因此本次选择同时拥有免费额度的 DeepSeek。官方参数说明：[GLM](https://help.aliyun.com/en/model-studio/glm)、[DeepSeek](https://help.aliyun.com/en/model-studio/deepseek-api)。

隔离验收：`live-model-1791864897062` 的提取、两次追问和复盘成功，复测首题未通过严格校验；`live-model-1791864987790` 恢复首题，但暴露验收脚本未继续回答的遗漏；修复脚本后 `live-model-1791865060526` 完成原训练的复测并记录 PASSED。三个记录的成功模型响应合计 26218 tokens，不含探测、公网验证及 GLM 请求，不能据此推算实时剩余额度。

公网验证记录 `.runtime/server-live-model-20261013.json` 为 PASSED，实际提取出 6 条有效引用的 AI 候选事实。服务器沿用现有后端程序，API Key 仅保存在服务器 0600 配置中。下文为 2026-10-10 的本机 Qwen 配置与历史记录，本次没有修改本机 `.env`。

更新时间：2026-10-10。密钥仅存于本地忽略文件 `.env` 的 MODEL_API_KEY，前端、源码、文档与日志均不包含密钥。密钥已在聊天提供，建议在控制台轮换后更新本地配置。

## 当前选择

选择 `qwen3.8-max-0902`，使用北京兼容接口 `https://dashscope.aliyuncs.com/compatible-mode/v1`。用户提供的控制台截图显示该快照有 1M 剩余额度、到期日 2026-12-01；这是截图时的账户信息，不是程序实时查询结果。官方确认其支持文本和结构化输出，非思考模式可使用 JSON 输出。服务端显式发送 enable_thinking=false，继续执行严格字段、长度、数量与证据引用校验。

官方依据：[模型说明](https://help.aliyun.com/zh/model-studio/qwen3-8-max)、[Chat API](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions/)、[结构化输出](https://docs.modelstudio.console.alibabacloud.com/en/model-studio/qwen-structured-output)。北京旧域名仍可用；迁移业务空间域名时须使用真实空间 ID，不能从密钥猜测。

## 仅使用免费额度

官方[免费额度规则](https://help.aliyun.com/zh/model-studio/new-free-quota)确认：不同模型及快照额度独立，只有北京地域享有免费额度；额度到期/耗尽可能自动转按量付费。控制台开启目标模型“用完即停”并确认生效后，耗尽时返回 403 / AllocationQuota.FreeTierOnly。配置生效存在延迟，应等待后再请求。未发现 Chat API 文档提供请求级 free_tier_only 参数，不添加未经核实的参数。

截图时该开关关闭；随后用户明确确认已开启。已记录当前模型确认，并完成 qwen3.8-max-0902 的真实合成闭环，本地 `.env` 的 MODEL_MODE 已启用 live。模板与无密钥默认仍为 demo。未再次调用 qwen-plus。控制台开关没有通过程序独立查询，确认依据为用户回复。

开启目标模型开关并确认生效后，服务端使用以下非敏感设置：

```dotenv
MODEL_PROVIDER=DashScope
MODEL_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
MODEL_NAME=qwen3.8-max-0902
MODEL_TIMEOUT_SECONDS=40
MODEL_FREE_QUOTA_ONLY=true
MODEL_FREE_QUOTA_CONFIRMED_MODEL=qwen3.8-max-0902
```

MODEL_FREE_QUOTA_CONFIRMED_MODEL 只是操作者的确认记录，**不会设置或验证百炼控制台开关**。后端免费模式仅允许北京接口，live 启动时要求确认字段与当前模型精确匹配；更换模型后需重新确认。实际账单防护仍由百炼开关承担，不能把本地配置宣称为平台零费用保证。达到额度限制后不重试该 403、不切换付费模型，保留回答并进入可恢复失败状态。

确认后先执行 `node scripts/probe-bailian.mjs --free-quota-confirmed`，再执行 `node scripts/verify-live-model.mjs --free-quota-confirmed`。脚本使用全新的本机 18083 服务和 H2 文件库，仅发送合成材料，支付始终 mock；需要 Java JAR 已构建。未提供确认参数或模型确认字段不匹配时，在请求前拒绝运行。若要恢复本脚本生成的失败合成训练，可增加 `--resume=.runtime/live-model-时间戳`，不会新购权益，也不改写原有用户库。联调通过后才能把本地 MODEL_MODE 改为 live。

## 已核实结果与未验证项

- 此前按用户授权对 qwen-plus 进行过真实探测，HTTP 200；两次合成联调中事实提取和两轮相关追问均成功。
- 此前 qwen-plus 的两次复盘均发生两次 HttpTimeoutException，超过原 30 秒单次限制，用户回答保留在隔离库。切换后已恢复其中一条训练及其失败复测报告，仍使用原训练和权益。
- qwen3.8-max-0902 极小探测返回 HTTP 200，679 毫秒、39 tokens。从零合成验收最终通过，记录 `.runtime/live-model-1791627599349/result.json`（PASSED）：事实提取、两次真实追问、深挖报告、修订事实、真实复测首题、重复开始不再次调用、复测追问及报告、完成结果入口。8 次成功响应合计 20343 tokens，成功响应耗时 2.6–34.2 秒；其中一次追问首次超时，第二次成功，超时请求消耗未包含在 usage 合计中。
- 真实校验曾拒绝两次非法证据引用和一次事实提取，均未伪装成成功。已明确事实提取字段及逐字引文要求；报告输入只包含材料和已回答证据，并分配本次请求内的 T1/F1 等短编号。服务器通过确定映射恢复原 ID，未知编号仍拒绝，不做相似匹配；最终证据原文由服务器附加。复测首题明确区分报告建议、用户事实与未实现计划。
- 已将复盘提示压缩为最多三个优先任务，超时可配 5–40 秒，两次请求保留在 90 秒生成租约范围内。最终深挖/复测报告分别约 6.6/7 秒返回，验证了本次合成材料下的调整效果，不代表所有项目的质量与时延保证。
- 成功响应可记录输入/输出 tokens 与耗时，日志不记录请求体、响应全文、Authorization 或密钥。两次失败联调的成功响应记录分别合计 5104、5056 tokens；探测 36 tokens。超时请求可能也消耗额度，因未收到 usage 无法计算，费用和实际免费抵扣以百炼账单为准。
- 本轮其他 qwen3.8-max-0902 调试与恢复的成功响应分别记录 2864、3717、14610、1879 tokens，另有上述最终 20343 tokens 和探测 39 tokens。合计可观察成功响应 43452 tokens，不包含超时响应；免费抵扣和是否存在费用必须以百炼账单为准，未读取账户余额或账单。
- 后续新增职责、验证、异常三份合成项目，完成基线、提示改进及复验；异常复验曾因重复问题失败，原记录恢复完成。语义仅部分达标，近义重复与单题负担仍需改进；本轮成功响应合计 133483 tokens，不包含上述历史记录。结果见 MODEL_QUALITY.md。
- 官方支付沙箱与生产收款仍未联调或启用；多项目评测仅三份固定合成案例，一种恶意 README 未冒认经历，不代表完整提示注入对抗、真实用户材料或生产负载测试通过。

回归测试中的模型调用均为模拟。后端 106 项通过，前端构建与 5 项浏览器回归通过。BailianAdapterTest 和 ModelValidationTest 覆盖参数、额度保护、精简输入，以及证据短编号映射、未知与未回答引用拒绝。真实额度耗尽 403 尚未由平台实际触发，错误处理由合成测试验证。
