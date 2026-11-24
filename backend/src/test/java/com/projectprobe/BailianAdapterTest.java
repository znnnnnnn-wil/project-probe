package com.projectprobe;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.util.*;
import org.junit.jupiter.api.Test;

class BailianAdapterTest {

  @Test
  void globalConcurrencyRejectsBeforeCallingProvider() throws Exception {
    var model = new ModelService(
      mock(Store.class),
      "live",
      "https://example.invalid",
      "synthetic",
      "synthetic",
      "DashScope"
    );
    model.modelSlots.acquire(4);
    try {
      assertEquals(
        429,
        assertThrows(
          org.springframework.web.server.ResponseStatusException.class,
          () -> model.call("合成请求", Map.of())
        )
          .getStatusCode()
          .value()
      );
    } finally {
      model.modelSlots.release(4);
    }
  }

  @Test
  void questionContextKeepsEvidenceOnceAndOmitsInternalState() {
    var model = new ModelService(
      mock(Store.class),
      "demo",
      "https://example.invalid",
      "",
      "synthetic",
      "DashScope"
    );
    var turn = Map.<String, Object>of(
      "id",
      "old-turn",
      "question",
      "如何确认重试结果？",
      "answer",
      "合成回答"
    );
    var round = Map.<String, Object>of(
      "trainingId",
      "old-training",
      "turns",
      List.of(turn)
    );
    var saved = new LinkedHashMap<String, Object>(
      Map.of(
        "project",
        Map.of("name", "合成项目"),
        "turns",
        List.of(),
        "historyTurns",
        List.of(turn),
        "trainingHistory",
        List.of(round),
        "reportPlan",
        List.of(Map.of("note", "私人复盘笔记")),
        "error",
        "内部错误",
        "operation",
        "QUESTION",
        "interviewFacts",
        List.of(turn)
      )
    );
    var input = model.questionInput(saved);
    assertEquals(List.of(turn), input.get("historyTurns"));
    assertFalse(
      ((Map<?, ?>) ((List<?>) input.get("trainingHistory")).get(0)).containsKey(
        "turns"
      )
    );
    assertFalse(input.containsKey("reportPlan"));
    assertFalse(input.containsKey("error"));
    assertFalse(input.containsKey("operation"));
    assertFalse(input.containsKey("interviewFacts"));
    assertEquals(List.of(turn), round.get("turns"));
    assertEquals(
      "私人复盘笔记",
      ((Map<?, ?>) ((List<?>) saved.get("reportPlan")).get(0)).get("note")
    );
  }

  ModelService contextModel() {
    return new ModelService(new Store(null, null, new com.fasterxml.jackson.databind.ObjectMapper()),
      "demo", "https://example.invalid", "", "synthetic", "DashScope");
  }

  @Test
  void questionContextProjectsAnswersOnceWithoutChangingStoredDialogue() {
    var model = contextModel();
    var turn = Map.<String, Object>of("id", "current", "question", "如何重试？", "topic", "重试",
      "answer", "同一请求键读取原结果", "exchanges", List.of(Map.of("answer", "同一请求键读取原结果", "reply", "面试官讲解")),
      "explanation", "面试官讲解", "questionHistory", List.of(Map.of("question", "原题")));
    var previous = Map.<String, Object>of("id", "previous", "question", "如何验证？", "answer", "尚未验证");
    var historical = Map.<String, Object>of("id", "history", "question", "职责？", "answer", "负责接口",
      "answerTruncated", true);
    var body = Map.<String, Object>of("project", Map.of(), "turns", List.of(turn),
      "previousTurns", List.of(previous), "historyTurns", List.of(turn, previous, historical),
      "trainingHistory", List.of(Map.of("trainingId", "old", "turns", List.of(historical), "error", "内部信息")));
    String saved = model.s.encode(body);
    var input = model.questionInput(body);
    var projected = Store.list(input, "turns").get(0);
    assertEquals(Set.of("id", "question", "topic", "answer"), projected.keySet());
    assertEquals(turn.get("answer"), projected.get("answer"));
    assertEquals(List.of(previous), input.get("previousTurns"));
    assertEquals(List.of(historical), input.get("historyTurns"));
    assertEquals(List.of(Map.of("trainingId", "old")), input.get("trainingHistory"));
    assertEquals(saved, model.s.encode(body));
  }

