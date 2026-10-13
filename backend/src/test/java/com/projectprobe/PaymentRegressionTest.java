package com.projectprobe;

import static com.projectprobe.Store.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.alipay.api.*;
import com.alipay.api.internal.util.AlipaySignature;
import com.alipay.api.request.*;
import com.alipay.api.response.*;
import java.security.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.web.server.ResponseStatusException;

@SpringBootTest(
  properties = {
    "spring.datasource.url=${PROBE_TEST_DB_URL:jdbc:h2:mem:payment-regression;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1}",
    "spring.datasource.username=${PROBE_TEST_DB_USER:sa}",
    "spring.datasource.password=${PROBE_TEST_DB_PASSWORD:}",
    "app.model-mode=demo",
    "app.payment.mode=mock",
    "app.payment.reconcile-enabled=false",
  }
)
class PaymentRegressionTest {

  @Autowired
  Store s;

  @Autowired
  ProjectService projects;

  @Autowired
  ModelService model;

  static String privateKey, publicKey, applicationPrivateKey;

  @BeforeAll
  static void keys() throws Exception {
    var generator = KeyPairGenerator.getInstance("RSA");
    generator.initialize(2048);
    var pair = generator.generateKeyPair();
    privateKey = Base64.getEncoder().encodeToString(
      pair.getPrivate().getEncoded()
    );
    publicKey = Base64.getEncoder().encodeToString(
      pair.getPublic().getEncoded()
    );
    applicationPrivateKey = Base64.getEncoder().encodeToString(
      generator.generateKeyPair().getPrivate().getEncoded()
    );
  }

  String user() {
    String u = id();
    s.db.update(
      "INSERT INTO app_users VALUES (?,?,?,?)",
      u,
      "pay-" + u,
      "unused",
      now()
    );
    return u;
  }

  PaymentSettings config(String mode) {
    var c = new PaymentSettings();
    c.setMode(mode);
    var a = c.active();
    a.setAppId(mode + "-app");
    a.setSellerId(mode + "-seller");
    a.setPrivateKey(applicationPrivateKey);
    a.setPublicKey(publicKey);
    a.setNotifyUrl("https://example.test/api/payments/notify");
    a.setReturnUrl("https://example.test/payment-return");
    a.setMerchantConfirmed(true);
    return c;
  }

  PaymentService service(PaymentSettings config, AlipayClient client) {
    return new PaymentService(s, config) {
      @Override
      AlipayClient client() {
        return client;
      }
    };
  }

  Map<String, String> notification(Map<String, Object> o, String status)
    throws Exception {
    var p = new HashMap<String, String>();
    p.put("app_id", str(o, "app_id"));
    p.put("seller_id", str(o, "seller_id"));
    p.put("out_trade_no", str(o, "merchant_order_no"));
    p.put("trade_no", "TRADE_" + str(o, "id"));
    p.put("total_amount", PaymentService.yuan(o));
    p.put("trade_status", status);
    sign(p);
    return p;
  }

  void sign(Map<String, String> p) throws Exception {
    p.remove("sign");
    p.remove("sign_type");
    p.put(
      "sign",
      AlipaySignature.rsaSign(
        AlipaySignature.getSignContent(p),
        privateKey,
        "UTF-8",
        "RSA2"
      )
    );
    p.put("sign_type", "RSA2");
  }

  AlipayTradeQueryResponse response(Map<String, Object> o, String status) {
    var r = new AlipayTradeQueryResponse();
    r.setCode("10000");
    r.setOutTradeNo(str(o, "merchant_order_no"));
    r.setTradeNo("TRADE_" + str(o, "id"));
    r.setTradeStatus(status);
    r.setTotalAmount(PaymentService.yuan(o));
    r.setBody(
      s.encode(
        Map.of(
          "alipay_trade_query_response",
          Map.of("app_id", o.get("app_id"), "seller_id", o.get("seller_id"))
        )
      )
    );
    return r;
  }

  int grants(String oid) {
    return s.db.queryForObject(
      "SELECT COUNT(*) FROM training_packages WHERE order_id=?",
      Integer.class,
      oid
    );
  }

  @Test
  void expiredNotCreatedOrderIsRecheckedAfterBackoffAndPaidExactlyOnce()
    throws Exception {
    var c = config("sandbox");
    c.setExpirySyncEnabled(true);
    var client = mock(AlipayClient.class);
    var pay = service(c, client);
    var u = user();
    var o = pay.create(u, Map.of("requestKey", id()));
    var oid = str(o, "id");
    s.db.update(
      "UPDATE purchase_orders SET expires_at=?,checkout_requested=TRUE WHERE id=?",
      now() - 1,
      oid
    );
    var missing = new AlipayTradeQueryResponse();
    missing.setCode("40004");
    missing.setSubCode("ACQ.TRADE_NOT_EXIST");
    when(client.execute(any(AlipayTradeQueryRequest.class))).thenReturn(
      missing
    );
    var worker = new OrderExpiryService(pay, new PaymentOperations(pay));
    worker.sweep();
    assertEquals("NOT_CREATED", pay.order(u, oid).get("query_status"));
    clearInvocations(client);
    worker.sweep();
    verifyNoInteractions(client);
    when(client.execute(any(AlipayTradeQueryRequest.class))).thenReturn(
      response(o, "TRADE_SUCCESS")
    );
    s.db.update(
      "UPDATE purchase_orders SET last_query_at=? WHERE id=?",
      now() - 3600001,
      oid
    );
    worker.sweep();
    assertEquals("PAID", pay.order(u, oid).get("status"));
    assertEquals(1, grants(oid));
    worker.sweep();
    assertEquals(1, grants(oid));
    verify(client, times(1)).execute(any(AlipayTradeQueryRequest.class));
    verify(client, never()).execute(any(AlipayTradeCloseRequest.class));
  }

