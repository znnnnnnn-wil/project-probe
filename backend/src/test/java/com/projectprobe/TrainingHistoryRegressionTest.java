package com.projectprobe;

import static com.projectprobe.Store.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(
  properties = {
    "spring.datasource.url=jdbc:h2:mem:history-tests;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
    "app.model-mode=demo",
    "app.payment.mode=mock",
  }
)
class TrainingHistoryRegressionTest {

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

  String user() {
    String user = id();
    s.db.update(
      "INSERT INTO app_users VALUES (?,?,?,?)",
      user,
      "history-" + user,
      "unused",
      now()
    );
    var order = payments.create(user, Map.of("requestKey", id()));
    payments.mock(user, str(order, "id"));
    return user;
  }

  Map<String, Object> project(String user) {
    var p = projects.save(
      user,
      null,
      Map.of(
        "name",
        "合成预约项目",
        "responsibility",
        "我负责接口",
        "resume",
        "合成预约项目：我负责预约接口和并发验证。"
      )
    );
    p = projects.extract(user, str(p, "id"));
    return projects.confirm(
      user,
      str(p, "id"),
      new HashMap<>(
        Map.of("version", p.get("version"), "facts", p.get("facts"))
      )
    );
  }

  Map<String, Object> start(
    TrainingService service,
    String user,
    Map<String, Object> p
  ) {
    return service.start(
      user,
      Map.of("projectId", p.get("id"), "requestKey", id())
    );
  }

  @Test
  void successiveRoundsKeepOriginalQuestionsAndAnswers() {
    String user = user();
    var p = project(user);
    var first = start(trainings, user, p);
    var firstTurn = list(first, "turns").get(0);
    first = trainings.answer(
      user,
      str(first, "id"),
      Map.of(
        "turnId",
        firstTurn.get("id"),
        "answer",
        "我负责接口，验证结果待补充。"
      )
    );
    var second = start(trainings, user, p);
    assertNotEquals(
      firstTurn.get("question"),
      list(second, "turns").get(0).get("question")
    );
    assertEquals(
      "我负责接口，验证结果待补充。",
      list(trainings.get(user, str(first, "id")), "turns")
        .get(0)
        .get("answer")
    );
    assertTrue(
      list(second, "historyTurns")
        .stream()
        .anyMatch(t -> "我负责接口，验证结果待补充。".equals(t.get("answer")))
    );
    assertTrue(list(second, "interviewFacts").isEmpty());
    Object submittedAt = list(first, "turns").get(0).get("answeredAt");
    var retried = trainings.answer(
      user,
      str(first, "id"),
      Map.of(
        "turnId",
        firstTurn.get("id"),
        "answer",
        "我负责接口，验证结果待补充。"
      )
    );
    assertEquals(submittedAt, list(retried, "turns").get(0).get("answeredAt"));
    assertThrows(
      org.springframework.web.server.ResponseStatusException.class,
      () ->
        trainings.answer(
          user,
          str(retried, "id"),
          Map.of("turnId", firstTurn.get("id"), "answer", "覆盖旧回答")
        )
    );
    assertEquals(2, list(retried, "turns").size());
  }

