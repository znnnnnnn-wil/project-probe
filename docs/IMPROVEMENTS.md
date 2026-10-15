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

## 验收

隔离PostgreSQL共222项测试：221通过、1项可选私人DOCX夹具跳过。独立Nginx部署55项浏览器通过；13张业务表备份还原到新库，数量及训练报告原文摘要一致；重启恢复、并发模拟支付幂等、代理限流通过。记录 `.runtime/deployment-1792074853227/result.json`。

真实文本模型使用本机已确认用完即停的 `qwen3.8-max-0902`，三类合成案例先后完成，部分需要故障恢复。8份初次/恢复记录共55次成功响应、159321 tokens；不含失败请求缺失usage的用量，不代表平台账单或真实用户效果。

人工发现重复实现追问后增加常见目标分类：保留一次澄清机会，第三次同目标需明确新条件；不是完整语义判定。模型输出不合法时最多修复一次，总预算80秒，仍失败则保留训练供恢复。最新验证类案例在原失败训练恢复，复测围绕查询实现；早期失败未改写成一次通过。

## 发布边界

源码合并不自动更新公网应用。公网仍是此前的live/sandbox部署，线上 `deepseek-v4.1-flash` 尚未针对本轮规则重验。生产容量、运营账户/单价配置、备份timer实际安装、真实用户效果与正式收款仍不能宣称完成。
按 [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) 发布固定提交；不直接覆盖现有数据库，不把沙箱/体验记录作为收入。
