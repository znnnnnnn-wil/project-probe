package com.projectprobe;

import static com.projectprobe.Store.*;
import static org.junit.jupiter.api.Assertions.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.web.server.ResponseStatusException;

class ModelQualityTest {
  final Store store = new Store(null, null, new com.fasterxml.jackson.databind.ObjectMapper());
  Map<String, Object> body() {
    return new LinkedHashMap<>(Map.of("project", new LinkedHashMap<>(Map.of("responsibility", "我负责预约接口", "facts", List.of())),
      "turns", List.of(Map.of("id", "turn-1", "question", "请说明验证方式。", "answer", "我只测了正常预约，尚未执行并发测试。"))));
  }
  Map<String, Object> candidate() {
    return new LinkedHashMap<>(Map.of("clearParts", List.of("说明了已测正常预约"), "retestTopics", List.of("并发验证"),
      "findings", List.of(new LinkedHashMap<>(Map.of("topic", "并发验证", "assessment", "回答尚未说明并发预约的验证结果", "task", "发起两个同座位请求并核对成功数和最终记录数",
        "turnIds", List.of("T1"), "factIds", List.of())))));
  }
  Map<String, Object> check(String key, String verdict, List<Map<String, Object>> quotes) {
    return Map.of("key", key, "verdict", verdict, "reason", "所引回答明确保留了未执行的边界", "quotes", quotes);
  }
  Map<String, Object> quote(String source, String text) { return Map.of("sourceId", source, "quote", text); }
  Map<String, Object> review() {
    return Map.of("checks", List.of(check("CLEAR_1", "SUPPORTED", List.of(quote("T1", "我只测了正常预约"))),
      check("FINDING_1", "SUPPORTED", List.of(quote("T1", "尚未执行并发测试")))));
  }
  ModelService queued(List<Map<String, Object>> outputs, List<String> rules) {
    var queue = new ArrayDeque<>(outputs);
    var model = new ModelService(store, "live", "https://never-called.invalid", "synthetic", "synthetic", "test") {
      @Override Map<String, Object> call(String rule, Object data) {
        rules.add(rule);
        assertTrue(questionDeadline.get() <= now() + 80000, "生成和复核共用总预算");
        assertFalse(queue.isEmpty(), "不能无限修订或隐式跳过复核");
        return queue.remove();
      }
    };
    model.qualityReviewEnabled = true;
    return model;
  }
  @Test void reportStoresOnlyExactSpansAndDoesNotClaimHumanVerification() {
    var rules = new ArrayList<String>();
    var model = queued(List.of(candidate(), review()), rules);
    var report = model.report(body());
    assertEquals(2, rules.size());
    assertEquals("MODEL_REVIEWED", ((Map<?, ?>) report.get("qualityReview")).get("status"));
    assertEquals(false, ((Map<?, ?>) report.get("qualityReview")).get("humanVerified"));
    var finding = list(report, "findings").get(0);
    assertEquals("尚未执行并发测试", list(finding, "supportingQuotes").get(0).get("quote"));
    assertEquals("MODEL_REVIEWED_NEEDS_HUMAN_REVIEW", finding.get("evidenceStatus"));
    assertEquals(Long.MAX_VALUE, model.questionDeadline.get());
  }
  @Test void unsupportedReportIsRepairedOnceAndMustBeReviewedAgain() {
    var rejection = Map.<String, Object>of("checks", List.of(check("CLEAR_1", "UNSUPPORTED", List.of()),
      check("FINDING_1", "SUPPORTED", List.of(quote("T1", "尚未执行并发测试")))));
    var rules = new ArrayList<String>();
    var model = queued(List.of(candidate(), rejection, candidate(), review()), rules);
    model.report(body());
    assertEquals(4, rules.size());
  }
  @Test void uncertainReportNeverBecomesASuccessAfterRetryBudget() {
    var rejection = Map.<String, Object>of("checks", List.of(check("CLEAR_1", "NEEDS_REVIEW", List.of()),
      check("FINDING_1", "SUPPORTED", List.of(quote("T1", "尚未执行并发测试")))));
    var rules = new ArrayList<String>();
    var model = queued(List.of(candidate(), rejection, candidate(), rejection), rules);
    assertThrows(ResponseStatusException.class, () -> model.report(body()));
    assertEquals(4, rules.size());
    assertEquals(Long.MAX_VALUE, model.questionDeadline.get());
  }
  @Test void reviewCannotInventQuotesOrUseUnrelatedAnswers() {
    for (var bad : List.of(quote("T1", "并发测试已经通过"), quote("T2", "尚未执行并发测试"), quote("P_responsibility", "我负责预约接口"))) {
      var result = new ModelService(store, "live", "https://never-called.invalid", "synthetic", "synthetic", "test") {
        @Override Map<String, Object> call(String rule, Object data) { return candidate(); }
      }.report(body());
      var checks = Map.<String, Object>of("checks", List.of(check("CLEAR_1", "SUPPORTED", List.of(quote("T1", "我只测了正常预约"))),
        check("FINDING_1", "SUPPORTED", List.of(bad))));
      assertThrows(ResponseStatusException.class, () -> ModelQuality.report(checks, ModelQuality.claims(result, body()), result));
    }
  }
  @Test void missingDuplicateAndUnknownReviewClaimsFailClosed() {
    var result = queued(List.of(candidate(), review()), new ArrayList<>()).report(body());
    var claims = ModelQuality.claims(result, body());
    var valid = check("CLEAR_1", "SUPPORTED", List.of(quote("T1", "我只测了正常预约")));
    for (var checks : List.of(List.of(valid), List.of(valid, valid), List.of(valid, check("FINDING_9", "SUPPORTED", List.of()))))
      assertThrows(ResponseStatusException.class, () -> ModelQuality.report(Map.of("checks", checks), claims, result));
    assertThrows(ResponseStatusException.class, () -> ModelQuality.report(Map.of(), claims, result));
  }
  @Test void malformedQuestionReviewDoesNotSilentlyPass() {
    assertThrows(ResponseStatusException.class, () -> ModelQuality.question(Map.of("passed", true), "", Map.of(), false));
    assertThrows(ResponseStatusException.class, () -> ModelQuality.question(Map.of("issues", List.of(Map.of("code", "UNKNOWN", "reason", "x"))), "", Map.of(), false));
    ModelQuality.question(Map.of("issues", List.of()), "", Map.of(), false);
  }
  @Test void rejectedReasonsStayOutOfSharedLogsButRemainAvailableToTheOwner() {
    var failure = assertThrows(ModelQuality.Rejected.class, () -> ModelQuality.question(Map.of("issues", List.of(
      Map.of("code", "UNSUPPORTED_PREMISE", "reason", "合成私人原文中的框架尚未声明"))), "", Map.of(), false));
    assertEquals("QUESTION", failure.diagnostic.get("stage"));
    assertEquals("semantic_review_failed", ModelQuality.logReason(failure.getReason()));
    assertFalse(ModelQuality.logReason(failure.getReason()).contains("私人原文"));
  }
  @Test void serviceFailuresDoNotRegenerateWholeReports() {
    int[] calls = {0};
    var model = new ModelService(store, "live", "https://never-called.invalid", "synthetic", "synthetic", "test") {
      @Override Map<String, Object> call(String rule, Object data) { calls[0]++; throw error(503, "模型繁忙，请稍后重试"); }
    };
    model.qualityReviewEnabled = true;
    assertThrows(ResponseStatusException.class, () -> model.report(body()));
    assertEquals(1, calls[0]);
    assertEquals(Long.MAX_VALUE, model.questionDeadline.get());
  }
  @Test void comparisonNeedsExactEvidenceFromBothRounds() {
    var before = source("PT1", "我不知道怎样验证", "old");
    var after = source("T1", "计划发起两个请求并核对记录数量", "new");
    var claims = List.of(ModelQuality.claim("COMPARISON_1", Map.of("status", "PARTIAL"), List.of(before, after)));
    assertThrows(ResponseStatusException.class, () -> ModelQuality.report(Map.of("checks", List.of(
      check("COMPARISON_1", "SUPPORTED", List.of(quote("T1", "计划发起两个请求"))))), claims, new LinkedHashMap<>()));
    ModelQuality.report(Map.of("checks", List.of(check("COMPARISON_1", "SUPPORTED", List.of(
      quote("PT1", "我不知道怎样验证"), quote("T1", "计划发起两个请求"))))), claims, new LinkedHashMap<>());
  }
  Map<String, Object> source(String id, String text, String turn) { return ModelQuality.source(id, text, turn); }

