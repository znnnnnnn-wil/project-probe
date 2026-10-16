package com.projectprobe;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
class MetricsApi {
  final Auth auth; final UsageMetrics metrics; final PaymentService payments; final TrainingService trainings;
  MetricsApi(Auth auth, UsageMetrics metrics, PaymentService payments, TrainingService trainings) {
    this.auth = auth; this.metrics = metrics; this.payments = payments; this.trainings = trainings;
  }
  @GetMapping("/account/usage") Object usage(HttpServletRequest r) { return metrics.ownScoped(auth.user(r), payments); }
  @GetMapping("/account/access") Object access(HttpServletRequest r) {
    String user = auth.user(r); return java.util.Map.of("userId", user, "operator", metrics.isOperator(user));
  }
  @PostMapping("/trainings/{id}/view") void view(HttpServletRequest r, @PathVariable String id) { metrics.view(auth.user(r), id, trainings); }
  @GetMapping("/operator/metrics") Object operator(HttpServletRequest r) { return metrics.operator(auth.user(r)); }
}
