package com.projectprobe;

import static com.projectprobe.Store.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.alipay.api.internal.util.AlipaySignature;
import java.security.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.server.ResponseStatusException;

@SpringBootTest(
  properties = {
    "spring.datasource.url=${PROBE_TEST_DB_URL:jdbc:h2:mem:tests;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1}",
    "spring.datasource.username=${PROBE_TEST_DB_USER:sa}",
    "spring.datasource.password=${PROBE_TEST_DB_PASSWORD:}",
    "app.model-mode=demo",
    "app.payment.mode=mock",
    "app.payment.reconcile-enabled=false",
  }
)
@AutoConfigureMockMvc
class WorkflowTest {

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

  @Autowired
  Auth auth;

  @Autowired
  MockMvc mvc;

  String user() {
    String id = id();
    s.db.update(
      "INSERT INTO app_users VALUES (?,?,?,?)",
      id,
      "user-" + id,
      "unused",
      now()
    );
    return id;
  }

  Map<String, Object> project(String user) {
    var p = projects.save(
      user,
      null,
      new HashMap<>(
        Map.of(
          "name",
          "合成预约系统",
          "responsibility",
          "我实现预约接口与唯一约束",
          "implementation",
          "数据库唯一约束保护座位和时间段",
          "verification",
          "两个并发请求仅一笔成功"
        )
      )
    );
    String id = str(p, "id");
    p = projects.extract(user, id);
    return projects.confirm(user, id, p);
  }

  String grant(String user) {
    var order = payments.create(user, Map.of("requestKey", id()));
    // 旧闭环继续验证迁移前的一深挖一复测套餐。
    s.db.update("UPDATE purchase_orders SET product_code='LEGACY_PAIR',training_limit=2 WHERE id=?", order.get("id"));
    payments.mock(user, str(order, "id"));
    return str(order, "id");
  }

  Map<String, Object> grantProduct(String user, String code) {
    var order = payments.create(user, Map.of("requestKey", id(), "productCode", code));
    payments.mock(user, str(order, "id"));
    return order;
  }

  long used(String user) {
    return ((Number) payments.packages(user).get(0).get("training_used")).longValue();
  }

  @Test
  void tenTrainingsShareDeepAndRetestQuotaAndResumeDoesNotCharge() {
    String u = user();
    var p = project(u);
    grantProduct(u, "TEN_TRAININGS");
    var deep = complete(u, start(u, p));
    assertEquals(1, used(u));
    var request = Map.<String, Object>of("projectId", p.get("id"), "parentId", deep.get("id"), "requestKey", id());
    var retest = trainings.start(u, request);
    assertEquals(2, used(u));
    assertEquals(retest.get("id"), trainings.start(u, request).get("id"));
    assertEquals(retest.get("id"), trainings.start(u, new HashMap<>(Map.of("projectId", p.get("id"), "parentId", deep.get("id"), "requestKey", id()))).get("id"));
    assertEquals(2, used(u));
    for (int i = 0; i < 8; i++) start(u, p);
    assertEquals(10, used(u));
    assertEquals(409, assertThrows(ResponseStatusException.class, () -> start(u, p)).getStatusCode().value());
    assertEquals(0L, ((Map<?, ?>)payments.shop(u).get("quota")).get("sharedRemaining"));
  }

  @Test
  void sharedQuotaRefundIsExactlyOnceAndCanBeReused() {
    String u = user();
    var p = project(u);
    grantProduct(u, "TEN_TRAININGS");
    var t = start(u, p);
    assertEquals(1, used(u));
    s.db.update("UPDATE trainings SET status='FAILED' WHERE id=?", t.get("id"));
    trainings.refund(u, str(t, "id"));
    trainings.refund(u, str(t, "id"));
    assertEquals(0, used(u));
    start(u, p);
    assertEquals(1, used(u));
    var deep = complete(u, start(u, p));
    var retest = trainings.start(u, Map.of("projectId", p.get("id"), "parentId", deep.get("id"), "requestKey", id()));
    assertEquals(3, used(u));
    s.db.update("UPDATE trainings SET status='FAILED' WHERE id=?", retest.get("id"));
    trainings.refund(u, str(retest, "id"));
    trainings.refund(u, str(retest, "id"));
    assertEquals(2, used(u));
    assertEquals("AVAILABLE", ((Map<?, ?>)trainings.get(u, str(deep, "id")).get("retestEntry")).get("state"));
  }