  @Test
  void expiredNotCreatedOrderWithoutCheckoutIsNotRepeatedlyQueried() {
    var c = config("sandbox");
    c.setExpirySyncEnabled(true);
    var client = mock(AlipayClient.class);
    var pay = service(c, client);
    var u = user();
    var o = pay.create(u, Map.of("requestKey", id()));
    s.db.update(
      "UPDATE purchase_orders SET expires_at=?,query_status='NOT_CREATED',last_query_at=0 WHERE id=?",
      now() - 1,
      o.get("id")
    );
    new OrderExpiryService(pay, new PaymentOperations(pay)).sweep();
    verifyNoInteractions(client);
  }

  @Test
  void expiryBlocksCheckoutAndPreservesLateSignedPayment() throws Exception {
    var c = config("sandbox");
    var client = mock(AlipayClient.class);
    var pay = service(c, client);
    var u = user();
    var o = pay.create(u, Map.of("requestKey", id()));
    var oid = str(o, "id");
    s.db.update(
      "UPDATE purchase_orders SET expires_at=? WHERE id=?",
      now() - 1,
      oid
    );
    assertEquals("EXPIRED", pay.order(u, oid).get("status"));
    assertEquals(false, pay.order(u, oid).get("can_pay"));
    assertThrows(ResponseStatusException.class, () -> pay.checkout(u, oid));
    verifyNoInteractions(client);
    assertEquals("success", pay.notify(notification(o, "TRADE_SUCCESS")));
    assertEquals("success", pay.notify(notification(o, "TRADE_SUCCESS")));
    assertEquals("PAID", pay.order(u, oid).get("status"));
    assertEquals(1, grants(oid));
    pay.expireDue();
    assertEquals("PAID", pay.order(u, oid).get("status"));
  }

  @Test
  void expiryWorkerQueriesBeforeCloseAndKeepsFailuresRecoverable()
    throws Exception {
    var c = config("sandbox");
    c.setExpirySyncEnabled(true);
    var client = mock(AlipayClient.class);
    var pay = service(c, client);
    var operations = new PaymentOperations(pay);
    var worker = new OrderExpiryService(pay, operations);
    var u = user();
    var o = pay.create(u, Map.of("requestKey", id()));
    var oid = str(o, "id");
    s.db.update(
      "UPDATE purchase_orders SET expires_at=? WHERE id=?",
      now() - 1,
      oid
    );
    when(client.execute(any(AlipayTradeQueryRequest.class))).thenThrow(
      new AlipayApiException("synthetic")
    );
    worker.sweep();
    assertEquals("EXPIRED", pay.order(u, oid).get("status"));
    assertEquals("QUERY_FAILED", pay.order(u, oid).get("query_status"));
    verify(client, never()).execute(any(AlipayTradeCloseRequest.class));
    when(client.execute(any(AlipayTradeQueryRequest.class))).thenReturn(
      response(o, "TRADE_SUCCESS")
    );
    s.db.update("UPDATE purchase_orders SET last_query_at=0 WHERE id=?", oid);
    worker.sweep();
    assertEquals("PAID", pay.order(u, oid).get("status"));
    assertEquals(1, grants(oid));
    verify(client, never()).execute(any(AlipayTradeCloseRequest.class));
  }

  @Test
  void expiryWorkerConfirmsWaitingTradeBeforeClosing() throws Exception {
    var c = config("sandbox");
    c.setExpirySyncEnabled(true);
    var client = mock(AlipayClient.class);
    var pay = service(c, client);
    var u = user();
    var o = pay.create(u, Map.of("requestKey", id()));
    var oid = str(o, "id");
    s.db.update(
      "UPDATE purchase_orders SET expires_at=? WHERE id=?",
      now() - 1,
      oid
    );
    when(client.execute(any(AlipayTradeQueryRequest.class))).thenReturn(
      response(o, "WAIT_BUYER_PAY")
    );
    var closed = new AlipayTradeCloseResponse();
    closed.setCode("10000");
    closed.setTradeNo("TRADE_" + oid);
    closed.setBody(
      s.encode(
        Map.of(
          "alipay_trade_close_response",
          Map.of("out_trade_no", o.get("merchant_order_no"))
        )
      )
    );
    when(client.execute(any(AlipayTradeCloseRequest.class))).thenReturn(closed);
    new OrderExpiryService(pay, new PaymentOperations(pay)).sweep();
    assertEquals("CLOSED", pay.order(u, oid).get("status"));
    assertEquals(0, grants(oid));
  }