  @Test
  void trainingPagesAreScopedBoundedAndKeepRetestChildrenOutsidePage() {
    String user = user();
    var p = project(user);
    var deep = start(trainings, user, p);
    deep = trainings.finish(user, str(deep, "id"));
    var retest = trainings.start(
      user,
      Map.of(
        "projectId",
        p.get("id"),
        "parentId",
        deep.get("id"),
        "requestKey",
        id()
      )
    );
    s.db.update(
      "UPDATE trainings SET created_at=? WHERE id=?",
      now() + 1000,
      deep.get("id")
    );
    var catalog = new TrainingCatalog(s, payments);
    var first = catalog.page(user, 0, 1, "", "");
    assertEquals(2, first.total());
    assertTrue(first.hasMore());
    assertEquals(deep.get("id"), first.items().get(0).get("id"));
    assertEquals(
      trainings.get(user, str(deep, "id")).get("retestEntry"),
      first.items().get(0).get("retestEntry")
    );
    var second = catalog.page(user, 1, 1, "", "");
    assertFalse(second.hasMore());
    assertEquals(retest.get("id"), second.items().get(0).get("id"));
    assertEquals(
      2,
      catalog.page(user, 0, 20, str(deep, "historyKey"), "").total()
    );
    assertEquals(
      0,
      catalog.page(user(), 0, 20, str(deep, "historyKey"), "").total()
    );
    assertEquals(1, catalog.choices(user).size());
    var overview = catalog.overview(user);
    assertEquals(1L, ((Number) overview.get("activeCount")).longValue());
    assertEquals(1L, ((Number) overview.get("completedCount")).longValue());
    assertEquals(2, ((List<?>) overview.get("items")).size());
    assertThrows(
      org.springframework.web.server.ResponseStatusException.class,
      () -> catalog.page(user, -1, 20, "", "")
    );
    assertThrows(
      org.springframework.web.server.ResponseStatusException.class,
      () -> catalog.page(user, 0, 101, "", "")
    );
  }

  @Test
  void summariesMatchDetailsWithoutReturningMaterialsAndKeepRetestState() {
    String user = user();
    var p = project(user);
    var deep = start(trainings, user, p);
    deep = trainings.answer(
      user,
      str(deep, "id"),
      Map.of(
        "turnId",
        list(deep, "turns").get(0).get("id"),
        "answer",
        "我用合成并发请求验证了冲突，具体证据待补充。"
      )
    );
    deep = trainings.finish(user, str(deep, "id"));
    String deepId = str(deep, "id");
    String original = str(
      s.one("SELECT body FROM trainings WHERE id=?", deepId),
      "body"
    );
    assertEquals(projects.get(user, str(p, "id")), projects.all(user).get(0));
    for (int step = 0; step < 3; step++) {
      var detailed = trainings
        .all(user)
        .stream()
        .filter(t -> deepId.equals(t.get("id")))
        .findFirst()
        .orElseThrow();
      var summary = trainings
        .all(user, true)
        .stream()
        .filter(t -> deepId.equals(t.get("id")))
        .findFirst()
        .orElseThrow();
      assertEquals(
        trainings.get(user, deepId).get("retestEntry"),
        summary.get("retestEntry")
      );
      assertEquals(detailed.get("retestEntry"), summary.get("retestEntry"));
      assertEquals(1L, summary.get("answeredCount"));
      assertEquals(
        Map.of("id", p.get("id"), "name", p.get("name")),
        summary.get("project")
      );
      for (String field : List.of(
        "turns",
        "historyTurns",
        "trainingHistory",
        "previousProject",
        "report"
      ))
        assertFalse(summary.containsKey(field));
      assertEquals(
        original,
        str(s.one("SELECT body FROM trainings WHERE id=?", deepId), "body")
      );
      if (step == 0) trainings.start(
        user,
        Map.of(
          "kind",
          "RETEST",
          "projectId",
          p.get("id"),
          "parentId",
          deepId,
          "requestKey",
          id()
        )
      );
      if (step == 1) {
        var retest = trainings
          .all(user)
          .stream()
          .filter(t -> "RETEST".equals(t.get("kind")))
          .findFirst()
          .orElseThrow();
        trainings.finish(user, str(retest, "id"));
      }
    }
    assertTrue(trainings.all(user(), true).isEmpty());
  }

  @Test
  void reimportedSameProjectSharesHistoryButAnotherAccountDoesNot() {
    String user = user();
    var p = project(user);
    var first = start(trainings, user, p);
    var imported = project(user);
    var second = start(trainings, user, imported);
    assertNotEquals(p.get("id"), imported.get("id"));
    assertEquals(first.get("historyKey"), second.get("historyKey"));
    assertNotEquals(
      list(first, "turns").get(0).get("question"),
      list(second, "turns").get(0).get("question")
    );
    assertFalse(list(second, "historyTurns").isEmpty());
    String other = user();
    var otherProject = project(other);
    var isolated = start(trainings, other, otherProject);
    assertTrue(list(isolated, "historyTurns").isEmpty());
    assertEquals(1, isolated.get("historyRoundNumber"));
    assertThrows(
      org.springframework.web.server.ResponseStatusException.class,
      () -> trainings.get(other, str(first, "id"))
    );
  }

