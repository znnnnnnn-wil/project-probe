type Detail = "约束" | "冲突响应" | "测试输入" | "预期结果";

const signals: [Detail, RegExp][] = [
  ["约束", /唯一(?:约束|索引)|unique\s*(?:constraint|index)?/i],
  ["冲突响应", /(?:返回|响应|提示).{0,10}(?:409|冲突|已被预约|已占用)|(?:409|冲突码|已被预约|已占用).{0,10}(?:返回|响应|提示)/i],
  ["测试输入", /(?:并发|同时).{0,18}(?:同一|同个|同一个).{0,8}(?:座位|时段)|(?:同一|同个|同一个).{0,10}(?:座位|时段).{0,18}(?:并发|同时)/],
  ["预期结果", /(?:只有|仅有|仅|只|恰好|最终(?:只有|仅有|只|为)?).{0,6}(?:一|1)(?:笔|条|个|次|份)?.{0,10}(?:成功|有效预约|预约记录)|(?:一|1)(?:笔|条|个|次).{0,6}(?:成功|有效预约).{0,8}(?:另一|另一个|其余|失败)/],
];
const uncertain = /尚未|未曾|没有|没法|没(?:做|用|加|设|返回|测|跑|验证)|未(?:做|用|加|设|返回|测|跑|验证)|不确定|不知道|不清楚|不(?:会|能|返回|采用|使用|支持)/;

function findDetails(answer: string) {
  const clauses = answer.split(/[。！？；，、,.!?;\n]+/);
  return Object.fromEntries(signals.flatMap(([name, pattern]) => {
    const quote = clauses.find(clause =>
      pattern.test(clause) && !uncertain.test(clause),
    )?.trim();
    return quote ? [[name, quote]] : [];
  })) as Partial<Record<Detail, string>>;
}

export const bookingQuestion = "两个请求同时查到座位空闲。你靠什么防止重复预约，冲突时又会怎么处理？";

export const exampleAnswers = [
  "我给有效预约加了数据库唯一约束。",
  "我给有效预约加了数据库唯一约束。遇到约束冲突就返回 409，提示座位已被预约。",
];

export function bookingFollowup(answer: string) {
  const details = findDetails(answer);
  if (!details["约束"]) return {
    topic: "并发控制",
    question: "两个请求都查到空闲后，在哪一个步骤决定谁可以写入？",
    reason: "当前回答里还没定位到数据库唯一约束。先说清最终由谁拦截重复写入。",
    quote: undefined,
    targets: ["约束"] as Detail[],
  };
  if (!details["冲突响应"]) return {
    topic: "冲突响应",
    question: "第二个请求写入时触发唯一约束，预约接口会向调用方返回什么？",
    reason: "已定位到唯一约束，还没看到冲突如何反馈给调用方。",
    quote: details["约束"],
    targets: ["冲突响应"] as Detail[],
  };
  return {
    topic: "验证方法",
    question: "你会怎么构造一个并发用例，并核对最终有效预约的数量？",
    reason: "已定位到冲突响应，可以继续检查如何验证并发结果。",
    quote: details["冲突响应"],
    targets: ["测试输入", "预期结果"] as Detail[],
  };
}

export function bookingReview(before: string, after: string) {
  const first = findDetails(before);
  const next = findDetails(after);
  return {
    added: signals.flatMap(([label]) => !first[label] && next[label]
      ? [{ label, quote: next[label] }]
      : []),
    pending: bookingFollowup(before).targets.filter(label => !next[label] && !first[label]),
  };
}