  @Test
  void expiryNeverCrossesAccountScopeAndMockCannotPayExpiredOrders() {
    var c = config("mock");
    var pay = service(c, mock(AlipayClient.class));
    var u = user();
    var o = pay.create(u, Map.of("requestKey", id()));
    var oid = str(o, "id");
    s.db.update(
      "UPDATE purchase_orders SET expires_at=? WHERE id=?",
      now() - 1,
      oid
    );
    assertThrows(ResponseStatusException.class, () -> pay.mock(u, oid));
    assertEquals(0, grants(oid));
    var other = config("sandbox");
    var external = service(other, mock(AlipayClient.class));
    var second = external.create(u, Map.of("requestKey", id()));
    s.db.update(
      "UPDATE purchase_orders SET expires_at=? WHERE id=?",
      now() - 1,
      second.get("id")
    );
    pay.expireDue();
    assertEquals(
      "PENDING",
      s
        .one("SELECT * FROM purchase_orders WHERE id=?", second.get("id"))
        .get("status")
    );
  }

  @ParameterizedTest
  @ValueSource(strings = { "sandbox", "production" })
  void signedNotificationsValidateEveryBindingAndIssueOnce(String mode)
    throws Exception {
    var pay = new PaymentService(s, config(mode));
    String u = user();
    var o = pay.create(u, Map.of("requestKey", id()));
    for (String field : List.of(
      "app_id",
      "seller_id",
      "out_trade_no",
      "total_amount",
      "trade_status",
      "trade_no"
    )) {
      var bad = notification(o, "TRADE_SUCCESS");
      bad.put(
        field,
        field.equals("total_amount")
          ? "0.01"
          : field.equals("trade_no")
            ? ""
            : "wrong"
      );
      sign(bad);
      assertEquals("failure", pay.notify(bad), field);
    }
    var tampered = notification(o, "TRADE_SUCCESS");
    tampered.put("total_amount", "0.01");
    assertEquals("failure", pay.notify(tampered));
    assertEquals(0, grants(str(o, "id")));
    var good = notification(o, "TRADE_SUCCESS");
    assertEquals("success", pay.notify(good));
    assertEquals("success", pay.notify(good));
    assertEquals(1, grants(str(o, "id")));
    good.put("trade_no", "OTHER");
    sign(good);
    assertEquals("failure", pay.notify(good));
  }

  @ParameterizedTest
  @ValueSource(strings = { "sandbox", "production" })
  void checkoutUsesFixedGatewayAndOrderSnapshotPrice(String mode)
    throws Exception {
    var c = config(mode);
    c.setPriceCents(1234);
    var client = mock(AlipayClient.class);
    var pay = service(c, client);
    String u = user();
    var o = pay.create(u, Map.of("requestKey", id(), "amount_cents", 1));
    c.setPriceCents(2500);
    var r = new AlipayTradePagePayResponse();
    r.setBody(
      "<form method=\"post\" action=\"" +
        c.gateway() +
        "?signed=synthetic\"><input type=\"hidden\" name=\"biz_content\" value=\"synthetic\"></form>"
    );
    when(
      client.pageExecute(any(AlipayTradePagePayRequest.class), eq("POST"))
    ).thenReturn(r);
    assertTrue(pay.checkout(u, str(o, "id")).contains(c.gateway()));
    var capture = org.mockito.ArgumentCaptor.forClass(
      AlipayTradePagePayRequest.class
    );
    verify(client).pageExecute(capture.capture(), eq("POST"));
    var biz = s.decode(capture.getValue().getBizContent());
    assertEquals("12.34", biz.get("total_amount"));
    assertEquals(o.get("merchant_order_no"), biz.get("out_trade_no"));
    assertTrue(str(o, "merchant_order_no").matches("[A-Z]+_[a-f0-9]{32}"));
    assertTrue(
      capture
        .getValue()
        .getReturnUrl()
        .contains("probe_order=" + o.get("id"))
    );
    r.setBody(
      "<form method=\"post\" action=\"https://evil.test/gateway.do\"></form>"
    );
    assertThrows(ResponseStatusException.class, () ->
      pay.checkout(u, str(o, "id"))
    );
  }

  @Test
  void incompleteProductionNeverFallsBackAndMockUsesStoredPrice() {
    var c = new PaymentSettings();
    c.setMode("production");
    var pay = new PaymentService(s, c);
    assertFalse(pay.configured());
    String u = user();
    var o = pay.create(u, Map.of("requestKey", id()));
    assertEquals("production", o.get("mode"));
    assertThrows(ResponseStatusException.class, () ->
      pay.checkout(u, str(o, "id"))
    );
    assertThrows(ResponseStatusException.class, () ->
      pay.mock(u, str(o, "id"))
    );
    assertEquals(0, grants(str(o, "id")));
    var mockConfig = new PaymentSettings();
    mockConfig.setPriceCents(1432);
    var mockPay = new PaymentService(s, mockConfig);
    var m = mockPay.create(u, Map.of("requestKey", id(), "amountCents", 1));
    mockConfig.setPriceCents(999);
    assertEquals(1432, mockPay.mock(u, str(m, "id")).get("amount_cents"));
  }