  @Test
  void lifetimePriceIsServerDefinedAndUsageIsUnlimited() {
    String u = user();
    var order = payments.create(u, Map.of("requestKey", id(), "productCode", "LIFETIME", "amountCents", 1, "trainingLimit", 9999999));
    assertEquals(999900, order.get("amount_cents"));
    assertEquals(true, order.get("lifetime"));
    payments.mock(u, str(order, "id"));
    payments.mock(u, str(order, "id"));
    assertEquals(1, payments.packages(u).size());
    var p = project(u);
    for (int i = 0; i < 12; i++) start(u, p);
    assertEquals(12, used(u));
    assertEquals(true, ((Map<?, ?>)payments.shop(u).get("quota")).get("unlimited"));
  }

  @Test
  void packageSelectionRejectsUnknownProductsAndReusedKeyForDifferentProduct() {
    String u = user();
    assertEquals(400, assertThrows(ResponseStatusException.class,
      () -> payments.create(u, Map.of("requestKey", id(), "productCode", "LEGACY_PAIR"))).getStatusCode().value());
    String key = id();
    var order = payments.create(u, Map.of("requestKey", key, "productCode", "TEN_TRAININGS"));
    assertEquals(990, order.get("amount_cents"));
    assertEquals(10, order.get("training_limit"));
    assertEquals(order.get("id"), payments.create(u, Map.of("requestKey", key, "productCode", "TEN_TRAININGS")).get("id"));
    assertEquals(409, assertThrows(ResponseStatusException.class,
      () -> payments.create(u, Map.of("requestKey", key, "productCode", "LIFETIME"))).getStatusCode().value());
  }

  @Test
  void concurrentSharedQuotaCannotOverspendTenStarts() throws Exception {
    String u = user();
    var p = project(u);
    grantProduct(u, "TEN_TRAININGS");
    var executor = Executors.newFixedThreadPool(12);
    try {
      var jobs = new ArrayList<Callable<Boolean>>();
      for (int i = 0; i < 18; i++) jobs.add(() -> {
        try { start(u, p); return true; }
        catch (ResponseStatusException e) { assertEquals(409, e.getStatusCode().value()); return false; }
      });
      int successful = 0;
      for (var future : executor.invokeAll(jobs)) if (future.get()) successful++;
      assertEquals(10, successful);
      assertEquals(10, used(u));
    } finally { executor.shutdownNow(); }
  }

  @Test
  void newPackageCanFundRetestFromExhaustedPackage() {
    String u = user();
    var p = project(u);
    var order = grantProduct(u, "TEN_TRAININGS");
    var deep = complete(u, start(u, p));
    for (int i = 0; i < 9; i++) start(u, p);
    assertEquals("UNAVAILABLE", ((Map<?, ?>)trainings.get(u, str(deep, "id")).get("retestEntry")).get("state"));
    grantProduct(u, "TEN_TRAININGS");
    assertEquals("AVAILABLE", ((Map<?, ?>)trainings.get(u, str(deep, "id")).get("retestEntry")).get("state"));
    var retest = trainings.start(u, Map.of("projectId", p.get("id"), "parentId", deep.get("id"), "requestKey", id()));
    assertNotEquals(deep.get("packageId"), retest.get("packageId"));
    assertEquals(10L, ((Number)s.one("SELECT training_used FROM training_packages WHERE order_id=?", order.get("id")).get("training_used")).longValue());
    assertEquals(retest.get("id"), trainings.start(u, Map.of("projectId", p.get("id"), "parentId", deep.get("id"), "requestKey", id())).get("id"));
  }

  Map<String, Object> start(String user, Map<String, Object> p) {
    return trainings.start(
      user,
      Map.of("projectId", p.get("id"), "requestKey", id())
    );
  }

  Map<String, Object> complete(String user, Map<String, Object> training) {
    String id = str(training, "id");
    while (!"COMPLETED".equals(training.get("status"))) {
      var turns = list(training, "turns");
      var t = turns.get(turns.size() - 1);
      training = trainings.answer(
        user,
        id,
        Map.of(
          "turnId",
          t.get("id"),
          "answer",
          "我在数据库中建立唯一约束，并用两个并发请求检查冲突回滚，预期只有一个预约成功。"
        )
      );
    }
    return training;
  }

