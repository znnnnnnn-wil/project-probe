package com.projectprobe;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.HandlerMapping;

@RestController
@RequestMapping({"/api", "/api/{scope:examples}"})
class PracticeApi {
  final Auth auth; final ProjectPractice practice; final PracticeRetest retest; final InterviewSpeech speech;
  final InputService inputs; final ExampleSessions examples; final InterviewTranscription realtime;
  PracticeApi(Auth auth, ProjectPractice practice, PracticeRetest retest, InterviewSpeech speech, InputService inputs,
    ExampleSessions examples, InterviewTranscription realtime) {
    this.auth = auth; this.practice = practice; this.retest = retest; this.speech = speech;
    this.inputs = inputs; this.examples = examples; this.realtime = realtime;
  }

  private boolean exampleRequest(HttpServletRequest request) {
    return request.getAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE) instanceof Map<?, ?> variables
      && "examples".equals(variables.get("scope"));
  }

  private String user(HttpServletRequest request) {
    return exampleRequest(request) ? examples.require(request) : auth.user(request);
  }

  @GetMapping("/practice-history") Object history(HttpServletRequest r) {
    String user = exampleRequest(r) ? examples.find(r) : auth.user(r);
    return user == null ? List.of() : practice.history(user);
  }
  @GetMapping("/projects/{id}/practice") Object get(
    HttpServletRequest r, @PathVariable String id, @RequestParam(defaultValue = "") String roundId
  ) { return practice.get(user(r), id, roundId); }
  @PostMapping("/projects/{id}/practice") Object run(HttpServletRequest r, HttpServletResponse response,
      @PathVariable String id, @RequestBody Map<String, Object> input) throws java.io.IOException {
    String user = user(r);
    boolean example = exampleRequest(r);
    if (!"application/x-ndjson".equals(r.getHeader("Accept"))) return practice.run(user, id, input, example);
    response.setContentType("application/x-ndjson;charset=UTF-8");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Accel-Buffering", "no");
    java.util.function.Consumer<Map<String, Object>> send = event -> {
      try {
        var writer = response.getWriter();
        writer.println(practice.s.encode(event));
        writer.flush();
      } catch (java.io.IOException ignored) {
        // A disconnected client can still resume the saved exchange.
      }
    };
    try {
      var result = practice.run(user, id, input, example, sentence ->
        send.accept(Map.of("sentence", sentence, "speechTicket", speech.sentenceTicket(user, id, sentence))));
      send.accept(Map.of("result", result));
    } catch (org.springframework.web.server.ResponseStatusException e) {
      if (!response.isCommitted()) {
        int status = e.getStatusCode().value();
        response.setStatus(status);
        if (status == 429 || status == 503) response.setHeader("Retry-After", "3");
      }
      send.accept(Map.of("status", e.getStatusCode().value(), "message", java.util.Objects.toString(e.getReason(), "训练请求失败")));
    }
    return null;
  }
  @PostMapping("/projects/{id}/practice/cancel") Object cancel(HttpServletRequest r, @PathVariable String id, @RequestBody Map<String, Object> input) {
    return practice.cancel(user(r), id, Store.required(input, "roundId", 36));
  }
  @PostMapping("/projects/{id}/practice/score") Object score(HttpServletRequest r, @PathVariable String id, @RequestBody Map<String, Object> input) {
    return practice.score(user(r), id, Store.required(input, "roundId", 36));
  }
  @PostMapping("/projects/{id}/practice/tts") void tts(HttpServletRequest req, HttpServletResponse res, @PathVariable String id, @RequestBody Map<String, Object> input) {
    String user = user(req);
    if (input.containsKey("speechTicket")) {
      speech.speakSentence(user, id, Store.str(input, "sentence"), Store.str(input, "speechTicket"), res);
    } else {
      speech.speak(user, id, Store.str(input, "turnId"), input.get("exchangeCount"), res);
    }
  }
  @PostMapping(value = "/projects/{id}/practice/transcribe", consumes = "multipart/form-data")
  Map<String, Object> transcribe(
    HttpServletRequest r,
    @PathVariable String id,
    @RequestParam("turnId") String turnId,
    @RequestParam(value = "exchangeCount", required = false) Integer exchangeCount,
    @RequestParam("file") MultipartFile file
  ) {
    String user = user(r);
    practice.requireUnansweredTurn(user, id, turnId, exchangeCount);
    var result = inputs.transcribe(file);
    practice.requireUnansweredTurn(user, id, turnId, exchangeCount);
    return result;
  }
  @GetMapping("/projects/{id}/practice/transcribe-stream")
  void transcribeStream(HttpServletRequest request, HttpServletResponse response, @PathVariable String id,
      @RequestParam String turnId, @RequestParam int exchangeCount) throws java.io.IOException, jakarta.websocket.DeploymentException {
    String user = user(request);
    realtime.open(request, response, () -> practice.requireUnansweredTurn(user, id, turnId, exchangeCount));
  }
  @PostMapping("/projects/{id}/practice/retest") Object retest(HttpServletRequest r, @PathVariable String id, @RequestBody Map<String, Object> input) {
    return retest.run(user(r), id, input);
  }
}
