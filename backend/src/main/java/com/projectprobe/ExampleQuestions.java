package com.projectprobe;

import static com.projectprobe.Store.str;

import java.nio.charset.StandardCharsets;
import java.util.*;

final class ExampleQuestions {
  private static final Map<String, List<ModelService.GeneratedQuestion>> QUESTIONS = Map.of(
    "rag", List.of(
      question("在课程讲义检索中，请说明你负责的文档切分环节要给后续检索保留哪些信息。", "文档切分职责", "我负责按段落切分讲义，并保留每段的文档名和段落编号。"),
      question("以一次课程知识点查询为例，请说明向量检索的结果怎样进入回答生成环节。", "检索结果进入生成", "检索接口先召回相关片段，再把片段和学生的问题一起交给模型。"),
      question("请说明回答展示出处时，怎样用文档名和段落编号把引用定位到原讲义。", "引用出处定位", "每个片段都保存文档名和段落编号，展示时用这两项定位原文。"),
      question("如果要验证相似章节是否被错误召回，请说明你会怎样设计一条评测样例。", "检索评测样例", "我会选一个容易混淆的知识点，标出正确段落，再检查检索有没有召回它。"),
      question("假设检索片段无法支撑问题的答案，请说明你希望系统怎样向学生反馈。", "证据不足时的拒答", "我希望系统说明资料不足，并展示已有出处，避免给出缺少依据的结论。")
    ),
    "booking", List.of(
      question("在创建座位预约时，请说明你负责的后端接口为数据库写入哪些预约信息。", "预约接口职责", "我负责预约创建接口，将用户、座位、时间段和状态写入预约表。"),
      question("请用一次座位预约说明请求从浏览器到后端事务写入的过程。", "预约请求链路", "浏览器发起 REST 请求，后端在事务中写入 PostgreSQL 的预约记录。"),
      question("请说明这套数据库约束对同一个座位和时段的有效预约有什么限制。", "预约唯一约束", "同一个座位和时段只允许一条有效预约，数据库负责约束这项规则。"),
      question("如果要验证并发请求不会重复占用座位，请说明你会怎样构造验证请求。", "并发预约验证", "我会同时发两个同座位、同时段的请求，检查是否只有一笔预约成功。"),
      question("假设新增预约触发了唯一约束，请说明你希望接口怎样向前端返回冲突。", "预约冲突响应", "我会返回明确的业务冲突提示，让前端告诉用户该座位已被预约。")
    ),
    "scheduler", List.of(
      question("在定时发送服务中，请说明你负责的任务领取环节要写入什么状态。", "任务领取职责", "我负责任务领取，用条件更新把待发送任务改成执行中。"),
      question("请说明一条到期通知从被扫描到记录发送完成的处理过程。", "通知处理链路", "先扫描到期任务并领取，再调用通知接口，成功后将状态记为完成。"),
      question("有两个实例竞争同一任务时，请说明怎样通过数据库更新行数判断领取结果。", "并发领取结果", "更新到一行说明领取成功，更新零行就跳过，不继续发送。"),
      question("如果要验证多实例不会同时领取同一条任务，请说明你会观察什么结果。", "多实例领取验证", "我会让两个实例竞争同一任务，检查是否只有一个实例更新成功并发送。"),
      question("假设通知可能已经发送成功但接口超时，请说明你会依据什么避免盲目重发。", "通知超时判断", "我会先查询这条通知的发送结果，确认未发出后再重试。")
    )
  );

  static String projectId(String user, String sample) {
    return UUID.nameUUIDFromBytes((user + ":" + sample).getBytes(StandardCharsets.UTF_8)).toString();
  }

  static String scenario(String user, String projectId) {
    return QUESTIONS.keySet().stream().filter(sample -> projectId(user, sample).equals(projectId)).findFirst().orElse("");
  }

  static List<ModelService.GeneratedQuestion> fallbackFor(Map<String, Object> body) {
    if (!ExampleReference.enabled(body)) return List.of();
    var questions = QUESTIONS.getOrDefault(str(body, "exampleScenario"), List.of());
    String scope = ModelService.normalizeQuestion(str(body, "interviewTopic"));
    if (scope.isBlank()) return questions;
    return questions.stream().filter(question -> {
      String topic = ModelService.normalizeQuestion(question.topic());
      return scope.contains(topic) || (scope.length() >= 2 &&
        (topic.contains(scope) || ModelService.normalizeQuestion(question.question()).contains(scope)));
    }).toList();
  }

  private static ModelService.GeneratedQuestion question(String question, String topic, String reference) {
    return new ModelService.GeneratedQuestion(question, topic, "", reference);
  }
}