  @Test void semanticQuestionCheckStillRejectsUnsupportedPremisesAndOffTopicQuestions() {
    for (String code : List.of("UNSUPPORTED_PREMISE", "OFF_TARGET", "CONTRADICTORY_CONDITION")) {
      var rules = new ArrayList<String>();
      var reject = Map.<String, Object>of("issues", List.of(Map.of("code", code, "reason", "重复目标或预设了未提供的实现")));
      var first = Map.<String, Object>of("question", "请说明你如何保证查询结果正确。", "topic", "验证方法");
      var repaired = Map.<String, Object>of("question", "请说明实际使用的数据访问方式。", "topic", "查询实现");
      var model = queued(List.of(first, reject, repaired, Map.of("issues", List.of())), rules);
      assertEquals(repaired.get("question"), model.firstDeepQuestion(body()).question());
      assertEquals(4, rules.size());
    }
  }

  @Test void sharedTopicAndUngroundedRepeatVerdictsDoNotBlockADifferentQuestion() {
    var practice = body();
    var old = Map.of("id", "cut-1", "question", "请说明讲义切分时怎样确定片段边界。", "topic", "讲义切分",
      "outcome", PracticeRoundHistory.ANSWERED_INDEPENDENTLY);
    practice.put("practiceHistory", List.of(old));
    var candidate = Map.<String, Object>of("question", "请说明你会怎样验证讲义切分的效果。", "topic", "讲义切分");
    var falsePositive = Map.of("code", "REPEATED_GOAL", "reason", "两道题都谈到切分。");
    for (var issue : List.of(falsePositive,
        Map.of("code", "REPEATED_GOAL", "reason", "两道题都谈到切分。", "previousQuestionId", "cut-1",
          "previousGoalQuote", "怎样确定片段边界", "candidateGoalQuote", "怎样确定片段边界"),
        Map.of("code", "REPEATED_GOAL", "reason", "两道题都谈到切分。", "previousQuestionId", "cut-1",
          "previousGoalQuote", "讲义切分", "candidateGoalQuote", "讲义切分"),
        Map.of("code", "REPEATED_GOAL", "previousQuestionId", "cut-1",
          "previousGoalQuote", "怎样确定片段边界", "candidateGoalQuote", "怎样验证讲义切分的效果"),
        Map.of("code", "REPEATED_GOAL", "reason", "两道题都谈到切分。", "previousQuestionId", "unknown",
          "previousGoalQuote", "怎样确定片段边界", "candidateGoalQuote", "怎样验证讲义切分的效果"))) {
      var rules = new ArrayList<String>();
      var model = queued(List.of(candidate, Map.of("issues", List.of(issue))), rules);
      assertEquals(candidate.get("question"), model.question(practice).question());
      assertEquals(2, rules.size());
    }
  }