  @Test
  void backgroundAnswersAreBoundedNewestFirstButReportsRetainOriginalEvidence() {
    var model = contextModel();
    var turns = new ArrayList<Map<String, Object>>();
    for (int i = 0; i < 5; i++) turns.add(Map.of("id", "t" + i, "question", "问题" + i,
      "answer", "早期解释".repeat(2000) + "最后更正：未执行测试"));
    var input = model.questionInput(Map.of("project", Map.of(), "turns", turns));
    var compact = Store.list(input, "turns");
    assertEquals(5, compact.size());
    assertEquals(ModelContext.ANSWER_BUDGET, compact.stream().mapToInt(t -> Store.str(t, "answer").length()).sum());
    assertEquals("OMITTED", compact.get(0).get("answerExcerpt"));
    assertEquals(true, compact.get(0).get("answerTruncated"));
    assertEquals("", compact.get(0).get("answer"));
    assertEquals("TAIL", compact.get(4).get("answerExcerpt"));
    assertTrue(Store.str(compact.get(4), "answer").endsWith("最后更正：未执行测试"));
    var report = model.reportInput(Map.of(), turns, List.of());
    assertEquals(turns.get(0).get("answer"), Store.list(new LinkedHashMap<>(report), "answeredTurns").get(0).get("answer"));
    assertFalse(turns.get(0).containsKey("answerTruncated"));
    assertTrue(Store.str(turns.get(4), "answer").length() > 6000);
    assertFalse(model.s.encode(report).contains("answerExcerpt"));
  }

  @Test
  void answerExcerptsDoNotSplitSurrogatePairsOrTurnUnansweredIntoTruncated() {
    String answer = "前文" + "\uD840\uDC00" + "末".repeat(5999);
    var compact = ModelContext.turns(List.of(Map.of("answer", answer), Map.of("answer", "")));
    assertEquals("末".repeat(5999), compact.get(0).get("answer"));
    assertEquals(true, compact.get(0).get("answerTruncated"));
    assertFalse(compact.get(1).containsKey("answerTruncated"));
  }

  @Test
  void requestLimitCountsRulesJsonEscapingAndEnvelopeBeforeCallingProvider() {
    var model = contextModel();
    int overhead = model.s.encode(model.requestBody("规则", Map.of("text", ""))).length();
    String fits = "x".repeat(ModelContext.MAX_REQUEST_CHARS - overhead);
    assertEquals(ModelContext.MAX_REQUEST_CHARS,
      model.s.encode(model.requestBody("规则", Map.of("text", fits))).length());
    assertEquals(413, assertThrows(ModelContext.TooLarge.class,
      () -> model.call("规则", Map.of("text", fits + "x"))).getStatusCode().value());
    assertThrows(ModelContext.TooLarge.class,
      () -> model.requestBody("规".repeat(ModelContext.MAX_REQUEST_CHARS), Map.of()));
    assertThrows(ModelContext.TooLarge.class,
      () -> model.requestBody("规则", Map.of("text", "\\".repeat(31000))));
  }

  @Test
  void oversizedReportIsRejectedRatherThanClippingEvidence() {
    var model = contextModel();
    String original = "原始回答".repeat(ModelContext.MAX_REQUEST_CHARS / 4);
    var turns = List.<Map<String, Object>>of(Map.of("id", "t", "question", "验证？", "answer", original));
    var input = model.reportInput(Map.of(), turns, List.of());
    assertThrows(ModelContext.TooLarge.class, () -> model.requestBody("生成报告", input));
    assertEquals(original, Store.list(new LinkedHashMap<>(input), "answeredTurns").get(0).get("answer"));
    assertEquals(original, turns.get(0).get("answer"));
  }

