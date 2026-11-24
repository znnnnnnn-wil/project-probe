package com.projectprobe;

import static org.junit.jupiter.api.Assertions.*;
import java.util.*;
import org.junit.jupiter.api.Test;

class QuestionCoverageTest {
  @Test void reservesFourScoringDimensionsBeforeTheLastPracticeQuestion() {
    var model = new ModelService(null, "live", "https://never-called.invalid", "synthetic", "synthetic", "test");
    var turns = new ArrayList<Map<String, Object>>();
    var body = new LinkedHashMap<String, Object>(Map.of("kind", "PRACTICE", "maxTurns", 5, "turns", turns,
      "interviewTopic", "文档切分"));
    for (String dimension : List.of("个人职责", "表达清晰度", "技术深度", "验证与边界", "查漏补缺")) {
      var input = model.questionInput(body);
      assertTrue(((String) input.get("practiceScoringFocus")).startsWith(dimension));
      assertEquals("文档切分", input.get("interviewTopic"));
      turns.add(Map.of("answer", "本轮回答"));
    }
    body.put("kind", "RETEST");
    assertFalse(model.questionInput(body).containsKey("practiceScoringFocus"));
  }

  @Test void unknownFrameworkAssertionsAreRejectedButOpenQuestionsAreAllowed() {
    var body = new LinkedHashMap<String, Object>(Map.of("project", Map.of("stack", "Spring Boot / PostgreSQL", "implementation", "Repository查询库存")));
    assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> QuestionCoverage.validatePremise("请说明你使用的JPA事务边界。", body));
    QuestionCoverage.validatePremise("请说明Repository实际如何访问PostgreSQL。", body);
    QuestionCoverage.validatePremise("你是否使用JPA处理事务？", body);
    QuestionCoverage.validatePremise("假设使用Redis，缓存失效时怎样处理？", body);
    body.put("turns", List.of(Map.of("answer", "我用JPA访问数据库")));
    QuestionCoverage.validatePremise("请说明你使用的JPA事务边界。", body);
  }
  @Test void explicitCompoundPromptsAreRejectedWithoutRejectingOneRequest() {
    assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> QuestionCoverage.validateBurden(
      "请说明幂等键如何生成、在哪一层判断冲突，以及重复请求返回什么结果。"));
    QuestionCoverage.validateBurden("请说明重复请求命中幂等键时返回的结果。");
    QuestionCoverage.validateBurden("假设请求超时，你会怎样核对数据库状态？");
  }
  @Test void explicitUnknownMovesToAnotherGoalInsteadOfRephrasing() {
    var body = new LinkedHashMap<String, Object>(Map.of("turns", List.of(Map.of("question", "如何处理重复请求？",
      "topic", "幂等与重试", "answer", "暂时不会，这部分需要补充。"))));
    assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> QuestionCoverage.validateGoal(
      Map.of("question", "请说明幂等键生成方式。", "topic", "幂等与重试"), body));
    QuestionCoverage.validateGoal(Map.of("question", "请说明你亲自负责的接口。", "topic", "职责边界"), body);
  }
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
  @Test void recognizedRetestTargetsCannotDriftToAnotherGoal() {
    var body = new LinkedHashMap<String, Object>(Map.of("kind", "RETEST", "focus", "事务边界"));
    assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> QuestionCoverage.validateGoal(
      Map.of("question", "参数校验用@Valid还是手动if？", "topic", "校验实现"), body));
    QuestionCoverage.validateGoal(Map.of("question", "假设两次提交之间进程崩溃，事务边界如何影响状态？", "topic", "事务边界"), body);
  }
}
