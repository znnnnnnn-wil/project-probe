package com.projectprobe;

import static com.projectprobe.Store.*;
import java.util.*;
import org.springframework.stereotype.Service;

@Service
class AnswerDrafts {
  final Store s;
  final TrainingService trainings;
  AnswerDrafts(Store s, TrainingService trainings) { this.s = s; this.trainings = trainings; }
  Map<String, Object> read(String user, String trainingId) {
    var training = trainings.get(user, trainingId);
    var turns = list(training, "turns");
    String turn = turns.isEmpty() ? "" : str(turns.get(turns.size() - 1), "id");
    var rows = s.db.queryForList("SELECT * FROM answer_drafts WHERE training_id=? AND turn_id=? AND updated_at>?",
      trainingId, turn, now() - 30L * 86400000);
    if (!"ACTIVE".equals(training.get("status")) || rows.isEmpty())
      return Map.of("turnId", turn, "answer", "", "version", 0);
    var row = rows.get(0);
    return Map.of("turnId", turn, "answer", row.get("body"), "version", row.get("version"), "updatedAt", row.get("updated_at"));
  }
  Map<String, Object> save(String user, String trainingId, Map<String, Object> input) {
    String turn = required(input, "turnId", 36), answer = str(input, "answer");
    if (answer.length() > 6000 || !(input.get("version") instanceof Number version) ||
        version.doubleValue() != version.intValue() || version.intValue() < 0) throw error(400, "草稿内容或版本不正确");
    return s.locked(user, () -> {
      var training = trainings.get(user, trainingId); var turns = list(training, "turns");
      if (!"ACTIVE".equals(training.get("status")) || turns.isEmpty() ||
          !turn.equals(turns.get(turns.size() - 1).get("id")) || !str(turns.get(turns.size() - 1), "answer").isBlank())
        throw error(409, "当前问题已结束，旧草稿不能覆盖");
      var current = read(user, trainingId);
      int expected = ((Number) current.get("version")).intValue();
      if (version.intValue() != expected) throw error(409, "草稿已在其他设备更新，请重新打开训练并核对");
      s.db.update("DELETE FROM answer_drafts WHERE training_id=?", trainingId);
      s.db.update("INSERT INTO answer_drafts VALUES (?,?,?,?,?)", trainingId, turn, answer, expected + 1, now());
      return read(user, trainingId);
    });
  }
  @org.springframework.scheduling.annotation.Scheduled(fixedDelay = 3600000)
  void purge() { s.db.update("DELETE FROM answer_drafts WHERE updated_at<?", now() - 30L * 86400000); }
}
