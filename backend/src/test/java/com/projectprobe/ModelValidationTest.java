package com.projectprobe;

import static com.projectprobe.Store.*;
import static org.junit.jupiter.api.Assertions.*;

import java.util.*;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.web.server.ResponseStatusException;

@SpringBootTest(
  properties = {
    "spring.datasource.url=${PROBE_TEST_DB_URL:jdbc:h2:mem:model-validation;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1}",
    "spring.datasource.username=${PROBE_TEST_DB_USER:sa}",
    "spring.datasource.password=${PROBE_TEST_DB_PASSWORD:}",
    "app.model-mode=demo",
    "app.payment.mode=mock",
    "app.payment.reconcile-enabled=false",
  }
)
class ModelValidationTest {

  @Autowired
  Store s;

  @Autowired
  ProjectService projects;

  @Autowired
  PaymentService payments;

  @Autowired
  TrainingService trainings;

  static Map<String, Object> valid() {
    return new LinkedHashMap<>(
      Map.of(
        "clearParts",
        List.of("表达有边界"),
        "retestTopics",
        List.of("验证方法"),
        "findings",
        new ArrayList<>(
          List.of(
            new LinkedHashMap<>(
              Map.of(
                "topic",
                "验证方法",
                "assessment",
                "缺少观察证据",
                "task",
                "补充故障用例",
                "turnIds",
                List.of("turn-1"),
                "factIds",
                List.of("fact-1")
              )
            )
          )
        )
      )
    );
  }

  static Stream<Map<String, Object>> invalidReports() {
    var cases = new ArrayList<Map<String, Object>>();
    for (String field : List.of("clearParts", "findings", "retestTopics")) {
      var missing = valid();
      missing.remove(field);
      cases.add(missing);
      for (Object bad : Arrays.asList(null, "wrong", 1, Map.of())) {
        var m = valid();
        m.put(field, bad);
        cases.add(m);
      }
    }
    for (Object bad : Arrays.asList(null, "finding", 12, List.of(), Map.of())) {
      var m = valid();
      m.put("findings", Collections.singletonList(bad));
      cases.add(m);
    }
    for (String field : List.of(
      "topic",
      "assessment",
      "task",
      "turnIds",
      "factIds"
    )) {
      var missing = valid();
      finding(missing).remove(field);
      cases.add(missing);
      for (Object bad : Arrays.asList(
        null,
        42,
        Map.of(),
        field.endsWith("Ids") ? "wrong" : List.of()
      )) {
        var m = valid();
        finding(m).put(field, bad);
        cases.add(m);
      }
    }
    for (String field : List.of("clearParts", "retestTopics")) {
      for (Object bad : Arrays.asList(null, 42, " ", "x".repeat(3001))) {
        var m = valid();
        m.put(field, Collections.singletonList(bad));
        cases.add(m);
      }
      var m = valid();
      m.put(field, Collections.nCopies(9, "x"));
      cases.add(m);
    }
    for (String field : List.of("turnIds", "factIds")) {
      for (Object bad : Arrays.asList(
        null,
        42,
        " ",
        "x".repeat(37),
        "fabricated-id"
      )) {
        var m = valid();
        finding(m).put(field, Collections.singletonList(bad));
        cases.add(m);
      }
      var m = valid();
      finding(m).put(field, Collections.nCopies(11, "turn-1"));
      cases.add(m);
    }
    for (String field : List.of("topic", "assessment", "task")) {
      var m = valid();
      finding(m).put(field, " ");
      cases.add(m);
      m = valid();
      finding(m).put(field, "x".repeat(3001));
      cases.add(m);
    }
    var emptyRefs = valid();
    finding(emptyRefs).put("turnIds", List.of());
    cases.add(emptyRefs);
    var tooMany = valid();
    tooMany.put("findings", Collections.nCopies(7, finding(valid())));
    cases.add(tooMany);
    return cases.stream();
  }

  static Map<String, Object> finding(Map<String, Object> m) {
    return (Map<String, Object>) ((List<?>) m.get("findings")).get(0);
  }

  ModelService fake(Map<String, Object> output) {
    return new ModelService(
      s,
      "live",
      "https://never-called.invalid",
      "synthetic",
      "synthetic",
      "test"
    ) {
      @Override
      Map<String, Object> call(String rule, Object data) {
        return output;
      }
    };
  }