  @Test
  void modesAccountsOrdersAndTrainingRightsRemainIsolated() throws Exception {
    String u = user();
    var sandbox = new PaymentService(s, config("sandbox"));
    var o = sandbox.create(u, Map.of("requestKey", "shared-key"));
    assertEquals("success", sandbox.notify(notification(o, "TRADE_SUCCESS")));
    var production = new PaymentService(s, config("production"));
    assertThrows(ResponseStatusException.class, () ->
      production.create(u, Map.of("requestKey", "shared-key"))
    );
    assertThrows(ResponseStatusException.class, () ->
      production.settle(str(o, "id"), "TRADE_" + o.get("id"), "production", 990)
    );
    assertTrue(production.packages(u).isEmpty());
    var otherConfig = config("sandbox");
    otherConfig.active().setAppId("other-app");
    var other = new PaymentService(s, otherConfig);
    assertTrue(other.packages(u).isEmpty());
    assertThrows(ResponseStatusException.class, () ->
      other.sync(u, str(o, "id"))
    );
    var p = projects.save(
      u,
      null,
      Map.of("name", "合成隔离项目", "responsibility", "只写一个接口")
    );
    p = projects.extract(u, str(p, "id"));
    p = projects.confirm(u, str(p, "id"), p);
    String pid = str(p, "id");
    var training = new TrainingService(s, projects, model, production);
    assertThrows(ResponseStatusException.class, () ->
      training.start(u, Map.of("projectId", pid, "requestKey", id()))
    );
    var sandboxTraining = new TrainingService(s, projects, model, sandbox);
    var t = sandboxTraining.start(
      u,
      Map.of("projectId", pid, "requestKey", id())
    );
    assertThrows(ResponseStatusException.class, () ->
      training.get(u, str(t, "id"))
    );
    assertTrue(training.all(u).isEmpty());
  }

  @ParameterizedTest
  @ValueSource(strings = { "sandbox", "production" })
  void queryCompensationAndConcurrentNotificationsGrantOnce(String mode)
    throws Exception {
    String u = user();
    var client = mock(AlipayClient.class);
    var pay = service(config(mode), client);
    var o = pay.create(u, Map.of("requestKey", id()));
    var r = response(o, "TRADE_SUCCESS");
    when(client.execute(any(AlipayTradeQueryRequest.class))).thenReturn(r);
    var params = notification(o, "TRADE_SUCCESS");
    var pool = Executors.newFixedThreadPool(8);
    try {
      var jobs = new ArrayList<Callable<String>>();
      for (int i = 0; i < 8; i++) {
        final int index = i;
        jobs.add(() -> {
          if (index % 2 == 0) return pay.notify(params);
          try {
            pay.sync(u, str(o, "id"));
            return "success";
          } catch (ResponseStatusException e) {
            return "busy";
          }
        });
      }
      for (var result : pool.invokeAll(jobs))
        assertTrue(Set.of("success", "busy").contains(result.get()));
    } finally {
      pool.shutdownNow();
    }
    assertEquals(1, grants(str(o, "id")));
    assertEquals("PAID", pay.order(u, str(o, "id")).get("status"));
    pay.sync(u, str(o, "id"));
    assertEquals(1, grants(str(o, "id")));
  }

  @ParameterizedTest
  @ValueSource(
    strings = {
      "out_trade_no",
      "total_amount",
      "app_id",
      "seller_id",
      "trade_no",
      "trade_status",
    }
  )
  void queryRejectsWrongOwnershipAmountAndUnknownStatus(String field)
    throws Exception {
    String u = user();
    var client = mock(AlipayClient.class);
    var pay = service(config("production"), client);
    var o = pay.create(u, Map.of("requestKey", id()));
    var r = response(o, "TRADE_SUCCESS");
    switch (field) {
      case "out_trade_no" -> r.setOutTradeNo("wrong");
      case "total_amount" -> r.setTotalAmount("0.01");
      case "trade_no" -> r.setTradeNo("");
      case "trade_status" -> r.setTradeStatus("UNKNOWN");
      default -> r.setBody(
        s.encode(Map.of("alipay_trade_query_response", Map.of(field, "wrong")))
      );
    }
    when(client.execute(any(AlipayTradeQueryRequest.class))).thenReturn(r);
    assertThrows(ResponseStatusException.class, () ->
      pay.sync(u, str(o, "id"))
    );
    assertEquals("PENDING", pay.order(u, str(o, "id")).get("status"));
    assertEquals(
      "QUERY_FAILED",
      pay.order(u, str(o, "id")).get("query_status")
    );
    assertEquals(0, grants(str(o, "id")));
  }