  @Test
  void legacyHistoryBackfillDoesNotRewriteOriginalBody() {
    String user = user();
    var p = project(user);
    var first = start(trainings, user, p);
    String training = str(first, "id");
    s.db.update(
      "DELETE FROM training_question_index WHERE training_id=?",
      training
    );
    s.db.update("UPDATE trainings SET history_key=NULL WHERE id=?", training);
    Object original = s
      .one("SELECT body FROM trainings WHERE id=?", training)
      .get("body");
    var second = start(trainings, user, p);
    assertEquals(
      original,
      s.one("SELECT body FROM trainings WHERE id=?", training).get("body")
    );
    assertEquals(
      1,
      s.db.queryForObject(
        "SELECT COUNT(*) FROM training_question_index WHERE training_id=?",
        Integer.class,
        training
      )
    );
    assertFalse(list(second, "historyTurns").isEmpty());
  }

  @Test
  void duplicateQuestionIsRejectedWithoutSavingAndRetryDoesNotConsumeAgain() {
    String user = user();
    var p = project(user);
    var first = start(trainings, user, p);
    var fake = spy(model);
    doReturn(
      new ModelService.GeneratedQuestion(
        str(list(first, "turns").get(0), "question"),
        "重复主题"
      )
    )
      .when(fake)
      .firstDeepQuestion(anyMap());
    var service = new TrainingService(s, projects, fake, payments);
    var failed = start(service, user, p);
    assertEquals("FAILED", failed.get("status"));
    assertTrue(list(failed, "turns").isEmpty());
    int used = (
      (Number) payments.packages(user).get(0).get("training_used")
    ).intValue();
    doReturn(
      new ModelService.GeneratedQuestion(
        "请说明一个尚未解释的错误恢复边界？",
        "错误恢复"
      )
    )
      .when(fake)
      .firstDeepQuestion(anyMap());
    var recovered = service.generate(user, str(failed, "id"));
    assertEquals("ACTIVE", recovered.get("status"));
    assertEquals(1, list(recovered, "turns").size());
    assertEquals(
      used,
      ((Number) payments.packages(user).get(0).get("training_used")).intValue()
    );
  }

  @Test
  void fullAnswersAreSavedEvenWhenModelContextIsTruncated() {
    String user = user();
    var p = project(user);
    var first = start(trainings, user, p);
    String answer = "我负责接口，验证结果尚待补充。".repeat(180);
    trainings.answer(
      user,
      str(first, "id"),
      Map.of("turnId", list(first, "turns").get(0).get("id"), "answer", answer)
    );
    var second = start(trainings, user, p);
    var prior = list(second, "historyTurns")
      .stream()
      .filter(t -> !str(t, "answer").isBlank())
      .findFirst()
      .orElseThrow();
    assertEquals(1500, str(prior, "answer").length());
    assertEquals(true, prior.get("answerTruncated"));
    assertEquals(
      answer,
      list(trainings.get(user, str(first, "id")), "turns")
        .get(0)
        .get("answer")
    );
    assertTrue(list(second, "interviewFacts").isEmpty());
  }