  Map<String, Object> body() {
    return new HashMap<>(
      Map.of(
        "project",
        new HashMap<>(
          Map.of("facts", List.of(Map.of("id", "fact-1", "text", "合成材料")))
        ),
        "turns",
        List.of(
          Map.of(
            "id",
            "turn-1",
            "answer",
            "用户真实原文",
            "question",
            "合成问题"
          )
        )
      )
    );
  }

  @ParameterizedTest
  @MethodSource("invalidReports")
  void malformedReportsFail(Map<String, Object> output) {
    assertEquals(
      503,
      assertThrows(ResponseStatusException.class, () ->
        fake(output).report(body())
      )
        .getStatusCode()
        .value()
    );
  }

  @Test
  void validAndExplicitEmptyArraysSucceed() {
    var report = fake(valid()).report(body());
    assertEquals(
      "用户真实原文",
      list(list(report, "findings").get(0), "evidence").get(0).get("quote")
    );
    var empty = Map.<String, Object>of(
      "clearParts",
      List.of(),
      "findings",
      List.of(),
      "retestTopics",
      List.of()
    );
    assertTrue(list(fake(empty).report(body()), "findings").isEmpty());
    var noAnswers = body();
    noAnswers.put("turns", List.of());
    assertTrue(list(fake(empty).report(noAnswers), "findings").isEmpty());
  }

  @Test void modelCannotMarkItsOwnConclusionsAsIndependentlyVerified() {
    var output = valid();
    finding(output).put("independentlyVerified", true);
    finding(output).put("supportExplanation", "原回答没有给出测试结果，建议补充可观察的断言。");
    var result = list(fake(output).report(body()), "findings").get(0);
    assertFalse(result.containsKey("independentlyVerified"));
    assertEquals("SOURCE_CHECKED_NEEDS_REVIEW", result.get("evidenceStatus"));
    assertEquals(1, result.get("priority"));
    assertTrue(str(result, "supportExplanation").contains("原回答"));
  }

  @Test
  void localEvidenceReferencesResolveExactlyAndRejectUnknownOrUnansweredIds() {
    var output = valid();
    finding(output).put("turnIds", List.of("T1"));
    finding(output).put("factIds", List.of("F1"));
    var result = list(fake(output).report(body()), "findings").get(0);
    assertEquals(List.of("turn-1"), result.get("turnIds"));
    assertEquals(List.of("fact-1"), result.get("factIds"));
    assertEquals("用户真实原文", list(result, "evidence").get(0).get("quote"));
    for (String invalid : List.of("T2", "F1", "t1", "T01")) {
      var bad = valid();
      finding(bad).put("turnIds", List.of(invalid));
      assertThrows(ResponseStatusException.class, () ->
        fake(bad).report(body())
      );
    }
    var badFact = valid();
    finding(badFact).put("factIds", List.of("F2"));
    assertThrows(ResponseStatusException.class, () ->
      fake(badFact).report(body())
    );
    var noAnswers = body();
    noAnswers.put(
      "turns",
      List.of(Map.of("id", "unanswered", "answer", "", "question", "尚未回答"))
    );
    var unanswered = valid();
    finding(unanswered).put("turnIds", List.of("T1"));
    assertThrows(ResponseStatusException.class, () ->
      fake(unanswered).report(noAnswers)
    );
  }

  @Test
  void parserRejectsInvalidRootDuplicatesAndTrailingContent() {
    for (String raw : List.of(
      "null",
      "[]",
      "42",
      "broken",
      "{\"findings\":[],\"findings\":[]}",
      "{} {}"
    ))
      assertThrows(ResponseStatusException.class, () -> s.decodeModel(raw));
    assertEquals(List.of(), s.decodeModel("{\"findings\":[]}").get("findings"));
    var internal = new HashMap<String, Object>();
    assertTrue(list(internal, "turns").isEmpty());
    var external = new HashMap<String, Object>();
    assertThrows(ResponseStatusException.class, () ->
      modelObjects(external, "findings", 6)
    );
    assertFalse(external.containsKey("findings"));
  }

