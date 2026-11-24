package com.projectprobe;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
class WatchaBillingApi {

  private final Auth auth;
  private final Store store;
  private final WatchaPayment payment;

  WatchaBillingApi(Auth auth, Store store, WatchaPayment payment) {
    this.auth = auth;
    this.store = store;
    this.payment = payment;
  }

  @GetMapping("/api/billing/watcha")
  WatchaPayment.Balance balance(HttpServletRequest request) {
    String user = auth.user(request);
    if (!payment.enabled()) throw Store.error(404, "当前未启用爱猹收");
    store.requireActiveAccount(user);
    var balance = payment.balance(user);
    store.requireActiveAccount(user);
    return balance;
  }
}
