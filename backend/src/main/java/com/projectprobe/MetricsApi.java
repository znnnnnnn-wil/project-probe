package com.projectprobe;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
class MetricsApi {
  final Auth auth; final UsageMetrics metrics; final TrainingService trainings;
  MetricsApi(Auth auth, UsageMetrics metrics, TrainingService trainings) {
    this.auth = auth; this.metrics = metrics; this.trainings = trainings;
  }
  @GetMapping("/account/usage") Object usage(HttpServletRequest r) { return metrics.own(auth.user(r)); }
  @PostMapping("/trainings/{id}/view") void view(HttpServletRequest r, @PathVariable String id) { metrics.view(auth.user(r), id, trainings); }
  @GetMapping("/operator/metrics") Object operator(HttpServletRequest r) { return metrics.operator(auth.user(r)); }
}
