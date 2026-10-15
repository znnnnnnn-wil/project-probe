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
    assertTrue(reason.contains("免费额度"));
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
