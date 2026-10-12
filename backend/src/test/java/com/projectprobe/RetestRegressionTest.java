package com.projectprobe;

import static com.projectprobe.Store.*;
import static org.junit.jupiter.api.Assertions.*;

import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.web.server.ResponseStatusException;

@SpringBootTest(
  properties = {
    "spring.datasource.url=${PROBE_TEST_DB_URL:jdbc:h2:mem:retest-regression;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1}",
    "spring.datasource.username=${PROBE_TEST_DB_USER:sa}",
    "spring.datasource.password=${PROBE_TEST_DB_PASSWORD:}",
    "app.model-mode=demo",
    "app.payment.mode=mock",
    "app.payment.reconcile-enabled=false",
  }
)
class RetestRegressionTest {

  @Autowired
  Store s;

  @Autowired
  ProjectService projects;

  @Autowired
  TrainingService trainings;

  @Autowired
  PaymentService payments;

  @Autowired
  ModelService model;

  record Scenario(
    String user,
    Map<String, Object> project,
    Map<String, Object> deep
  ) {}

  Scenario scenario(String topic) {
    String u = id();
    s.db.update(
      "INSERT INTO app_users VALUES (?,?,?,?)",
      u,
      "retest-" + u,
      "unused",
      now()
    );
    var p = projects.save(
      u,
      null,
      Map.of(
        "name",
        "合成项目",
        "responsibility",
        "我负责接口",
        "verification",
        "修订后的验证材料"
      )
    );
    p = projects.extract(u, str(p, "id"));
    p = projects.confirm(u, str(p, "id"), p);
    payments.mock(u, str(payments.create(u, Map.of("requestKey", id())), "id"));
    var deep = trainings.start(
      u,
      Map.of("projectId", p.get("id"), "requestKey", id())
    );
    String deepId = str(deep, "id");
    var body = s.decode(trainings.row(u, deepId).get("body"));
    list(body, "turns").get(0).put("answer", "上轮合成原回答");
    body.put(
      "report",
      Map.of(
        "clearParts",
        List.of(),
        "findings",
        List.of(
          Map.of(
            "topic",
            topic,
            "assessment",
            "具体薄弱点",
            "task",
            "补充解释",
            "turnIds",
            List.of(list(body, "turns").get(0).get("id")),
            "factIds",
            List.of()
          )
        ),
        "retestTopics",
        List.of(topic)
      )
    );
    trainings.update(deepId, "COMPLETED", body);
    return new Scenario(u, p, trainings.get(u, deepId));
  }

  Map<String, Object> input(Scenario f, String key) {
    return Map.of(
      "projectId",
      f.project.get("id"),
      "parentId",
      f.deep.get("id"),
      "requestKey",
      key
    );
  }

  @Test
  void demoFirstQuestionsMatchWeaknessCategories() {
    for (var entry : Map.of(
      "个人职责",
      "交接",
      "验证方法",
      "测试环境",
      "异常处理",
      "响应丢失"
    ).entrySet()) {
      var f = scenario(entry.getKey());
      var t = trainings.start(f.user, input(f, id()));
      var turn = list(t, "turns").get(0);
      assertEquals(entry.getKey(), turn.get("topic"));
      assertTrue(str(turn, "question").contains(entry.getValue()));
      assertFalse(str(turn, "question").contains("双实例"));
      t = trainings.answer(
        f.user,
        str(t, "id"),
        Map.of("turnId", turn.get("id"), "answer", "本轮相关回答")
      );
      assertEquals(entry.getKey(), list(t, "turns").get(1).get("topic"));
    }
  }

  @Test
  void liveFirstQuestionReceivesPriorEvidenceAndRevisedMaterialAndMatchingLabel() {
    var f = scenario("验证方法");
    var calls = new AtomicInteger();
    var live = new ModelService(
      s,
      "live",
      "https://never-called.invalid",
      "synthetic",
      "synthetic",
      "test"
    ) {
      @Override
      Map<String, Object> call(String rule, Object data) {
        calls.incrementAndGet();
        var body = (Map<String, Object>) data;
        assertEquals("验证方法", body.get("focus"));
        assertTrue(
          s.encode(body.get("previousTurns")).contains("上轮合成原回答")
        );
        assertTrue(s.encode(body.get("project")).contains("修订后的验证材料"));
        assertNotNull(body.get("previousReport"));
        assertNotNull(body.get("retestTarget"));
        return Map.of(
          "question",
          "假设只能观察接口返回，你如何验证修订后的实现？",
          "topic",
          "验证方法",
          "changedCondition",
          "只能观察接口返回"
        );
      }
    };
    var service = new TrainingService(s, projects, live);
    var t = service.start(f.user, input(f, "first"));
    assertEquals("ACTIVE", t.get("status"));
    assertEquals("验证方法", list(t, "turns").get(0).get("topic"));
    assertEquals(
      t.get("id"),
      service.start(f.user, input(f, "second-key")).get("id")
    );
    assertEquals(1, calls.get());
  }

