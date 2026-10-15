package com.projectprobe;

import static com.projectprobe.Store.*;
import java.util.*;
import org.springframework.stereotype.Service;

@Service
class TrainingSupport {
  final Store s;
  final TrainingService trainings;
  @org.springframework.beans.factory.annotation.Autowired FeedbackService feedback;
  TrainingSupport(Store s, TrainingService trainings) { this.s = s; this.trainings = trainings; }

  Map<String, Object> submit(String user, String id, Map<String, Object> input) {
    String kind = required(input, "kind", 20), turnId = required(input, "turnId", 36);
    String request = required(input, "requestKey", 100), detail = str(input, "detail").strip();
    if (!Set.of("CLARIFY", "CORRECT", "FEEDBACK").contains(kind) || detail.length() > 1000)
      throw error(400, "辅助操作或说明不正确");
    if (!kind.equals("CLARIFY") && detail.isBlank()) throw error(400, "请填写问题说明");
    boolean generate = s.locked(user, () -> {
      var row = trainings.row(user, id); var body = s.decode(row.get("body"));
      var events = list(body, "supportEvents");
      if (events.stream().anyMatch(e -> request.equals(e.get("requestKey")))) return false;
      var turns = list(body, "turns");
      if (!"ACTIVE".equals(row.get("status")) || turns.isEmpty() ||
          !turnId.equals(turns.get(turns.size() - 1).get("id"))) throw error(409, "当前问题已变化，请刷新");
      if (events.size() >= 20) throw error(429, "本轮辅助操作次数已达上限");
      if (!kind.equals("FEEDBACK") && events.stream().filter(e ->
          turnId.equals(e.get("turnId")) && !"FEEDBACK".equals(e.get("kind"))).count() >= 3)
        throw error(429, "本题已调整三次，可提交现有回答或稍后再练");
      var event = Map.<String, Object>of("requestKey", request, "kind", kind, "detail", detail,
        "turnId", turnId, "createdAt", now(), "question", turns.get(turns.size() - 1).get("question"));
      events.add(event);
      if (kind.equals("FEEDBACK")) feedback.submit(user, Map.of("kind", "QUESTION", "detail", detail, "requestKey", request), id);
      if (!kind.equals("FEEDBACK")) {
        body.put("questionRequest", event); body.put("operation", "REVISE_QUESTION");
      }
      trainings.update(id, kind.equals("FEEDBACK") ? "ACTIVE" : "PENDING", body);
      return !kind.equals("FEEDBACK");
    });
    return generate ? trainings.generate(user, id) : trainings.get(user, id);
  }
}
