package com.projectprobe;

import jakarta.servlet.http.*;
import java.util.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class Api {

  final Store s;
  final Auth auth;
  final ProjectService projects;
  final TrainingService trainings;
  final PaymentService payments;
  final ModelService model;
  final PaymentOperations paymentOperations;

  Api(
    Store s,
    Auth auth,
    ProjectService projects,
    TrainingService trainings,
    PaymentService payments,
    ModelService model,
    PaymentOperations paymentOperations
  ) {
    this.s = s;
    this.auth = auth;
    this.projects = projects;
    this.trainings = trainings;
    this.payments = payments;
    this.model = model;
    this.paymentOperations = paymentOperations;
  }

  @GetMapping("/health")
  Object health() {
    return Map.of("status", "ok");
  }

  @GetMapping("/config")
  Object config() {
    return Map.of(
      "modelMode",
      model.mode,
      "paymentMode",
      payments.mode,
      "paymentConfigured",
      payments.configured()
    );
  }

  @PostMapping("/auth/register")
  Object register(@RequestBody Map<String, Object> b, HttpServletResponse r) {
    return auth.login(b, true, r);
  }

  @PostMapping("/auth/login")
  Object login(@RequestBody Map<String, Object> b, HttpServletResponse r) {
    return auth.login(b, false, r);
  }

  @PostMapping("/auth/logout")
  void logout(HttpServletRequest q, HttpServletResponse r) {
    auth.logout(q, r);
  }

  @GetMapping("/me")
  Object me(HttpServletRequest r) {
    return s.one("SELECT id,username FROM app_users WHERE id=?", auth.user(r));
  }

  @GetMapping("/projects")
  Object projects(HttpServletRequest r) {
    return projects.all(auth.user(r));
  }

  @GetMapping("/projects/{id}")
  Object project(HttpServletRequest r, @PathVariable String id) {
    return projects.get(auth.user(r), id);
  }

  @PostMapping("/projects")
  Object createProject(
    HttpServletRequest r,
    @RequestBody Map<String, Object> b
  ) {
    return projects.save(auth.user(r), null, b);
  }

  @PutMapping("/projects/{id}")
  Object saveProject(
    HttpServletRequest r,
    @PathVariable String id,
    @RequestBody Map<String, Object> b
  ) {
    return projects.save(auth.user(r), id, b);
  }

  @PostMapping("/projects/{id}/extract")
  Object extract(HttpServletRequest r, @PathVariable String id) {
    return projects.extract(auth.user(r), id);
  }

  @PostMapping("/projects/{id}/confirm")
  Object confirm(
    HttpServletRequest r,
    @PathVariable String id,
    @RequestBody Map<String, Object> b
  ) {
    return projects.confirm(auth.user(r), id, b);
  }

  @GetMapping("/trainings")
  Object trainings(HttpServletRequest r) {
    return trainings.all(auth.user(r));
  }

  @GetMapping("/trainings/{id}")
  Object training(HttpServletRequest r, @PathVariable String id) {
    return trainings.get(auth.user(r), id);
  }

  @PostMapping("/trainings")
  Object start(HttpServletRequest r, @RequestBody Map<String, Object> b) {
    return trainings.start(auth.user(r), b);
  }

  @PostMapping("/trainings/{id}/answer")
  Object answer(
    HttpServletRequest r,
    @PathVariable String id,
    @RequestBody Map<String, Object> b
  ) {
    return trainings.answer(auth.user(r), id, b);
  }

  @PostMapping("/trainings/{id}/finish")
  Object finish(HttpServletRequest r, @PathVariable String id) {
    return trainings.finish(auth.user(r), id);
  }

  @PostMapping("/trainings/{id}/retry")
  Object retry(HttpServletRequest r, @PathVariable String id) {
    return trainings.generate(auth.user(r), id);
  }

  @PostMapping("/trainings/{id}/refund")
  Object refund(HttpServletRequest r, @PathVariable String id) {
    return trainings.refund(auth.user(r), id);
  }

  @GetMapping("/shop")
  Object shop(HttpServletRequest r) {
    return payments.shop(auth.user(r));
  }

  @PostMapping("/orders")
  Object order(HttpServletRequest r, @RequestBody Map<String, Object> b) {
    return payments.create(auth.user(r), b);
  }

  @PostMapping("/orders/{id}/mock-pay")
  Object mock(HttpServletRequest r, @PathVariable String id) {
    return payments.mock(auth.user(r), id);
  }

  @PostMapping("/orders/{id}/checkout")
  Object checkout(HttpServletRequest r, @PathVariable String id) {
    return Map.of("formHtml", payments.checkout(auth.user(r), id));
  }

  @PostMapping("/orders/{id}/sync")
  Object sync(HttpServletRequest r, @PathVariable String id) {
    return payments.sync(auth.user(r), id);
  }

  @PostMapping("/orders/{id}/close")
  Object closeOrder(HttpServletRequest r, @PathVariable String id) {
    return paymentOperations.close(auth.user(r), id);
  }

  @PostMapping("/orders/{id}/cash-refund")
  Object cashRefund(HttpServletRequest r, @PathVariable String id) {
    return paymentOperations.refund(auth.user(r), id);
  }

  @PostMapping("/orders/{id}/refund-query")
  Object refundQuery(HttpServletRequest r, @PathVariable String id) {
    return paymentOperations.refundQuery(auth.user(r), id);
  }

  @GetMapping("/orders/{id}")
  Object orderStatus(HttpServletRequest r, @PathVariable String id) {
    return payments.order(auth.user(r), id);
  }

  @PostMapping(value = "/payments/notify", produces = "text/plain")
  String notify(
    @RequestParam org.springframework.util.MultiValueMap<String, String> params
  ) {
    if (
      params
        .values()
        .stream()
        .anyMatch(v -> v.size() != 1)
    ) return "failure";
    return payments.notify(params.toSingleValueMap());
  }
}