  @Test
  void factsAndQuestionsAreStrict() {
    var p = Map.<String, Object>of("responsibility", "我负责接口");
    for (Map<String, Object> output : List.of(
      Map.<String, Object>of(),
      Map.<String, Object>of("facts", List.of(1)),
      Map.<String, Object>of(
        "facts",
        List.of(
          Map.of(
            "text",
            42,
            "sourceField",
            "responsibility",
            "quote",
            "我负责",
            "source",
            "AI_INFERENCE"
          )
        )
      )
    ))
      assertThrows(ResponseStatusException.class, () ->
        fake(output).extract(p)
      );
    assertFalse(fake(Map.of("facts", List.of())).extract(p).isEmpty());
    var qbody = body();
    for (Map<String, Object> output : List.of(
      Map.<String, Object>of(),
      Map.<String, Object>of("question", 42, "topic", "职责"),
      Map.<String, Object>of("question", "合法问题"),
      Map.<String, Object>of("question", "合成问题", "topic", "重复")
    ))
      assertThrows(ResponseStatusException.class, () ->
        fake(output).question(qbody)
      );
    assertEquals(
      "职责",
      fake(Map.of("question", "请具体解释个人职责？", "topic", "职责"))
        .question(qbody)
        .topic()
    );
  }

  @Test
  void questionDeduplicationIgnoresFormattingButPreservesChangedNumbers() {
    var b = body();
    b.put(
      "turns",
      List.of(
        Map.of("question", "请说明 API 的超时设置？", "answer", "合成回答")
      )
    );
    assertThrows(ResponseStatusException.class, () ->
      fake(
        Map.of("question", "请说明ａｐｉ的超时设置!", "topic", "超时")
      ).question(b)
    );
    b.put(
      "turns",
      List.of(
        Map.of("question", "超时为 1.5 秒时如何处理？", "answer", "合成回答")
      )
    );
    assertDoesNotThrow(() ->
      fake(
        Map.of("question", "超时为 15 秒时如何处理？", "topic", "超时")
      ).question(b)
    );
    b.put(
      "turns",
      List.of(
        Map.of("question", "输入为 -1 时如何处理？", "answer", "合成回答")
      )
    );
    assertDoesNotThrow(() ->
      fake(
        Map.of("question", "输入为 1 时如何处理？", "topic", "边界")
      ).question(b)
    );
  }

  @Test
  void missingReportDoesNotCompleteAndCanRetryOrRefund() {
    String u = id();
    s.db.update(
      "INSERT INTO app_users VALUES (?,?,?,?)",
      u,
      "schema-" + u,
      "unused",
      now()
    );
    var p = projects.save(
      u,
      null,
      Map.of("name", "合成项目", "responsibility", "我负责接口")
    );
    p = projects.extract(u, str(p, "id"));
    p = projects.confirm(u, str(p, "id"), p);
    var order = payments.create(u, Map.of("requestKey", id()));
    payments.mock(u, str(order, "id"));
    var t = trainings.start(
      u,
      Map.of("projectId", p.get("id"), "requestKey", id())
    );
    String tid = str(t, "id");
    var saved = s.decode(trainings.row(u, tid).get("body"));
    list(saved, "turns").get(0).put("answer", "原回答不能丢失");
    saved.put("operation", "REPORT");
    trainings.update(tid, "PENDING", saved);
    var bad = new TrainingService(
      s,
      projects,
      fake(Map.of("clearParts", List.of(), "retestTopics", List.of()))
    );
    assertThrows(ResponseStatusException.class, () -> bad.generate(u, tid));
    var failed = trainings.get(u, tid);
    assertEquals("FAILED", failed.get("status"));
    assertFalse(failed.containsKey("report"));
    assertEquals("原回答不能丢失", list(failed, "turns").get(0).get("answer"));
    var recovered = new TrainingService(
      s,
      projects,
      fake(
        Map.of(
          "clearParts",
          List.of(),
          "findings",
          List.of(),
          "retestTopics",
          List.of()
        )
      )
    ).generate(u, tid);
    assertEquals("COMPLETED", recovered.get("status"));
    payments.mock(u, str(payments.create(u, Map.of("requestKey", id())), "id"));
    var another = trainings.start(
      u,
      Map.of("projectId", p.get("id"), "requestKey", id())
    );
    String otherId = str(another, "id");
    another.put("operation", "REPORT");
    trainings.update(otherId, "PENDING", another);
    assertThrows(ResponseStatusException.class, () -> bad.generate(u, otherId));
    assertEquals("REFUNDED", trainings.refund(u, otherId).get("status"));
  }
}