  @Test
  void completeEvidenceRevisionAndRetest() {
    String u = user();
    var p = project(u);
    grant(u);
    var t = complete(u, start(u, p));
    var report = (Map<String, Object>) t.get("report");
    assertEquals(5, list(report, "findings").size());
    var evidence = list(list(report, "findings").get(0), "evidence");
    assertEquals(
      list(t, "turns").get(0).get("answer"),
      evidence.get(0).get("quote")
    );
    p.put(
      "implementation",
      "改成两个实例，唯一约束仍在数据库生效；解释冲突返回"
    );
    p = projects.save(u, str(p, "id"), p);
    p = projects.extract(u, str(p, "id"));
    p = projects.confirm(u, str(p, "id"), p);
    assertNotEquals(
      p.get("implementation"),
      ((Map<?, ?>) trainings.get(u, str(t, "id")).get("project")).get(
        "implementation"
      )
    );
    var retest = trainings.start(
      u,
      Map.of(
        "projectId",
        p.get("id"),
        "parentId",
        t.get("id"),
        "requestKey",
        id()
      )
    );
    assertTrue(
      str(list(retest, "turns").get(0), "topic").equals(str(retest, "focus"))
    );
    retest = complete(u, retest);
    assertEquals(3, list(retest, "turns").size());
    assertNotNull(retest.get("previousTurns"));
  }

  @Test
  void isolationAndUnknownObjects() {
    String u = user(),
      other = user();
    var p = project(u);
    String order = grant(u);
    var t = start(u, p);
    assertThrows(ResponseStatusException.class, () ->
      projects.get(other, str(p, "id"))
    );
    assertThrows(ResponseStatusException.class, () ->
      trainings.get(other, str(t, "id"))
    );
    assertThrows(ResponseStatusException.class, () ->
      payments.mock(other, order)
    );
    assertTrue(projects.all(other).isEmpty());
  }

  @Test
  void reportPlanIsPersistedScopedAndDoesNotRewriteEvidence() throws Exception {
    String u = user();
    var p = project(u);
    grant(u);
    var active = start(u, p);
    String tid = str(active, "id");
    var change = Map.<String, Object>of("taskIndex", 0, "done", true, "note", "并发测试记录待补充", "version", 0);
    assertEquals(409, assertThrows(ResponseStatusException.class,
      () -> trainings.savePlan(u, tid, change)).getStatusCode().value());
    var complete = complete(u, active);
    String evidence = s.encode(complete.get("report"));
    var saved = trainings.savePlan(u, tid, change);
    assertEquals(1, saved.get("planVersion"));
    assertEquals(true, list(trainings.get(u, tid), "reportPlan").get(0).get("done"));
    assertEquals(evidence, s.encode(saved.get("report")));
    assertEquals(409, assertThrows(ResponseStatusException.class,
      () -> trainings.savePlan(u, tid, change)).getStatusCode().value());
    assertEquals(404, assertThrows(ResponseStatusException.class,
      () -> trainings.savePlan(user(), tid, change)).getStatusCode().value());
    for (Object invalid : List.of(-1, 0.5, 100, "0")) {
      var invalidChange = new HashMap<>(change);
      invalidChange.put("taskIndex", invalid);
      invalidChange.put("version", 1);
      assertEquals(400, assertThrows(ResponseStatusException.class,
        () -> trainings.savePlan(u, tid, invalidChange)).getStatusCode().value());
    }
    var oversized = new HashMap<>(change);
    oversized.put("version", 1);
    oversized.put("note", "x".repeat(2001));
    assertEquals(400, assertThrows(ResponseStatusException.class,
      () -> trainings.savePlan(u, tid, oversized)).getStatusCode().value());
    var undone = trainings.savePlan(u, tid, Map.of("taskIndex", 0, "done", false, "note", "尚未完成", "version", 1));
    assertEquals(2, undone.get("planVersion"));
    assertEquals(1, list(undone, "reportPlan").size());
    assertEquals(false, list(undone, "reportPlan").get(0).get("done"));
    assertEquals(evidence, s.encode(undone.get("report")));
  }

  @Test
  void paymentIdempotencyAndServerPrice() throws Exception {
    String u = user();
    var order = payments.create(
      u,
      Map.of("requestKey", "same", "amount_cents", 1)
    );
    String oid = str(order, "id");
    assertEquals(990, order.get("amount_cents"));
    assertEquals(
      oid,
      payments.create(u, Map.of("requestKey", "same")).get("id")
    );
    parallel(8, () -> {
      payments.mock(u, oid);
      return true;
    });
    assertEquals(
      1,
      s.db.queryForObject(
        "SELECT COUNT(*) FROM training_packages WHERE order_id=?",
        Integer.class,
        oid
      )
    );
    assertThrows(ResponseStatusException.class, () ->
      payments.settle(oid, "MOCK-" + oid, "mock", 1)
    );
  }

