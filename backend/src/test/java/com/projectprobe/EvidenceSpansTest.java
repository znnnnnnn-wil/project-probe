package com.projectprobe;
import static com.projectprobe.Store.*;
import static org.junit.jupiter.api.Assertions.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class EvidenceSpansTest {
  final List<Map<String, Object>> turns = List.of(Map.of("id", "turn-1", "question", "请说明验证方式。", "answer", "只做了正常路径，尚未执行并发测试"),
    Map.of("id", "turn-2", "question", "请说明职责。", "answer", "同学负责前端，我负责接口"));
  Map<String, Object> finding(String ref, String quote) {
    return new LinkedHashMap<>(Map.of("turnIds", List.of("turn-1"), "factIds", List.of(),
      "supportingQuotes", List.of(Map.of("sourceId", ref, "quote", quote))));
  }
  @Test void exactSpansAreBoundToTheFindingCitation() {
    var result = EvidenceSpans.validate(finding("T1", "尚未执行并发测试"), Map.of("T1", "turn-1", "T2", "turn-2"), Map.of(), turns, List.of());
    assertEquals("尚未执行并发测试", result.get(0).get("quote"));
    assertThrows(ResponseStatusException.class, () -> EvidenceSpans.validate(finding("T2", "我负责接口"), Map.of("T2", "turn-2"), Map.of(), turns, List.of()));
    assertThrows(ResponseStatusException.class, () -> EvidenceSpans.validate(finding("T1", "已经通过并发测试"), Map.of("T1", "turn-1"), Map.of(), turns, List.of()));
    assertThrows(ResponseStatusException.class, () -> EvidenceSpans.validate(finding("T1", "只做了正常路径尚未执行并发测试"), Map.of("T1", "turn-1"), Map.of(), turns, List.of()));
  }
  @Test void emptySpansAndMaterialOnlyCitationsDoNotProveAnswerFindings() {
    var f = finding("F1", "合成材料"); f.put("factIds", List.of("fact-1"));
    assertThrows(ResponseStatusException.class, () -> EvidenceSpans.validate(f, Map.of(), Map.of("F1", "fact-1"), turns, List.of(Map.of("id", "fact-1", "text", "合成材料"))));
    f.put("supportingQuotes", List.of());
    assertThrows(ResponseStatusException.class, () -> EvidenceSpans.validate(f, Map.of(), Map.of(), turns, List.of()));
  }
  @Test void invalidGeneratedSpansAreRepairedWithoutAnExtraReviewRequest() {
    var store = new Store(null, null, new com.fasterxml.jackson.databind.ObjectMapper());
    int[] calls = {0};
    var model = new ModelService(store, "live", "https://never-called.invalid", "synthetic", "synthetic", "test") {
      @Override Map<String, Object> call(String rule, Object data) {
        calls[0]++;
        var f = finding("T1", calls[0] == 1 ? "已经验证成功" : "尚未执行并发测试");
        f.putAll(Map.of("topic", "并发验证", "assessment", "尚未提供并发结果", "task", "执行两个请求并核对最终记录数"));
        return new LinkedHashMap<>(Map.of("clearParts", List.of(), "retestTopics", List.of("并发验证"), "findings", List.of(f)));
      }
    };
    model.evidenceSpansRequired = true;
    var body = new LinkedHashMap<String, Object>(Map.of("project", new LinkedHashMap<>(Map.of("facts", List.of())), "turns", turns));
    var result = model.report(body);
    assertEquals(2, calls[0]);
    assertFalse(result.containsKey("qualityReview"));
    assertEquals("SOURCE_SPANS_CHECKED_NEEDS_REVIEW", list(result, "findings").get(0).get("evidenceStatus"));
  }
  @Test void validLongTaskDoesNotFailTrainingOrLoseItsCaveats() {
    var store = new Store(null, null, new com.fasterxml.jackson.databind.ObjectMapper());
    int[] calls = {0};
    var model = new ModelService(store, "live", "https://never-called.invalid", "synthetic", "synthetic", "test") {
      @Override Map<String, Object> call(String rule, Object data) {
        var f = finding("T1", "尚未执行并发测试");
        f.putAll(Map.of("topic", "并发验证", "assessment", "尚未提供并发结果",
          "task", ++calls[0] == 1 ? "长".repeat(61) : "执行两个请求并核对最终记录数"));
        return new LinkedHashMap<>(Map.of("clearParts", List.of(), "retestTopics", List.of("并发验证"), "findings", List.of(f)));
      }
    };
    model.evidenceSpansRequired = true;
    var result = model.report(new LinkedHashMap<>(Map.of("project", new LinkedHashMap<>(Map.of("facts", List.of())), "turns", turns)));
    assertEquals(1, calls[0]);
    assertEquals("长".repeat(61), list(result, "findings").get(0).get("task"));
  }
}