  @Test
  void liveFirstQuestionUsesModelAndOwnHistoricalContext() {
    String user = user();
    var p = project(user);
    var first = start(trainings, user, p);
    trainings.answer(
      user,
      str(first, "id"),
      Map.of(
        "turnId",
        list(first, "turns").get(0).get("id"),
        "answer",
        "合成历史回答，重试边界待解释。"
      )
    );
    var live = spy(
      new ModelService(
        s,
        "live",
        "https://model.example/v1",
        "synthetic-key",
        "synthetic-model",
        "DashScope"
      )
    );
    doReturn(
      Map.of(
        "question",
        "请解释历史回答尚未说明的重试边界？",
        "topic",
        "重试边界"
      )
    )
      .when(live)
      .call(anyString(), any());
    var next = start(new TrainingService(s, projects, live, payments), user, p);
    assertEquals("ACTIVE", next.get("status"));
    assertEquals(
      "请解释历史回答尚未说明的重试边界？",
      list(next, "turns").get(0).get("question")
    );
    var input = ArgumentCaptor.forClass(Object.class);
    verify(live).call(anyString(), input.capture());
    assertTrue(
      list((Map<String, Object>) input.getValue(), "historyTurns")
        .stream()
        .anyMatch(t -> str(t, "answer").contains("合成历史回答"))
    );
    var template = new LinkedHashMap<>((Map<String, Object>) input.getValue());
    template.put("turns", new ArrayList<>());
    template.put("historyTurns", new ArrayList<>());
    template.put("trainingHistory", new ArrayList<>());
    template.put("historyRoundNumber", 1);
    var rule = ArgumentCaptor.forClass(String.class);
    verify(live).call(rule.capture(), any());
    var directory = java.nio.file.Path.of("target", "test-fixtures");
    try {
      java.nio.file.Files.createDirectories(directory);
      java.nio.file.Files.writeString(
        directory.resolve("history-first-request.json"),
        s.encode(live.requestBody(rule.getValue(), template))
      );
    } catch (java.io.IOException e) {
      throw new IllegalStateException(e);
    }
  }

  @Test
  void concurrentIdenticalQuestionsCannotBothBeCommitted() throws Exception {
    String user = user();
    var p = project(user);
    var fake = spy(model);
    var entered = new CountDownLatch(2);
    var release = new CountDownLatch(1);
    doAnswer(invocation -> {
      entered.countDown();
      assertTrue(release.await(5, TimeUnit.SECONDS));
      return new ModelService.GeneratedQuestion(
        "合成并发首题：如何观察失败结果？",
        "失败边界"
      );
    })
      .when(fake)
      .firstDeepQuestion(anyMap());
    var service = new TrainingService(s, projects, fake, payments);
    var pool = Executors.newFixedThreadPool(2);
    try {
      var a = pool.submit(() -> start(service, user, p));
      var b = pool.submit(() -> start(service, user, p));
      assertTrue(entered.await(5, TimeUnit.SECONDS));
      release.countDown();
      var results = List.of(
        a.get(5, TimeUnit.SECONDS),
        b.get(5, TimeUnit.SECONDS)
      );
      assertEquals(
        1,
        results
          .stream()
          .filter(t -> "ACTIVE".equals(t.get("status")))
          .count()
      );
      assertTrue(
        list(
          results
            .stream()
            .filter(t -> "FAILED".equals(t.get("status")))
            .findFirst()
            .orElseThrow(),
          "turns"
        ).isEmpty()
      );
      assertEquals(
        1,
        s.db.queryForObject(
          "SELECT COUNT(*) FROM training_question_index WHERE user_id=?",
          Integer.class,
          user
        )
      );
    } finally {
      release.countDown();
      pool.shutdownNow();
    }
  }

  @Test
  void oldQuestionsOutsidePromptWindowStillHaveExactDuplicateProtection() {
    String user = user();
    var p = project(user);
    var first = start(trainings, user, p);
    s.db.update(
      "UPDATE trainings SET created_at=? WHERE id=?",
      now() - 86400000,
      first.get("id")
    );
    for (int i = 0; i < 7; i++) assertEquals(
      "ACTIVE",
      start(trainings, user, p).get("status")
    );
    var fake = spy(model);
    doReturn(
      new ModelService.GeneratedQuestion(
        str(list(first, "turns").get(0), "question"),
        "重复首题"
      )
    )
      .when(fake)
      .firstDeepQuestion(anyMap());
    var failed = start(
      new TrainingService(s, projects, fake, payments),
      user,
      p
    );
    assertEquals("FAILED", failed.get("status"));
    assertTrue(list(failed, "turns").isEmpty());
    assertTrue(
      list(failed, "historyTurns")
        .stream()
        .noneMatch(t -> first.get("id").equals(t.get("trainingId")))
    );
  }
}