  @Test
  void reportInputExposesOnlyEligibleEvidenceAndNoTrainingMetadata() {
    var model = new ModelService(
      mock(Store.class),
      "demo",
      "https://example.invalid",
      "",
      "synthetic",
      "DashScope"
    );
    var project = new LinkedHashMap<String, Object>(
      Map.of("id", "project-id", "name", "合成项目", "ownerId", "user-id")
    );
    var turns = List.<Map<String, Object>>of(
      Map.of(
        "id",
        "answered-id",
        "question",
        "如何验证？",
        "answer",
        "只做了正常路径测试"
      )
    );
    var facts = List.<Map<String, Object>>of(
      Map.of("id", "fact-id", "text", "合成事实")
    );
    var input = model.reportInput(project, turns, facts);
    assertEquals(List.of("T1"), input.get("allowedTurnIds"));
    assertEquals(List.of("F1"), input.get("allowedFactIds"));
    assertFalse(input.toString().contains("project-id"));
    assertFalse(input.toString().contains("user-id"));
    assertTrue(input.toString().contains("只做了正常路径测试"));
    assertEquals(
      List.of(),
      model.reportInput(project, List.of(), List.of()).get("allowedTurnIds")
    );
  }

  @Test
  void freeQuotaModeRequiresConfirmationForExactModel() {
    var model = new ModelService(
      mock(Store.class),
      "live",
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "synthetic",
      "qwen3.8-max-0902",
      "DashScope"
    );
    model.freeQuotaOnly = true;
    assertThrows(IllegalArgumentException.class, model::validateTimeout);
    model.freeQuotaConfirmedModel = "qwen-plus";
    assertThrows(IllegalArgumentException.class, model::validateTimeout);
    model.freeQuotaConfirmedModel = "qwen3.8-max-0902";
    assertDoesNotThrow(model::validateTimeout);
    var international = new ModelService(
      mock(Store.class),
      "live",
      "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
      "synthetic",
      "qwen3.8-max-0902",
      "DashScope"
    );
    international.freeQuotaOnly = true;
    international.freeQuotaConfirmedModel = "qwen3.8-max-0902";
    assertThrows(
      IllegalArgumentException.class,
      international::validateTimeout
    );
  }

  @Test
  void exhaustedFreeQuotaReturnsSafeFailureWithoutRawProviderMessage() {
    var s = new Store(
      null,
      null,
      new com.fasterxml.jackson.databind.ObjectMapper()
    );
    var model = new ModelService(
      s,
      "demo",
      "https://example.invalid",
      "",
      "synthetic",
      "DashScope"
    );
    String reason = model.providerFailureReason(
      403,
      "{\"error\":{\"code\":\"AllocationQuota.FreeTierOnly\",\"message\":\"sensitive-provider-text\"}}"
    );
    assertTrue(reason.contains("文字模型当前不可用"));
    assertFalse(reason.contains("sensitive-provider-text"));
    assertFalse(
      model
        .providerFailureReason(401, "sensitive-provider-text")
        .contains("sensitive")
    );
  }

  @Test
  void timeoutCannotExceedGenerationLeaseBudget() {
    var model = new ModelService(
      mock(Store.class),
      "demo",
      "https://example.invalid",
      "",
      "synthetic",
      "DashScope"
    );
    model.timeoutSeconds = 40;
    assertDoesNotThrow(model::validateTimeout);
    model.timeoutSeconds = 41;
    assertThrows(IllegalArgumentException.class, model::validateTimeout);
    model.timeoutSeconds = 4;
    assertThrows(IllegalArgumentException.class, model::validateTimeout);
  }

  @Test
  void dashscopeUsesNonThinkingJsonAndDoesNotSendKeyInBody() {
    var s = mock(Store.class);
    when(s.encode(any())).thenReturn("合成材料");
    var model = new ModelService(
      s,
      "live",
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "synthetic-key",
      "qwen-plus",
      "DashScope"
    );
    var body = model.requestBody("需要 JSON 报告", Map.of("test", true));
    assertEquals(false, body.get("enable_thinking"));
    assertEquals(Map.of("type", "json_object"), body.get("response_format"));
    assertEquals(2200, body.get("max_tokens"));
    assertFalse(body.toString().contains("synthetic-key"));
    assertEquals(2, ((List<?>) body.get("messages")).size());
  }

  @Test
  void otherProvidersDoNotReceiveDashscopeExtension() {
    var s = mock(Store.class);
    when(s.encode(any())).thenReturn("合成材料");
    var model = new ModelService(
      s,
      "demo",
      "https://example.invalid/v1",
      "",
      "synthetic",
      "OpenAI-compatible"
    );
    assertFalse(
      model.requestBody("JSON", Map.of()).containsKey("enable_thinking")
    );
  }
}