  @Test
  void unpaidClosedNotCreatedAndQueryFailureNeverGrant() throws Exception {
    String u = user();
    var client = mock(AlipayClient.class);
    var pay = service(config("sandbox"), client);
    var o = pay.create(u, Map.of("requestKey", id()));
    var r = response(o, "WAIT_BUYER_PAY");
    when(client.execute(any(AlipayTradeQueryRequest.class))).thenReturn(r);
    assertEquals(
      "WAIT_BUYER_PAY",
      pay.sync(u, str(o, "id")).get("query_status")
    );
    assertEquals(0, grants(str(o, "id")));
    r.setTradeStatus("TRADE_CLOSED");
    assertEquals("CLOSED", pay.sync(u, str(o, "id")).get("status"));
    assertThrows(ResponseStatusException.class, () ->
      pay.checkout(u, str(o, "id"))
    );
    assertEquals(0, grants(str(o, "id")));
    var missing = pay.create(u, Map.of("requestKey", id()));
    r = new AlipayTradeQueryResponse();
    r.setCode("40004");
    r.setSubCode("ACQ.TRADE_NOT_EXIST");
    when(client.execute(any(AlipayTradeQueryRequest.class))).thenReturn(r);
    assertEquals(
      "NOT_CREATED",
      pay.sync(u, str(missing, "id")).get("query_status")
    );
    when(client.execute(any(AlipayTradeQueryRequest.class))).thenThrow(
      new AlipayApiException("synthetic-private-detail")
    );
    assertThrows(ResponseStatusException.class, () ->
      pay.sync(u, str(missing, "id"))
    );
    assertFalse(
      str(pay.order(u, str(missing, "id")), "query_error").contains(
        "private-detail"
      )
    );
    assertEquals(0, grants(str(missing, "id")));
  }

  @Test
  void closedPaidTransactionRequiresReviewWithoutSecondGrant()
    throws Exception {
    var pay = new PaymentService(s, config("sandbox"));
    String u = user();
    var o = pay.create(u, Map.of("requestKey", id()));
    assertEquals("success", pay.notify(notification(o, "TRADE_SUCCESS")));
    assertEquals("success", pay.notify(notification(o, "TRADE_CLOSED")));
    assertEquals("REVIEW_REQUIRED", pay.order(u, str(o, "id")).get("status"));
    assertEquals(1, grants(str(o, "id")));
    assertTrue(pay.packages(u).isEmpty());
  }

  @Test
  void reconcileOnlyQueriesCurrentAttemptedPendingOrders() throws Exception {
    var c = config("sandbox");
    c.active().setAppId("reconcile-" + id());
    c.setReconcileEnabled(true);
    var client = mock(AlipayClient.class);
    var pay = service(c, client);
    String u = user();
    var o = pay.create(u, Map.of("requestKey", id()));
    pay.create(u, Map.of("requestKey", id()));
    var other = new PaymentService(s, config("production"));
    other.create(u, Map.of("requestKey", id()));
    s.db.update(
      "UPDATE purchase_orders SET checkout_requested=TRUE WHERE id=?",
      o.get("id")
    );
    when(client.execute(any(AlipayTradeQueryRequest.class))).thenReturn(
      response(o, "TRADE_SUCCESS")
    );
    pay.reconcile();
    assertEquals(1, grants(str(o, "id")));
    verify(client, times(1)).execute(any(AlipayTradeQueryRequest.class));
  }

  @Test
  void signedSdkQueryResponseIsVerifiedBeforeGrant() throws Exception {
    for (boolean valid : List.of(false, true)) {
      var cfg = config("sandbox");
      String u = user();
      var pay = new PaymentService(s, cfg);
      var o = pay.create(u, Map.of("requestKey", id()));
      String payload = s.encode(
        Map.of(
          "code",
          "10000",
          "msg",
          "Success",
          "out_trade_no",
          o.get("merchant_order_no"),
          "trade_no",
          "TRADE_" + o.get("id"),
          "total_amount",
          PaymentService.yuan(o),
          "trade_status",
          "TRADE_SUCCESS"
        )
      );
      String signature = AlipaySignature.rsaSign(
        payload,
        privateKey,
        "UTF-8",
        "RSA2"
      );
      if (!valid) signature = Base64.getEncoder().encodeToString(new byte[256]);
      byte[] body = (
        "{\"alipay_trade_query_response\":" +
        payload +
        ",\"sign\":\"" +
        signature +
        "\"}"
      ).getBytes(java.nio.charset.StandardCharsets.UTF_8);
      var server = com.sun.net.httpserver.HttpServer.create(
        new java.net.InetSocketAddress("127.0.0.1", 0),
        0
      );
      server.createContext("/gateway.do", exchange -> {
        exchange.getRequestBody().readAllBytes();
        exchange
          .getResponseHeaders()
          .set("Content-Type", "application/json; charset=utf-8");
        exchange.sendResponseHeaders(200, body.length);
        exchange.getResponseBody().write(body);
        exchange.close();
      });
      server.start();
      try {
        var clientConfig = new AlipayConfig();
        clientConfig.setServerUrl(
          "http://127.0.0.1:" + server.getAddress().getPort() + "/gateway.do"
        );
        clientConfig.setAppId(cfg.active().getAppId());
        clientConfig.setPrivateKey(applicationPrivateKey);
        clientConfig.setAlipayPublicKey(publicKey);
        clientConfig.setSignType("RSA2");
        clientConfig.setCharset("UTF-8");
        clientConfig.setFormat("json");
        var sdkClient = new DefaultAlipayClient(clientConfig);
        if (valid) {
          var request = new AlipayTradeQueryRequest();
          request.setBizContent(
            s.encode(Map.of("out_trade_no", o.get("merchant_order_no")))
          );
          var parsed = sdkClient.execute(request);
          assertTrue(parsed.isSuccess(), parsed.getCode());
          assertEquals(str(o, "merchant_order_no"), parsed.getOutTradeNo());
          assertTrue(
            s.json
              .readTree(parsed.getBody())
              .has("alipay_trade_query_response"),
            "SDK 返回正文结构：" + parsed.getBody()
          );
        }
        var sdkPay = service(cfg, sdkClient);
        if (valid) assertEquals(
          "PAID",
          sdkPay.sync(u, str(o, "id")).get("status")
        );
        else assertThrows(ResponseStatusException.class, () ->
          sdkPay.sync(u, str(o, "id"))
        );
        assertEquals(valid ? 1 : 0, grants(str(o, "id")));
      } finally {
        server.stop(0);
      }
    }
  }