  @Test void plannedScoringDimensionGuidesGenerationWithoutRestrictingQuestionReview() {
    var practice = body();
    practice.putAll(Map.of("kind", "PRACTICE", "maxTurns", 5, "interviewTopic", "并发预约"));
    var candidate = Map.<String, Object>of("question", "请说明预约记录的唯一约束应由哪些字段组成。", "topic", "唯一约束设计");
    var calls = new ArrayList<String>();
    var model = new ModelService(store, "live", "https://never-called.invalid", "synthetic", "synthetic", "test") {
      @Override Map<String, Object> call(String rule, Object data) {
        var input = (Map<?, ?>) data;
        if (rule.startsWith(ModelQuality.QUESTION_RULE)) {
          calls.add("review");
          var context = (Map<?, ?>) input.get("context");
          assertEquals("并发预约", context.get("interviewTopic"));
          assertFalse(context.containsKey("practiceScoringFocus"));
          assertFalse(rule.contains("practiceScoringFocus"));
          return Map.of("issues", List.of());
        }
        calls.add("generate");
        assertTrue(input.get("practiceScoringFocus").toString().startsWith("表达清晰度"));
        return candidate;
      }
    };
    model.qualityReviewEnabled = true;
    assertEquals(candidate.get("question"), model.question(practice).question());
    assertEquals(List.of("generate", "review"), calls);
  }

