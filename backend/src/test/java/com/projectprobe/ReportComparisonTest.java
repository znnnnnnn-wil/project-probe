package com.projectprobe;

import static org.junit.jupiter.api.Assertions.*;
import java.util.*;
import org.junit.jupiter.api.Test;

class ReportComparisonTest {
  Map<String, Object> body() {
    return new LinkedHashMap<>(Map.of("kind", "RETEST", "focus", "并发约束",
      "previousTurns", List.of(Map.of("id", "old", "question", "上轮问题", "answer", "上轮原文")),
      "turns", List.of(Map.of("id", "new", "question", "本轮问题", "answer", "本轮原文"))));
  }
  Map<String, Object> entry(String ref) {
    return new LinkedHashMap<>(Map.of("topic", "并发约束", "status", "PARTIAL", "assessment", "解释仍缺测试",
      "previousTurnIds", List.of("PT1"), "currentTurnIds", List.of(ref)));
  }
  @Test void referencesAlwaysUseOriginalAnswers() {
    var entry = entry("T1");
    entry.put("currentEvidence", List.of(Map.of("quote", "伪造引用")));
    var result = ReportComparison.build(Map.of("comparisons", List.of(entry)), body()).get(0);
    assertTrue(result.get("currentEvidence").toString().contains("本轮原文"));
    assertFalse(result.toString().contains("伪造引用"));
    assertThrows(org.springframework.web.server.ResponseStatusException.class,
      () -> ReportComparison.build(Map.of("comparisons", List.of(entry("T99"))), body()));
  }
  @Test void incompleteOrOffTopicClaimsAreRejectedAndOldReportsRemainCompatible() {
    var entry = entry("T1"); entry.put("previousTurnIds", List.of());
    assertThrows(org.springframework.web.server.ResponseStatusException.class,
      () -> ReportComparison.build(Map.of("comparisons", List.of(entry)), body()));
    entry.put("status", "NOT_COMPARABLE"); entry.put("topic", "无关主题");
    assertThrows(org.springframework.web.server.ResponseStatusException.class,
      () -> ReportComparison.build(Map.of("comparisons", List.of(entry)), body()));
    assertEquals("NEEDS_REVIEW", ReportComparison.build(Map.of(), body()).get(0).get("status"));
  }
}