  @Test
  void malformedQueryEnvelopeCannotGrant() throws Exception {
    var c = config("sandbox");
    var client = mock(AlipayClient.class);
    var pay = service(c, client);
    String u = user();
    var o = pay.create(u, Map.of("requestKey", id()));
    var r = response(o, "TRADE_SUCCESS");
    r.setBody("{}");
    when(client.execute(any(AlipayTradeQueryRequest.class))).thenReturn(r);
    assertThrows(ResponseStatusException.class, () ->
      pay.sync(u, str(o, "id"))
    );
    assertEquals(0, grants(str(o, "id")));
  }

  @Test
  void migrationPreservesHistoricalOrdersAndEntitlements() {
    String url =
      "jdbc:h2:mem:migration-" +
      id() +
      ";MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1";
    org.flywaydb.core.Flyway.configure()
      .dataSource(url, "sa", "")
      .target("1")
      .load()
      .migrate();
    var db = new org.springframework.jdbc.core.JdbcTemplate(
      new org.springframework.jdbc.datasource.DriverManagerDataSource(
        url,
        "sa",
        ""
      )
    );
    db.update("INSERT INTO app_users VALUES ('u','synthetic','unused',1)");
    db.update(
      "INSERT INTO purchase_orders VALUES ('o','u','key',876,'mock','PAID','OLD_TRADE',1)"
    );
    db.update(
      "INSERT INTO training_packages(id,user_id,order_id,deep_used,retest_used) VALUES ('p','u','o',TRUE,FALSE)"
    );
    org.flywaydb.core.Flyway.configure()
      .dataSource(url, "sa", "")
      .load()
      .migrate();
    var order = db.queryForMap("SELECT * FROM purchase_orders WHERE id='o'");
    assertEquals(876, ((Number) order.get("amount_cents")).intValue());
    assertEquals("PAID", order.get("status"));
    assertEquals("OLD_TRADE", order.get("trade_no"));
    assertEquals("legacy", order.get("account_scope"));
    assertNull(order.get("merchant_order_no"));
    assertEquals("LEGACY_PAIR", order.get("product_code"));
    assertEquals(2, order.get("training_limit"));
    assertEquals(false, order.get("lifetime"));
    var legacyPack = db.queryForMap("SELECT * FROM training_packages WHERE id='p'");
    assertEquals("LEGACY_PAIR", legacyPack.get("product_code"));
    assertEquals(0L, legacyPack.get("training_used"));
    assertEquals(false, legacyPack.get("retest_used"));
    assertEquals(
      true,
      db
        .queryForMap("SELECT * FROM training_packages WHERE id='p'")
        .get("deep_used")
    );
  }