  @Test
  void concurrentStartsCannotOverspend() throws Exception {
    String u = user();
    var p = project(u);
    grant(u);
    var results = parallel(8, () -> {
      try {
        start(u, p);
        return true;
      } catch (ResponseStatusException e) {
        return false;
      }
    });
    assertEquals(1, results.stream().filter(Boolean::booleanValue).count());
    assertEquals(
      1,
      s.db.queryForObject(
        "SELECT COUNT(*) FROM trainings WHERE user_id=?",
        Integer.class,
        u
      )
    );
  }

  @Test
  void sameStartAndAnswerAreIdempotent() throws Exception {
    String u = user();
    var p = project(u);
    grant(u);
    var input = Map.<String, Object>of(
      "projectId",
      p.get("id"),
      "requestKey",
      "start"
    );
    var results = parallel(5, () -> str(trainings.start(u, input), "id"));
    assertEquals(1, new HashSet<>(results).size());
    String tid = results.get(0);
    var t = trainings.get(u, tid);
    String turnId = str(list(t, "turns").get(0), "id");
    var answer = Map.<String, Object>of(
      "turnId",
      turnId,
      "answer",
      "我通过唯一约束处理并发预约"
    );
    t = trainings.answer(u, tid, answer);
    String q = str(list(t, "turns").get(1), "question");
    assertTrue(q.contains("唯一约束"));
    trainings.answer(u, tid, answer);
    assertEquals(2, list(trainings.get(u, tid), "turns").size());
  }

  @Test
  void expiredGenerationCanResumeAndRefundOnlyOnce() throws Exception {
    String u = user();
    var p = project(u);
    grant(u);
    var t = start(u, p);
    String tid = str(t, "id");
    t.put("operation", "REPORT");
    s.db.update(
      "UPDATE trainings SET status='GENERATING',lease_until=?,body=? WHERE id=?",
      now() - 1,
      s.encode(t),
      tid
    );
    var results = parallel(6, () -> trainings.refund(u, tid));
    assertEquals("REFUNDED", results.get(0).get("status"));
    assertEquals(
      1,
      s.db.queryForObject(
        "SELECT COUNT(*) FROM entitlement_events WHERE training_id=? AND event_type='RETURNED'",
        Integer.class,
        tid
      )
    );
    assertFalse(
      (Boolean) ((List<Map<String, Object>>) payments.shop(u).get("packages"))
        .get(0)
        .get("deep_used")
    );
    var again = start(u, p);
    assertThrows(ResponseStatusException.class, () ->
      trainings.refund(u, str(again, "id"))
    );
  }

  @Test
  void failedModelPreservesAnswerAndCanRetry() {
    String u = user();
    var p = project(u);
    grant(u);
    var t = start(u, p);
    String tid = str(t, "id");
    var broken = new ModelService(
      s,
      "demo",
      "https://invalid.example",
      "",
      "",
      ""
    ) {
      @Override
      GeneratedQuestion question(Map<String, Object> b) {
        throw new IllegalStateException("synthetic failure");
      }
    };
    var service = new TrainingService(s, projects, broken);
    assertThrows(ResponseStatusException.class, () ->
      service.answer(
        u,
        tid,
        Map.of(
          "turnId",
          list(t, "turns").get(0).get("id"),
          "answer",
          "已保存的回答"
        )
      )
    );
    var failed = trainings.get(u, tid);
    assertEquals("FAILED", failed.get("status"));
    assertEquals("已保存的回答", list(failed, "turns").get(0).get("answer"));
    assertEquals("ACTIVE", trainings.generate(u, tid).get("status"));
    assertEquals(2, list(trainings.get(u, tid), "turns").size());
  }

  @Test
  void invalidModelEvidenceRejected() {
    String u = user();
    var p = project(u);
    var fake = new ModelService(
      s,
      "live",
      "https://invalid.example",
      "test",
      "test",
      ""
    ) {
      @Override
      Map<String, Object> call(String rule, Object data) {
        return new HashMap<>(
          Map.of(
            "clearParts",
            List.of(),
            "retestTopics",
            List.of(),
            "findings",
            List.of(
              new HashMap<>(
                Map.of(
                  "topic",
                  "示例",
                  "assessment",
                  "示例",
                  "task",
                  "补充",
                  "turnIds",
                  List.of("fabricated-id"),
                  "factIds",
                  List.of()
                )
              )
            )
          )
        );
      }
    };
    assertThrows(ResponseStatusException.class, () ->
      fake.report(new HashMap<>(Map.of("project", p, "turns", List.of())))
    );
  }

