package com.projectprobe;

import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
class LegacyPaymentApi {

  private final Auth auth;
  private final PaymentService payments;
  private final PaymentOperations operations;
  private final TrainingService trainings;

  LegacyPaymentApi(Auth auth, PaymentService payments, PaymentOperations operations, TrainingService trainings) {
    this.auth = auth;
    this.payments = payments;
    this.operations = operations;
    this.trainings = trainings;
  }

  @GetMapping("/shop")
  Object shop(HttpServletRequest request, @RequestParam(defaultValue = "false") boolean summary) {
    return payments.shop(auth.user(request), summary);
  }

  @GetMapping("/orders/{id}")
  Object order(HttpServletRequest request, @PathVariable String id) {
    return payments.order(auth.user(request), id);
  }

  @PostMapping("/orders")
  Object create(HttpServletRequest request, @RequestBody Map<String, Object> body) {
    return payments.create(auth.user(request), body);
  }

  @PostMapping("/orders/{id}/mock-pay")
  Object mock(HttpServletRequest request, @PathVariable String id) {
    return payments.mock(auth.user(request), id);
  }

  @PostMapping("/orders/{id}/checkout")
  Object checkout(HttpServletRequest request, @PathVariable String id) {
    payments.requireLegacyMode();
    return Map.of("formHtml", payments.checkout(auth.user(request), id));
  }

  @PostMapping("/orders/{id}/sync")
  Object sync(HttpServletRequest request, @PathVariable String id) {
    payments.requireLegacyMode();
    return payments.sync(auth.user(request), id);
  }

  @PostMapping("/orders/{id}/close")
  Object close(HttpServletRequest request, @PathVariable String id) {
    payments.requireLegacyMode();
    return operations.close(auth.user(request), id);
  }

  @PostMapping("/orders/{id}/cash-refund")
  Object cashRefund(HttpServletRequest request, @PathVariable String id) {
    payments.requireLegacyMode();
    return operations.refund(auth.user(request), id);
  }

  @PostMapping("/orders/{id}/refund-query")
  Object refundQuery(HttpServletRequest request, @PathVariable String id) {
    payments.requireLegacyMode();
    return operations.refundQuery(auth.user(request), id);
  }

  @PostMapping("/trainings/{id}/refund")
  Object refundTraining(HttpServletRequest request, @PathVariable String id) {
    return trainings.refund(auth.user(request), id);
  }

  @PostMapping(value = "/payments/notify", produces = "text/plain")
  String notify(@RequestParam MultiValueMap<String, String> params) {
    if (params.values().stream().anyMatch(values -> values.size() != 1)) return "failure";
    return payments.notify(params.toSingleValueMap());
  }
}
