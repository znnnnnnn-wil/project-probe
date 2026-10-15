package com.projectprobe;

import static org.junit.jupiter.api.Assertions.*;
import java.util.*;
import org.junit.jupiter.api.Test;

class QuestionCoverageTest {
  @Test void selfReportedGapsAreKeptWithoutClaimingMastery() {
    var result = QuestionCoverage.summarize(new LinkedHashMap<>(Map.of("turns", List.of(
      Map.of("topic", "验证", "question", "如何验证", "answer", "尚未验证"),
      Map.of("topic", "职责", "question", "谁负责", "answer", "我负责接口")))));
    assertEquals("自报待补充", result.get(0).get("state"));
    assertTrue(result.get(1).get("state").toString().contains("未独立验证"));
  }
  @Test void nearDuplicateDoesNotRejectChangedNumbers() {
    String original = "请说明同一接口的两个并发请求，如何保证数据库仅写入一条记录？";
    assertTrue(QuestionCoverage.nearDuplicate(original, original.replace("请说明", "说明")));
    assertFalse(QuestionCoverage.nearDuplicate("请求在1.5秒后超时时如何观察和验证最终状态？", "请求在15秒后超时时如何观察和验证最终状态？"));
    assertFalse(QuestionCoverage.nearDuplicate(original, "如果下游已经成功但响应丢失，重试将如何处理？"));
  }
  @Test void repeatedImplementationGoalsNeedAnExplicitNewCondition() {
    var body = new LinkedHashMap<String, Object>(Map.of("turns", List.of(Map.of(
      "question", "Repository方法签名是什么？", "topic", "查询实现", "answer", "尚未说明"), Map.of(
      "question", "Repository查询是如何实现的？", "topic", "查询实现", "answer", "仍未解释"))));
    var repeated = Map.<String, Object>of("question", "你用Spring Data派生查询还是自定义SQL？", "topic", "查询方式");
    assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> QuestionCoverage.validateGoal(repeated, body));
    QuestionCoverage.validateGoal(Map.of("question", "假设书号字段改为字符串，自定义SQL的入参该如何处理？", "topic", "查询实现",
      "changedCondition", "书号字段改为字符串"), body);
    QuestionCoverage.validateGoal(Map.of("question", "如何用断言验证返回的库存值？", "topic", "验证方法"), body);
  }
  @Test void recognizedRetestTargetsCannotDriftToAnotherGoal() {
    var body = new LinkedHashMap<String, Object>(Map.of("kind", "RETEST", "focus", "事务边界"));
    assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> QuestionCoverage.validateGoal(
      Map.of("question", "参数校验用@Valid还是手动if？", "topic", "校验实现"), body));
    QuestionCoverage.validateGoal(Map.of("question", "假设两次提交之间进程崩溃，事务边界如何影响状态？", "topic", "事务边界"), body);
  }
}
