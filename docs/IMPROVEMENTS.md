# 训练体验改进

本轮围绕复盘材料衔接、主题复测、回答对照、追问覆盖、纠错、训练模式、首访、草稿、账户与统计逐项实现。
每个 PR 的新增与删除行数合计不超过 500；正式收款接入保持暂停。

真实模型质量、生产容量和备份恢复需要独立实测，不能以合成测试代替。

## 实现与PR

| PR | 改进 |
|---|---|
| [51](https://github.com/znnnnnnn-wil/project-probe/pull/51) | 选择报告主题、多次关联复测、幂等扣次 |
| [52](https://github.com/znnnnnnn-wil/project-probe/pull/52) | 笔记预览确认入材料、主题状态与历史入口 |
| [53](https://github.com/znnnnnnn-wil/project-probe/pull/53) | 有两轮原回答引用的复测比较 |
| [54](https://github.com/znnnnnnn-wil/project-probe/pull/54) | 快速/标准训练、追问侧重、覆盖摘要 |
| [55](https://github.com/znnnnnnn-wil/project-probe/pull/55) | 不会、澄清、纠正假设、问题反馈 |
| [56](https://github.com/znnnnnnn-wil/project-probe/pull/56) | 服务端草稿、跨设备恢复、版本冲突保护 |
| [57](https://github.com/znnnnnnn-wil/project-probe/pull/57) | 一次性恢复码与改密撤销会话 |
| [58](https://github.com/znnnnnnn-wil/project-probe/pull/58) | 公开隐私说明、缓存/项目清理与注销 |
| [59](https://github.com/znnnnnnn-wil/project-probe/pull/59) | 必要材料先填、独立一题体验，不生成付费证据 |
| [60](https://github.com/znnnnnnn-wil/project-probe/pull/60) | 环境隔离统计、成功文本调用计量与单价未知状态 |
| [61](https://github.com/znnnnnnn-wil/project-probe/pull/61) | 站内反馈、运营回复与请求编号 |
| [62](https://github.com/znnnnnnn-wil/project-probe/pull/62) | 回归修复、有限输出修复、备份恢复与发布清单 |
| [63–64](https://github.com/znnnnnnn-wil/project-probe/pull/64) | 宽幅编辑布局、独立体验区与手机适配 |
| [65](https://github.com/znnnnnnn-wil/project-probe/pull/65) | 自定义训练选择控件与键盘操作 |
| [66](https://github.com/znnnnnnn-wil/project-probe/pull/66) | 体验草稿恢复、读取失败提示、生成只读轮询 |
| [67](https://github.com/znnnnnnn-wil/project-probe/pull/67) | 体验回答预览入材料、可选材料收起与下一步指引 |
| [68](https://github.com/znnnnnnn-wil/project-probe/pull/68) | 限制复合问题、引用支持说明与优先补充任务 |
| [69](https://github.com/znnnnnnn-wil/project-probe/pull/69) | 环境隔离阶段事件、模型HTTP尝试与失败耗时统计 |
| [71](https://github.com/znnnnnnn-wil/project-probe/pull/71) | 统一用户选择控件、自愿体验调研 |
| [72](https://github.com/znnnnnnn-wil/project-probe/pull/72) | 按用户要求撤回尚未发布的运营工作台，不配置运营权限 |
| [73](https://github.com/znnnnnnn-wil/project-probe/pull/73) | 首次材料填写参考与示例覆盖确认 |
| [74](https://github.com/znnnnnnn-wil/project-probe/pull/74) | 区分复测表达补充与执行验证，修复默认值误触发确认 |
| [75](https://github.com/znnnnnnn-wil/project-probe/pull/75) | 独立PostgreSQL和浏览器自动回归 |

## 验收

2026-10-15验收：隔离PostgreSQL共222项测试，221通过、1项可选私人DOCX夹具跳过；独立Nginx部署55项浏览器通过。记录 `.runtime/deployment-1792074853227/result.json`。

2026-10-16验收：隔离PostgreSQL共228项测试，227通过、1项可选私人DOCX夹具跳过；独立Nginx部署59项浏览器全部通过。13张业务表备份还原到新库，数量及训练报告原文摘要一致；重启恢复、8次并发模拟支付幂等、代理限流通过。记录 `.runtime/deployment-1792157808366/result.json`。本机浏览器首轮58/59，发现默认岗位导致示例确认后已修复，相关5项复验和随后独立部署59项通过，未掩盖首轮失败。

历史合成评测使用本机已确认用完即停的 `qwen3.8-max-0902`，三类合成案例先后完成，部分需要故障恢复。8份初次/恢复记录共55次成功响应、159321 tokens；不含失败请求缺失usage的用量，不代表平台账单或真实用户效果。

人工发现重复实现追问后增加常见目标分类：保留一次澄清机会，第三次同目标需明确新条件；不是完整语义判定。模型输出不合法时最多修复一次，总预算80秒，仍失败则保留训练供恢复。最新验证类案例在原失败训练恢复，复测围绕查询实现；早期失败未改写成一次通过。

## 发布边界

2026-10-17已发布固定提交 `88ea3943e50e81a6b52e29199abfd1a08a7df90e`，公网仍为live/sandbox，Flyway已迁移至V16。发布前整库备份已完整还原至独立库并逐表核对，旧订单与权益字段摘要不变；应用配置和同机三个容器启动时间不变，每日备份timer启用且运行成功。公网真实一题体验、刷新草稿、回答预览入材料、自愿调研及合成账号注销通过；四屏宽×三体验状态12项检查通过。
线上所用 `deepseek-v4.1-flash` 已在同机独立H2库完成本轮合成案例复验，支付mock、不连接生产数据库。首轮9个成功响应31671 tokens，人工发现比较误判与矛盾假设；修改后同案例8个响应25881 tokens，比较正确标记PARTIAL并区分新增计划与执行证据，合计57552 tokens。结果不代表平台账单或真实用户效果。详见 [MODEL_QUALITY.md](MODEL_QUALITY.md)。
生产容量、模型普遍稳定性、真实付费用户和正式收款仍未证明；运营工作台按要求暂停，未给ssm配置权限，单价未知时不输出虚假成本。
阶段事件仅统计各阶段独立用户和次数，不等于连续转化率；体验调研是用户自报，不是成交或能力提升证明。一题体验草稿仅在当前标签页恢复，不能宣称跨设备同步。
按 [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) 发布固定提交；不直接覆盖现有数据库，不把沙箱/体验记录作为收入。

2026-10-17最终GitHub Linux自动检查通过：后端227通过、1项可选夹具跳过；60项浏览器通过。先前Linux语音夹具依赖、退出导航迟到覆盖及清理检查时序失败均保留并已修复，不以首次全部通过描述。本轮PR71–75新增与删除总和分别为135、464、39、7、119行，均不超过500。