  @Test
  void signedSandboxNotificationsAreVerifiedAndIdempotent() throws Exception {
    var gen = KeyPairGenerator.getInstance("RSA");
    gen.initialize(2048);
    var pair = gen.generateKeyPair();
    String priv = Base64.getEncoder().encodeToString(
        pair.getPrivate().getEncoded()
      ),
      pub = Base64.getEncoder().encodeToString(pair.getPublic().getEncoded());
    var service = new PaymentService(
      s,
      "sandbox",
      "app-test",
      Base64.getEncoder().encodeToString(
        gen.generateKeyPair().getPrivate().getEncoded()
      ),
      pub,
      "seller-test",
      "https://example.test/api/payments/notify",
      "https://example.test"
    );
    String u = user();
    var sandboxOrder = service.create(u, Map.of("requestKey", id()));
    String oid = str(sandboxOrder, "id");
    var params = new HashMap<String, String>(
      Map.of(
        "app_id",
        "app-test",
        "seller_id",
        "seller-test",
        "out_trade_no",
        str(sandboxOrder, "merchant_order_no"),
        "total_amount",
        "9.90",
        "trade_status",
        "TRADE_SUCCESS",
        "trade_no",
        "sandbox-" + id()
      )
    );
    params.put(
      "sign",
      AlipaySignature.rsaSign(
        AlipaySignature.getSignContent(params),
        priv,
        "UTF-8",
        "RSA2"
      )
    );
    params.put("sign_type", "RSA2");
    assertEquals("success", service.notify(params));
    assertEquals("success", service.notify(params));
    assertEquals(
      1,
      s.db.queryForObject(
        "SELECT COUNT(*) FROM training_packages WHERE order_id=?",
        Integer.class,
        oid
      )
    );
    params.put("total_amount", "0.01");
    assertEquals("failure", service.notify(params));
    params.remove("sign");
    params.remove("sign_type");
    params.put("seller_id", "wrong-seller");
    params.put(
      "sign",
      AlipaySignature.rsaSign(
        AlipaySignature.getSignContent(params),
        priv,
        "UTF-8",
        "RSA2"
      )
    );
    params.put("sign_type", "RSA2");
    assertEquals("failure", service.notify(params));
  }

  @Test
  void httpAuthAndOriginGuards() throws Exception {
    mvc.perform(get("/api/projects")).andExpect(status().isUnauthorized());
    mvc
      .perform(
        post("/api/orders").contentType("application/json").content("{}")
      )
      .andExpect(status().isForbidden());
    String body = s.encode(
      Map.of("username", "http-" + id(), "password", "safe-test-password")
    );
    var response = mvc
      .perform(
        post("/api/auth/register")
          .header("Origin", "http://localhost:5173")
          .contentType("application/json")
          .content(body)
      )
      .andExpect(status().isOk())
      .andReturn()
      .getResponse();
    String cookie = response.getHeader("Set-Cookie");
    assertTrue(cookie.contains("HttpOnly"));
    assertTrue(cookie.contains("SameSite=Strict"));
    mvc
      .perform(
        get("/api/projects").cookie(
          new jakarta.servlet.http.Cookie(
            "probe_session",
            cookie.split(";")[0].split("=")[1]
          )
        )
      )
      .andExpect(status().isOk());
  }

  @Test
  void staleProjectEditRejectedAndFinishWithoutAnswerIsHonest() {
    String u = user();
    var p = project(u);
    var stale = new HashMap<>(p);
    p.put("implementation", "新的接口实现材料");
    projects.save(u, str(p, "id"), p);
    assertThrows(ResponseStatusException.class, () ->
      projects.save(u, str(stale, "id"), stale)
    );
    p = projects.extract(u, str(p, "id"));
    p = projects.confirm(u, str(p, "id"), p);
    grant(u);
    var t = start(u, p);
    var done = trainings.finish(u, str(t, "id"));
    assertTrue(
      list((Map<String, Object>) done.get("report"), "findings").isEmpty()
    );
    assertThrows(ResponseStatusException.class, () ->
      trainings.refund(u, str(t, "id"))
    );
  }

  <T> List<T> parallel(int n, Callable<T> task) throws Exception {
    var pool = Executors.newFixedThreadPool(n);
    try {
      var futures = new ArrayList<Future<T>>();
      for (int i = 0; i < n; i++) futures.add(pool.submit(task));
      var results = new ArrayList<T>();
      for (var f : futures) results.add(f.get(20, TimeUnit.SECONDS));
      return results;
    } finally {
      pool.shutdownNow();
    }
  }
}
