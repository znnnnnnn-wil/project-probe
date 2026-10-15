package com.projectprobe;

import static com.projectprobe.Store.*;
import java.util.*;

final class ReportComparison {
  static Map<String, Object> input(Map<String, Object> body, Map<String, Object> original) {
    var result = new LinkedHashMap<>(original);
    if (!"RETEST".equals(body.get("kind"))) return result;
    result.put("focus", body.get("focus"));
    result.put("previousReport", body.get("previousReport"));
    var previous = answered(body, "previousTurns");
    var evidence = new ArrayList<Map<String, Object>>();
    for (int i = 0; i < previous.size(); i++) evidence.add(Map.of(
      "id", "PT" + (i + 1), "question", str(previous.get(i), "question"),
      "answer", str(previous.get(i), "answer")));
    result.put("previousAnsweredTurns", evidence);
    return result;
  }

  static List<Map<String, Object>> answered(Map<String, Object> body, String key) {
    return list(new LinkedHashMap<>(body), key).stream().filter(t -> !str(t, "answer").isBlank()).toList();
  }

  static List<Map<String, Object>> build(Map<String, Object> output, Map<String, Object> body) {
    if (!"RETEST".equals(body.get("kind"))) return List.of();
    var previous = answered(body, "previousTurns");
    var current = answered(body, "turns");
    if (!output.containsKey("comparisons")) return List.of(Map.of(
      "topic", str(body, "focus"), "status", "NEEDS_REVIEW",
      "assessment", "请结合变化条件核对两轮原回答，尚未生成自动比较结论。",
      "previousEvidence", previous.stream().limit(2).map(ReportComparison::evidence).toList(),
      "currentEvidence", current.stream().limit(2).map(ReportComparison::evidence).toList()));
    var result = new ArrayList<Map<String, Object>>();
    for (var entry : modelObjects(output, "comparisons", 3)) {
      String status = modelText(entry, "status", 30);
      if (!Set.of("EXPLAINED", "PARTIAL", "UNRESOLVED", "NOT_COMPARABLE").contains(status))
        throw error(503, "复测比较状态不正确");
      var before = references(entry, "previousTurnIds", previous, "PT");
      var after = references(entry, "currentTurnIds", current, "T");
      if (!"NOT_COMPARABLE".equals(status) && (before.isEmpty() || after.isEmpty()))
        throw error(503, "复测结论缺少两轮回答证据");
      String topic = modelText(entry, "topic", 200);
      if (!topic.equals(str(body, "focus"))) throw error(503, "复测比较偏离所选主题");
      result.add(Map.of("topic", topic, "status", status,
        "assessment", modelText(entry, "assessment", 500),
        "previousEvidence", before, "currentEvidence", after));
    }
    return result;
  }

  static List<Map<String, Object>> references(Map<String, Object> entry, String key,
      List<Map<String, Object>> turns, String prefix) {
    if (!(entry.get(key) instanceof List<?> ids) || ids.size() > 2)
      throw error(503, "复测比较引用格式不正确");
    var result = new ArrayList<Map<String, Object>>();
    for (Object ref : ids) {
      int index = -1;
      for (int i = 0; i < turns.size(); i++)
        if ((prefix + (i + 1)).equals(ref) || turns.get(i).get("id").equals(ref)) index = i;
      if (index < 0) throw error(503, "复测比较引用不存在");
      result.add(evidence(turns.get(index)));
    }
    return result;
  }

  static Map<String, Object> evidence(Map<String, Object> turn) {
    return Map.of("turnId", str(turn, "id"), "question", str(turn, "question"), "quote", str(turn, "answer"));
  }
}