  @Test void aDifferentVerificationQuestionReachesReviewAfterTwoVerificationQuestions() {
    var practice = body();
    practice.putAll(Map.of("kind", "PRACTICE", "maxTurns", 5, "turns", List.of(
      Map.of("question", "怎么测试并发预约只成功一笔？", "topic", "并发预约测试", "answer", "并行发请求后查库。"),
      Map.of("question", "怎么测试取消不存在的预约？", "topic", "无效预约测试", "answer", "传入无效 ID 并检查响应。"))));
    var candidate = Map.<String, Object>of("question", "怎么测试普通用户只能取消自己的预约？", "topic", "预约权限测试");
    var rules = new ArrayList<String>();
    var model = queued(List.of(Map.of("issues", List.of())), rules);

    assertEquals(candidate.get("question"), model.question(practice, candidate).question());
    assertEquals(1, rules.size());
    assertTrue(rules.get(0).startsWith(ModelQuality.QUESTION_RULE));
  }

  @Test void genericOpeningFromTheModelIsReplacedByAnExampleSpecificQuestion() {
    var practice = body();
    practice.putAll(Map.of("kind", "PRACTICE", "maxTurns", 5, "example", true, "exampleScenario", "rag",
      "exampleRoundNumber", 1, "turns", new ArrayList<>()));
    var rules = new ArrayList<String>();
    var candidate = Map.<String, Object>of("question", ModelService.GENERIC_PRACTICE_OPENER, "topic", "个人贡献范围");
    var model = queued(List.of(candidate), rules);
    var chosen = model.firstDeepQuestion(practice);
    assertTrue(chosen.question().contains("文档切分"));
    assertTrue(chosen.referenceAnswer().contains("段落编号"));
    assertEquals(1, rules.size());
  }

  @ParameterizedTest
  @ValueSource(booleans = {false, true})
  void combinedDecisionOnlyReviewsCandidatesForOwnProjects(boolean example) {
    var rules = new ArrayList<String>();
    var practice = body();
    practice.putAll(Map.of("kind", "PRACTICE", "maxTurns", 5, "interviewTopic", "并发预约", "example", example));
    var turn = list(practice, "turns").get(0);
    String answer = str(turn, "answer");
    var candidate = Map.<String, Object>of("question", "请说明预约记录的唯一约束应由哪些字段组成。", "topic", "唯一约束设计");
    var decision = Map.<String, Object>of("decision", "ADVANCE", "reply", "我们看下一题。", "evidence", answer, "nextQuestion", candidate);
    var model = queued(example ? List.of(decision) : List.of(decision, Map.of("issues", List.of())), rules);
    model.questionDeadline.set(now() + 80_000);
    var reply = PracticeDialogue.decide(model, practice, turn, answer);
    assertTrue(reply.advance());
    assertEquals(candidate.get("question"), model.question(practice, reply.nextQuestion()).question());
    assertEquals(example ? 1 : 2, rules.size());
    assertTrue(rules.get(0).contains("nextQuestion"));
    if (!example) assertTrue(rules.get(1).startsWith(ModelQuality.QUESTION_RULE));
  }

  @Test void firstExplanationSentenceIsEmittedBeforeTheModelFinishes() {
    var sentences = new ArrayList<String>();
    var stream = new PracticeExplanationStream(store, sentences::add);
    stream.onNext("data: {\"choices\":[{\"delta\":{\"content\":\"用唯一约束\"}}]}");
    assertTrue(sentences.isEmpty());
    stream.onNext("data: {\"choices\":[{\"delta\":{\"content\":\"避免重复。再检查\"}}]}");
    assertEquals(List.of("用唯一约束避免重复。"), sentences);
    assertThrows(ResponseStatusException.class, stream::result);
    stream.onNext("data: {\"choices\":[{\"delta\":{\"content\":\"响应。\"}}]}");
    stream.onNext("data: [DONE]");
    assertEquals("用唯一约束避免重复。再检查响应。", stream.result());
    assertEquals(List.of("用唯一约束避免重复。", "再检查响应。"), sentences);
  }
}
