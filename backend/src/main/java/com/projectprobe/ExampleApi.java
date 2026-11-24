package com.projectprobe;

import static com.projectprobe.Store.*;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.core.type.TypeReference;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.*;
import org.springframework.core.io.ClassPathResource;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/examples")
class ExampleApi {
  @JsonIgnoreProperties(ignoreUnknown = true)
  private record Example(String id, Map<String, Object> project) {}

  private final List<Example> catalog;
  private final ExampleSessions sessions;
  private final ProjectService projects;
  private final ProjectPractice practice;
  private final FeedbackService feedback;

  ExampleApi(Store store, ExampleSessions sessions, ProjectService projects, ProjectPractice practice, FeedbackService feedback) throws IOException {
    try (var input = new ClassPathResource("example-projects.json").getInputStream()) {
      catalog = store.json.readValue(input, new TypeReference<>() {});
    }
    this.sessions = sessions;
    this.projects = projects;
    this.practice = practice;
    this.feedback = feedback;
  }

  @PostMapping("/projects/{sample}/open")
  Object open(HttpServletRequest request, HttpServletResponse response, @PathVariable String sample) {
    var example = catalog.stream().filter(entry -> entry.id().equals(sample)).findFirst()
      .orElseThrow(() -> error(404, "示例项目不存在"));
    return sessions.open(request, response, user -> {
      String id = ExampleQuestions.projectId(user, sample);
      var project = projects.openExample(user, id, example.project());
      practice.refreshLegacyExampleOpener(user, id, sample);
      return project;
    });
  }

  @GetMapping("/projects/{id}")
  Object get(HttpServletRequest request, @PathVariable String id) {
    return projects.get(sessions.require(request), id);
  }

  @PostMapping("/feedback")
  Object review(HttpServletRequest request, @RequestBody Map<String, Object> input) {
    return feedback.submit(sessions.require(request), Map.of(
      "kind", "GENERAL",
      "requestKey", required(input, "requestKey", 100),
      "detail", required(input, "detail", 2000)
    ), "");
  }
}