  @Test
  void firstQuestionFailureIsPersistedRetryableAndReturningAllowsNewAttempt() {
    var f = scenario("个人职责");
    var calls = new AtomicInteger();
    var broken = new ModelService(
      s,
      "demo",
      "https://never-called.invalid",
      "",
      "",
      "test"
    ) {
      @Override
      GeneratedQuestion firstRetestQuestion(Map<String, Object> body) {
        calls.incrementAndGet();
        throw new IllegalStateException("synthetic failure");
      }
    };
    var service = new TrainingService(s, projects, broken);
    var t = service.start(f.user, input(f, "first"));
    String tid = str(t, "id");
    assertEquals("FAILED", t.get("status"));
    assertTrue(list(t, "turns").isEmpty());
    assertEquals(
      "CONTINUE",
      (
        (Map<?, ?>) trainings.get(f.user, str(f.deep, "id")).get("retestEntry")
      ).get("state")
    );
    assertEquals(tid, service.start(f.user, input(f, "first")).get("id"));
    assertEquals(tid, service.start(f.user, input(f, "different")).get("id"));
    assertEquals(1, calls.get());
    var active = trainings.generate(f.user, tid);
    assertEquals("ACTIVE", active.get("status"));
    assertEquals(1, list(active, "turns").size());
    active = trainings.answer(
      f.user,
      tid,
      Map.of(
        "turnId",
        list(active, "turns").get(0).get("id"),
        "answer",
        "本轮原回答需保存"
      )
    );
    active.put("operation", "QUESTION");
    trainings.update(tid, "FAILED", active);
    trainings.refund(f.user, tid);
    var entry = (Map<?, ?>) trainings
      .get(f.user, str(f.deep, "id"))
      .get("retestEntry");
    assertEquals("AVAILABLE", entry.get("state"));
    assertEquals(true, entry.get("returned"));
    var again = trainings.start(f.user, input(f, id()));
    assertNotEquals(tid, again.get("id"));
    assertEquals(
      "本轮原回答需保存",
      list(trainings.get(f.user, tid), "turns").get(0).get("answer")
    );
    assertEquals(
      2,
      s.db.queryForObject(
        "SELECT COUNT(*) FROM entitlement_events WHERE package_id=? AND event_type='RESERVED' AND training_id<>?",
        Integer.class,
        again.get("packageId"),
        f.deep.get("id")
      )
    );
  }

  @Test
  void concurrentStartsReserveOneRetestAndReturnExistingTraining()
    throws Exception {
    var f = scenario("异常处理");
    var pool = Executors.newFixedThreadPool(8);
    try {
      var futures = new ArrayList<Future<Map<String, Object>>>();
      for (int i = 0; i < 8; i++) futures.add(
        pool.submit(() -> trainings.start(f.user, input(f, id())))
      );
      var ids = new HashSet<String>();
      for (var future : futures)
        ids.add(str(future.get(20, TimeUnit.SECONDS), "id"));
      assertEquals(1, ids.size());
      assertEquals(
        1,
        s.db.queryForObject(
          "SELECT COUNT(*) FROM trainings WHERE parent_id=?",
          Integer.class,
          f.deep.get("id")
        )
      );
      var t = trainings.get(f.user, ids.iterator().next());
      assertEquals(1, list(t, "turns").size());
    } finally {
      pool.shutdownNow();
    }
  }

  @Test
  void completedEntryAndExactParentPackageAssociation() {
    var f = scenario("验证方法");
    var t = trainings.start(f.user, input(f, id()));
    trainings.finish(f.user, str(t, "id"));
    var entry = (Map<?, ?>) trainings
      .get(f.user, str(f.deep, "id"))
      .get("retestEntry");
    assertEquals("COMPLETED", entry.get("state"));
    assertEquals(t.get("id"), entry.get("trainingId"));
    assertEquals(
      t.get("id"),
      trainings.start(f.user, input(f, id())).get("id")
    );
    payments.mock(
      f.user,
      str(payments.create(f.user, Map.of("requestKey", id())), "id")
    );
    var other = trainings.start(
      f.user,
      Map.of("projectId", f.project.get("id"), "requestKey", id())
    );
    trainings.finish(f.user, str(other, "id"));
    assertEquals(
      "AVAILABLE",
      (
        (Map<?, ?>) trainings.get(f.user, str(other, "id")).get("retestEntry")
      ).get("state")
    );
    var unauthorized = scenario("验证方法");
    assertThrows(ResponseStatusException.class, () ->
      trainings.start(unauthorized.user, input(f, id()))
    );
  }

  @Test
  void missingTopicsFallBackAndRepeatedOrMismatchedModelQuestionsFail() {
    var body = new HashMap<String, Object>();
    body.put("report", Map.of("retestTopics", List.of(" ")));
    assertEquals("验证方法", model.retestTarget(body).get("topic"));
    var f = scenario("验证方法");
    var snapshot = new HashMap<>(
      Map.of(
        "focus",
        "验证方法",
        "project",
        f.project,
        "turns",
        List.of(),
        "previousTurns",
        List.of(Map.of("question", "假设只能观察接口返回，你怎么验证？"))
      )
    );
    for (var output : List.of(
      Map.of(
        "question",
        "假设只能观察接口返回，你怎么验证？",
        "topic",
        "验证方法",
        "changedCondition",
        "只能观察接口返回"
      ),
      Map.of("question", "新问题？", "topic", "职责", "changedCondition", "新"),
      Map.of(
        "question",
        "新问题？",
        "topic",
        "验证方法",
        "changedCondition",
        "不存在的约束"
      )
    )) {
      var fake = new ModelService(
        s,
        "live",
        "https://never-called.invalid",
        "synthetic",
        "synthetic",
        "test"
      ) {
        @Override
        Map<String, Object> call(String rule, Object data) {
          return new LinkedHashMap<String, Object>(output);
        }
      };
      assertThrows(ResponseStatusException.class, () ->
        fake.firstRetestQuestion(snapshot)
      );
    }
  }
}
