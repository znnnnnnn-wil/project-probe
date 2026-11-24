package com.projectprobe;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.*;
import static org.springframework.test.web.client.response.MockRestResponseCreators.*;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;
import org.springframework.web.server.ResponseStatusException;

class WatchaPaymentTest {

  private MockRestServiceServer server;
  private WatchaPayment payment;

  @BeforeEach
  void bindProvider() {
    var builder = RestClient.builder();
    server = MockRestServiceServer.bindTo(builder).build();
    payment = new WatchaPayment("watcha", "sandbox", "test-key", "ent_test", builder);
  }

  @Test
  void balanceAndCheckoutUseAuthenticatedUser() {
    server.expect(requestTo("https://pay.watcha.cn/v1/entitlements/access"))
      .andExpect(method(HttpMethod.POST))
      .andExpect(header("Authorization", "Bearer test-key"))
      .andExpect(content().json("""
        {"user_id":"customer-1","entitlement_id":"ent_test"}
        """))
      .andRespond(withSuccess("""
        {"access":"purchase_required","entitlement":{"type":"quota","remaining":0},
         "purchase":{"url":"https://pay.watcha.cn/checkout/temporary"}}
        """, MediaType.APPLICATION_JSON));
    var balance = payment.balance("customer-1");
    assertEquals(0, balance.remaining());
    assertEquals("https://pay.watcha.cn/checkout/temporary", balance.purchaseUrl());
    assertEquals("watcha:sandbox:ent_test", payment.scope());
    server.verify();
  }

  @Test
  void onlyConfirmedInsufficientQuotaMapsToPurchaseRequired() {
    server.expect(requestTo("https://pay.watcha.cn/v1/entitlements/consume"))
      .andExpect(content().json("""
        {"user_id":"customer-1","entitlement_id":"ent_test","amount":1,"idempotency_key":"training-1"}
        """))
      .andRespond(withStatus(HttpStatus.CONFLICT).contentType(MediaType.APPLICATION_JSON)
        .body("{\"error\":{\"code\":\"insufficient_quota\"}}"));
    assertEquals(402, assertThrows(ResponseStatusException.class,
      () -> payment.consume("customer-1", "training-1")).getStatusCode().value());
    server.verify();
  }

  @Test
  void uncertainDeductionAndUnsafeLinkFailClosed() {
    server.expect(requestTo("https://pay.watcha.cn/v1/entitlements/consume"))
      .andRespond(withSuccess("{\"consumed\":0}", MediaType.APPLICATION_JSON));
    server.expect(requestTo("https://pay.watcha.cn/v1/entitlements/access"))
      .andRespond(withSuccess("""
        {"access":"purchase_required","purchase":{"url":"javascript:alert(1)"}}
        """, MediaType.APPLICATION_JSON));
    assertEquals(503, assertThrows(ResponseStatusException.class,
      () -> payment.consume("customer-1", "training-1")).getStatusCode().value());
    assertEquals(503, assertThrows(ResponseStatusException.class,
      () -> payment.balance("customer-1")).getStatusCode().value());
    server.verify();
  }
}
