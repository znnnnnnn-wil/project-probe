import exampleProjects from "../../backend/src/main/resources/example-projects.json" with { type: "json" };
import type { Project } from "./types";

type Topic = "responsibility" | "implementation" | "problems" | "verification" | "architecture";

const maxReferenceLength = 300;
const oldAcknowledgement = "你好，我们接着聊这道题。你可以从自己负责的部分说起。";
type ExampleExchange = { answer: string; reply: string; referenceAnswer?: string };

export function latestQuestionExchange(exchanges: ExampleExchange[]) {
  for (let index = exchanges.length - 1; index >= 0; index--) {
    const exchange = exchanges[index];
    if (exchange.reply && exchange.reply !== oldAcknowledgement) return exchange;
  }
}

const answers: Record<string, Record<Topic, string>> = {
  booking: {
    responsibility: "我负责预约创建接口、数据库约束和部分集成测试，前端页面由同学完成。",
    implementation: "我给有效预约加座位和时段的联合唯一索引，并发时只允许一条写入。",
    problems: "如果响应丢了，我会用同一个请求编号查上次结果，避免重试时重复预约。",
    verification: "我会用两个请求并发预约同一座位和时段，再查库确认只有一条有效记录。",
    architecture: "固定时段用联合唯一约束，改为任意起止时间后，我会用排他约束防止重叠。",
  },
  rag: {
    responsibility: "我负责讲义切分、检索和引用展示，每个片段都保存文档名和段落编号。",
    implementation: "我把问题转成向量，检索返回相关片段和段落编号，回答按编号引用原文。",
    problems: "我会先检查检索结果的相关性，证据不足就直接说明找不到依据。",
    verification: "我会固定一组问题并标好正确出处，再核对检索是否命中、引用是否正确。",
    architecture: "正确段落被切碎就先改切分，能搜到但排得靠后就先调排序。",
  },
  scheduler: {
    responsibility: "我负责任务领取、调用通知接口和记录结果，只让领到任务的实例发送。",
    implementation: "我用条件更新把任务改成执行中，只有更新成功的实例才会发送。",
    problems: "超时后我会先查发送结果，需要重试时复用同一个幂等键，防止重复通知。",
    verification: "我会让两个实例同时领一条任务，检查只有一个领到，而且只发一次。",
    architecture: "我会给任务领取加租约，过期后由其他实例接手，先查发送结果再重试。",
  },
};

function topicFor(question: string, topic: string): Topic {
  if (/测试输入|怎么测试|如何验证|怎样验证|评测|测试用例|命中率|可观察|预期结果/.test(question)) return "verification";
  if (/取舍|对比|比较.*方案|任意起止|区间重叠|流量增加|先调整/.test(question)) return "architecture";
  if (/超时|重试|故障|进程.{0,8}(退出|中断)|证据不足|拒答|召回错|重复执行/.test(question)) return "problems";
  if (/唯一约束|唯一索引|引用.{0,10}(对应|编号)|检索步骤|条件更新|同时领|具体的请求|处理步骤|如何实现/.test(question)) return "implementation";
  if (/负责|职责|介绍/.test(question)) return "responsibility";
  if (/验证|评估/.test(topic)) return "verification";
  if (/取舍/.test(topic)) return "architecture";
  if (/失败|重试|异常|故障/.test(topic)) return "problems";
  return "implementation";
}

function validLength(value?: string) {
  const text = value?.trim() ?? "";
  return text.length <= maxReferenceLength ? text : "";
}

export function exampleReferenceAnswer(
  project: Project,
  turn: { question: string; topic: string; referenceAnswer?: string },
  exchanges: ExampleExchange[],
) {
  const followUp = latestQuestionExchange(exchanges);
  const question = (followUp?.reply || turn.question).replace(/^你提到“[^”]*”。\s*/, "");
  const generated = validLength(followUp ? followUp.referenceAnswer : turn.referenceAnswer);
  const normalized = (text: string) => text.toLowerCase().replace(/[\p{P}\s]+/gu, "");
  const submitted = new Set(exchanges.map(exchange => normalized(exchange.answer)));
  const available = (text: string) => text && !submitted.has(normalized(text)) ? text : "";
  const example = exampleProjects.find(item => item.project.name === project.name);
  const asksForDdl = /DDL|(?:编写|写出|给出|提供).{0,20}(?:索引语句|SQL|CREATE\s+(?:UNIQUE\s+)?INDEX)|CREATE\s+(?:UNIQUE\s+)?INDEX/i.test(question);
  if (asksForDdl) {
    const needsIndex = /唯一|UNIQUE\s+INDEX/i.test(question + turn.question);
    const needsWhere = /WHERE|部分(?:唯一)?索引/i.test(question + turn.question);
    const indexStatement = /\bCREATE\s+UNIQUE\s+INDEX\b[\s\S]*?\bON\s+\S+\s*\([^)]+\)/i;
    const wherePredicate = /\bWHERE\s+\w/i;
    const complete = (!needsIndex || indexStatement.test(generated)) &&
      (!needsWhere || wherePredicate.test(generated)) && /\bCREATE\b/i.test(generated);
    if (complete && available(generated)) return generated;
    if (example?.id === "booking" && needsIndex && !/排他|EXCLUDE|区间重叠|任意起止/i.test(question) &&
        /预约|座位|时段|唯一约束|唯一索引|部分索引/i.test(question + turn.question)) {
      return available("以预约表和字段名为例：\nCREATE UNIQUE INDEX ON reservations (seat_id, slot_id)\nWHERE status = 'active';");
    }
    return "";
  }
  if (generated && available(generated)) return generated;
  const conflictResponse = /(?:冲突|失败的?请求).{0,12}(?:返回|响应|状态码)|(?:返回|响应).{0,12}冲突/.test(question);
  const constraintError = /唯一(?:约束|索引|键)/.test(question + turn.topic) &&
    /异常|报错|冲突/.test(question) && /捕获|处理|转换|返回|反馈/.test(question);
  if (example?.id === "booking" && (conflictResponse || constraintError)) {
    return available("我会把唯一约束冲突转成 409 响应，提示“该座位已被预约”。");
  }
  if (example?.id === "rag" && followUp &&
      question === "可以用一次具体的请求举例，讲讲你是怎么处理的吗？" &&
      /检索|召回|找原文/.test(followUp.answer)) {
    return available(answers.rag.implementation);
  }
  if (followUp) return "";
  const field = topicFor(question, turn.topic);
  return available(validLength(example && answers[example.id]?.[field]) || validLength(project[field]));
}