  @Test
  void refundEventsNeverGrantAndOperationsAreRecoverable() throws Exception {
    var cfg = config("sandbox");
    var client = mock(AlipayClient.class);
    var pay = service(cfg, client);
    var operations = new PaymentOperations(pay);
    String u = user();
    var o = pay.create(u, Map.of("requestKey", id()));
    var refundNotice = notification(o, "TRADE_SUCCESS");
    refundNotice.put("refund_fee", "9.90");
    refundNotice.put("out_biz_no", "synthetic-refund");
    sign(refundNotice);
    assertEquals("success", pay.notify(refundNotice));
    assertEquals("success", pay.notify(refundNotice));
    assertEquals(0, grants(str(o, "id")));
    assertEquals("REVIEW_REQUIRED", pay.order(u, str(o, "id")).get("status"));
    assertEquals(
      1,
      s.db.queryForObject(
        "SELECT COUNT(*) FROM payment_notification_events WHERE order_id=?",
        Integer.class,
        o.get("id")
      )
    );
    var paid = pay.create(u, Map.of("requestKey", id()));
    assertEquals("success", pay.notify(notification(paid, "TRADE_SUCCESS")));
    String oid = str(paid, "id");
    assertThrows(ResponseStatusException.class, () ->
      operations.refund(u, oid)
    );
    cfg.setOperationsEnabled(true);
    assertThrows(ResponseStatusException.class, () ->
      operations.refund(user(), oid)
    );
    when(client.execute(any(AlipayTradeRefundRequest.class))).thenThrow(
      new AlipayApiException("synthetic timeout")
    );
    assertThrows(ResponseStatusException.class, () ->
      operations.refund(u, oid)
    );
    assertEquals("REFUNDING", pay.order(u, oid).get("status"));
    assertTrue(pay.packages(u).isEmpty());
    var request = s.one("SELECT * FROM payment_refunds WHERE order_id=?", oid);
    operations.refund(u, oid);
    verify(client, times(1)).execute(any(AlipayTradeRefundRequest.class));
    assertEquals(
      request.get("request_no"),
      s
        .one("SELECT * FROM payment_refunds WHERE order_id=?", oid)
        .get("request_no")
    );
    s.db.update(
      "UPDATE payment_refunds SET attempted_at=? WHERE order_id=?",
      now() - 11000,
      oid
    );
    var response = new AlipayTradeFastpayRefundQueryResponse();
    response.setCode("10000");
    response.setBody(
      s.encode(
        Map.of(
          "alipay_trade_fastpay_refund_query_response",
          Map.of(
            "out_trade_no",
            paid.get("merchant_order_no"),
            "trade_no",
            "TRADE_" + oid,
            "out_request_no",
            request.get("request_no"),
            "total_amount",
            "9.90",
            "refund_amount",
            "9.90",
            "refund_status",
            "REFUND_SUCCESS"
          )
        )
      )
    );
    when(
      client.execute(any(AlipayTradeFastpayRefundQueryRequest.class))
    ).thenReturn(response);
    assertEquals("CASH_REFUNDED", operations.refundQuery(u, oid).get("status"));
    assertEquals("CASH_REFUNDED", operations.refund(u, oid).get("status"));
    assertEquals("success", pay.notify(notification(paid, "TRADE_SUCCESS")));
    assertEquals("CASH_REFUNDED", pay.order(u, oid).get("status"));
    assertEquals(1, grants(oid));
  }

  @Test
  void closeQueriesFirstAndOnlyClosesUnpaidMatchingTransaction()
    throws Exception {
    var cfg = config("sandbox");
    cfg.setOperationsEnabled(true);
    var client = mock(AlipayClient.class);
    var pay = service(cfg, client);
    var operations = new PaymentOperations(pay);
    String u = user();
    var o = pay.create(u, Map.of("requestKey", id()));
    when(client.execute(any(AlipayTradeQueryRequest.class))).thenReturn(
      response(o, "TRADE_SUCCESS")
    );
    assertThrows(ResponseStatusException.class, () ->
      operations.close(u, str(o, "id"))
    );
    verify(client, never()).execute(any(AlipayTradeCloseRequest.class));
    var waiting = pay.create(u, Map.of("requestKey", id()));
    when(client.execute(any(AlipayTradeQueryRequest.class))).thenReturn(
      response(waiting, "WAIT_BUYER_PAY")
    );
    var closed = new AlipayTradeCloseResponse();
    closed.setCode("10000");
    closed.setTradeNo("TRADE_" + waiting.get("id"));
    closed.setBody(
      s.encode(
        Map.of(
          "alipay_trade_close_response",
          Map.of(
            "out_trade_no",
            waiting.get("merchant_order_no"),
            "trade_no",
            closed.getTradeNo()
          )
        )
      )
    );
    when(client.execute(any(AlipayTradeCloseRequest.class))).thenReturn(closed);
    assertEquals(
      "CLOSED",
      operations.close(u, str(waiting, "id")).get("status")
    );
    assertEquals(
      "CLOSED",
      operations.close(u, str(waiting, "id")).get("status")
    );
    verify(client, times(1)).execute(any(AlipayTradeCloseRequest.class));
    assertEquals(0, grants(str(waiting, "id")));
  }

  @Test
  void usedPackagesAndMismatchedRefundResponseAreRejected() throws Exception {
    var cfg = config("production");
    cfg.setOperationsEnabled(true);
    var client = mock(AlipayClient.class);
    var pay = service(cfg, client);
    var operations = new PaymentOperations(pay);
    String u = user();
    var o = pay.create(u, Map.of("requestKey", id()));
    pay.notify(notification(o, "TRADE_SUCCESS"));
    s.db.update(
      "UPDATE training_packages SET deep_used=TRUE WHERE order_id=?",
      o.get("id")
    );
    assertThrows(ResponseStatusException.class, () ->
      operations.refund(u, str(o, "id"))
    );
    verify(client, never()).execute(any(AlipayTradeRefundRequest.class));
    var fresh = pay.create(u, Map.of("requestKey", id()));
    pay.notify(notification(fresh, "TRADE_SUCCESS"));
    var r = new AlipayTradeRefundResponse();
    r.setCode("10000");
    r.setBody(
      "{\"alipay_trade_refund_response\":{\"out_trade_no\":\"wrong\"}}"
    );
    when(client.execute(any(AlipayTradeRefundRequest.class))).thenReturn(r);
    assertThrows(ResponseStatusException.class, () ->
      operations.refund(u, str(fresh, "id"))
    );
    assertEquals("REFUNDING", pay.order(u, str(fresh, "id")).get("status"));
    assertEquals(
      "UNKNOWN",
      s
        .one("SELECT * FROM payment_refunds WHERE order_id=?", fresh.get("id"))
        .get("status")
    );
  }

