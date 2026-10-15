package com.projectprobe;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/projects/{id}/practice")
class PracticeApi {
  final Auth auth; final ProjectPractice practice;
  PracticeApi(Auth auth, ProjectPractice practice) { this.auth = auth; this.practice = practice; }
  @GetMapping Object get(HttpServletRequest r, @PathVariable String id) { return practice.get(auth.user(r), id); }
  @PostMapping Object run(HttpServletRequest r, @PathVariable String id, @RequestBody Map<String, Object> input) { return practice.run(auth.user(r), id, input); }
}
