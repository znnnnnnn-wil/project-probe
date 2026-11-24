package com.projectprobe;
import static org.junit.jupiter.api.Assertions.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class QuestionRepairTest {
  @Test void exampleReferenceIsOptionalAndUsesTheSameQuestionRequest() {
    for (Object reference : List.of("我会用座位和时段建立唯一约束。", 123,
        "CREATE UNIQUE INDEX ON reservations (seat_id, slot_id) WHERE status = 'active';",
        "字".repeat(ExampleReference.MAX_LENGTH), "字".repeat(ExampleReference.MAX_LENGTH + 1))) {
      var calls = new AtomicInteger();
      var model = new ModelService(null, "demo", "https://example.invalid", "", "", "test") {
        @Override Map<String, Object> call(String rule, Object input) {
          assertTrue(rule.contains("referenceAnswer"));
          calls.incrementAndGet();
          return Map.of("question", "请说明你实现的预约约束。", "topic", "预约约束", "referenceAnswer", reference);
        }
      };
      var practice = new LinkedHashMap<String, Object>(Map.of("example", true));
      var question = model.checkedQuestion("只问一题", new LinkedHashMap<>(), practice, false);
      assertEquals("请说明你实现的预约约束。", question.question());
      assertEquals(reference instanceof String text && text.length() <= ExampleReference.MAX_LENGTH ? text : "", question.referenceAnswer());
      assertEquals(1, calls.get());
    }
  }
  @Test void invalidOutputGetsOneRepairWithoutWeakeningValidation() {
    var calls = new AtomicInteger();
    var model = new ModelService(null, "demo", "https://example.invalid", "", "", "test") {
      @Override Map<String, Object> call(String rule, Object input) {
        return Map.of("question", calls.incrementAndGet() == 1 ? "问题一？问题二？" : "请说明你亲自实现的并发约束？", "topic", "并发约束");
      }
    };
    var result = model.checkedQuestion("只问一题", new LinkedHashMap<>(), new LinkedHashMap<>(), false);
    assertEquals(2, calls.get()); assertEquals("请说明你亲自实现的并发约束？", result.question());
    assertEquals(Long.MAX_VALUE, model.questionDeadline.get());
  }
  @Test void persistentInvalidOutputStopsAfterTwoAttempts() {
    var calls = new AtomicInteger();
    var model = new ModelService(null, "demo", "https://example.invalid", "", "", "test") {
      @Override Map<String, Object> call(String rule, Object input) { calls.incrementAndGet(); return Map.of("question", "甲？乙？", "topic", "边界"); }
    };
    assertThrows(org.springframework.web.server.ResponseStatusException.class,
      () -> model.checkedQuestion("只问一题", new LinkedHashMap<>(), new LinkedHashMap<>(), false));
    assertEquals(2, calls.get());
  }

  @Test void anUnavailableModelCanStartKnownExamplesEvenWhenTheQuestionBankHasBeenPracticed() {
    var model = new ModelService(null, "live", "https://example.invalid", "synthetic-key", "test-model", "test") {
      @Override Map<String, Object> call(String rule, Object input) { throw Store.error(503, "合成模型暂不可用"); }
    };
    var practice = new LinkedHashMap<String, Object>(Map.of("example", true, "exampleScenario", "booking",
      "exampleRoundNumber", 3, "kind", "PRACTICE", "maxTurns", 5, "project", Map.of()));
    var seeds = ExampleQuestions.fallbackFor(practice);
    var history = seeds.stream().map(seed -> Map.<String, Object>of("question", seed.question(), "topic", seed.topic(),
      "outcome", PracticeRoundHistory.ANSWERED_INDEPENDENTLY)).toList();
    practice.put("practiceHistory", history);
    assertEquals(seeds.get(2), model.firstDeepQuestion(practice));

    practice.put("interviewTopic", "未提供材料的专题");
    assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> model.firstDeepQuestion(practice));
  }
}