  @Test
  void successfulRequestStillWaitsForRefundQueryAndRetryKeepsIdentifier()
    throws Exception {
    var cfg = config("sandbox");
    cfg.setOperationsEnabled(true);
    var client = mock(AlipayClient.class);
    var pay = service(cfg, client);
    var operations = new PaymentOperations(pay);
    String u = user();
    var o = pay.create(u, Map.of("requestKey", id()));
    pay.notify(notification(o, "TRADE_SUCCESS"));
    String oid = str(o, "id");
    var r = new AlipayTradeRefundResponse();
    r.setCode("10000");
    r.setBody(
      s.encode(
        Map.of(
          "alipay_trade_refund_response",
          Map.of(
            "out_trade_no",
            o.get("merchant_order_no"),
            "trade_no",
            "TRADE_" + oid,
            "refund_fee",
            "9.90",
            "fund_change",
            "N"
          )
        )
      )
    );
    when(client.execute(any(AlipayTradeRefundRequest.class))).thenReturn(r);
    assertEquals("REFUNDING", operations.refund(u, oid).get("status"));
    var first = s.one("SELECT * FROM payment_refunds WHERE order_id=?", oid);
    assertThrows(ResponseStatusException.class, () ->
      operations.refundQuery(u, oid)
    );
    s.db.update(
      "UPDATE payment_refunds SET attempted_at=? WHERE order_id=?",
      now() - 11000,
      oid
    );
    operations.refund(u, oid);
    var capture = org.mockito.ArgumentCaptor.forClass(
      AlipayTradeRefundRequest.class
    );
    verify(client, times(2)).execute(capture.capture());
    assertEquals(
      capture.getAllValues().get(0).getBizContent(),
      capture.getAllValues().get(1).getBizContent()
    );
    assertEquals(
      first.get("request_no"),
      s.decode(capture.getValue().getBizContent()).get("out_request_no")
    );
  }

  @ParameterizedTest
  @ValueSource(strings = { "request", "amount", "total", "status", "seller" })
  void refundQueryRejectsMismatches(String mismatch) throws Exception {
    var cfg = config("sandbox");
    cfg.setOperationsEnabled(true);
    var client = mock(AlipayClient.class);
    var pay = service(cfg, client);
    var operations = new PaymentOperations(pay);
    String u = user();
    var o = pay.create(u, Map.of("requestKey", id()));
    pay.notify(notification(o, "TRADE_SUCCESS"));
    String oid = str(o, "id");
    when(client.execute(any(AlipayTradeRefundRequest.class))).thenThrow(
      new AlipayApiException("synthetic")
    );
    assertThrows(ResponseStatusException.class, () ->
      operations.refund(u, oid)
    );
    s.db.update(
      "UPDATE payment_refunds SET attempted_at=? WHERE order_id=?",
      now() - 11000,
      oid
    );
    var request = s.one("SELECT * FROM payment_refunds WHERE order_id=?", oid);
    var fields = new HashMap<String, Object>(
      Map.of(
        "out_trade_no",
        o.get("merchant_order_no"),
        "trade_no",
        "TRADE_" + oid,
        "out_request_no",
        request.get("request_no"),
        "total_amount",
        "9.90",
        "refund_amount",
        "9.90",
        "refund_status",
        "REFUND_SUCCESS"
      )
    );
    switch (mismatch) {
      case "request" -> fields.put("out_request_no", "wrong");
      case "amount" -> fields.put("refund_amount", "0.01");
      case "total" -> fields.put("total_amount", "1.00");
      case "status" -> fields.put("refund_status", "UNKNOWN");
      case "seller" -> fields.put("seller_id", "wrong");
    }
    var response = new AlipayTradeFastpayRefundQueryResponse();
    response.setCode("10000");
    response.setBody(
      s.encode(Map.of("alipay_trade_fastpay_refund_query_response", fields))
    );
    when(
      client.execute(any(AlipayTradeFastpayRefundQueryRequest.class))
    ).thenReturn(response);
    assertThrows(ResponseStatusException.class, () ->
      operations.refundQuery(u, oid)
    );
    assertEquals("REFUNDING", pay.order(u, oid).get("status"));
    assertEquals(
      "UNKNOWN",
      s.one("SELECT * FROM payment_refunds WHERE order_id=?", oid).get("status")
    );
  }

  @Test
  void invalidMoneyAndReusedEnvironmentAccountAreRejected() {
    for (String amount : Arrays.asList(
      null,
      "",
      "1e2",
      "-1",
      "0",
      "1.001",
      "21474836.48"
    ))
      assertThrows(ResponseStatusException.class, () ->
        PaymentService.cents(amount)
      );
    assertEquals(990, PaymentService.cents("9.90"));
    var cfg = config("sandbox");
    cfg.active().setPrivateKey(privateKey);
    assertTrue(
      cfg
        .issues()
        .stream()
        .anyMatch(v -> v.contains("应用公钥"))
    );
    cfg.active().setPrivateKey(applicationPrivateKey);
    cfg.getProduction().setAppId(cfg.getSandbox().getAppId());
    assertThrows(IllegalArgumentException.class, () ->
      new PaymentService(s, cfg)
    );
  }
}
