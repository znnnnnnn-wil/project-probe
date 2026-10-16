package com.projectprobe;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
class FeedbackApi {
  final Auth auth; final FeedbackService feedback;
  FeedbackApi(Auth auth, FeedbackService feedback) { this.auth = auth; this.feedback = feedback; }
  @GetMapping("/feedback") Object own(HttpServletRequest r) { return feedback.own(auth.user(r)); }
  @PostMapping("/feedback") Object submit(HttpServletRequest r, @RequestBody Map<String, Object> input) { return feedback.submit(auth.user(r), input, ""); }
  @GetMapping("/operator/feedback") Object operator(HttpServletRequest r) { return feedback.operator(auth.user(r)); }
  @GetMapping("/operator/feedback-page") Object page(HttpServletRequest r, @RequestParam(defaultValue="OPEN") String status,
      @RequestParam(defaultValue="") String search, @RequestParam(defaultValue="0") int offset) {
    return feedback.page(auth.user(r), status, search, offset);
  }
  @PostMapping("/operator/feedback/{id}") void reply(HttpServletRequest r, @PathVariable String id, @RequestBody Map<String, Object> input) { feedback.reply(auth.user(r), id, input); }
}
