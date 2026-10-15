package com.projectprobe;

import static com.projectprobe.Store.*;
import java.util.*;

final class QuestionCoverage {
  static List<Map<String, Object>> summarize(Map<String, Object> body) {
    var turns = new ArrayList<>(list(new LinkedHashMap<>(body), "historyTurns"));
    turns.addAll(list(new LinkedHashMap<>(body), "turns"));
    var topics = new LinkedHashMap<String, Map<String, Object>>();
    for (var turn : turns) {
      String topic = str(turn, "topic"), answer = str(turn, "answer");
      if (topic.isBlank()) continue;
      topics.put(topic, Map.of("topic", topic, "state", answer.isBlank() ? "未回答" :
        answer.matches("(?s).*(不会|不清楚|不确定|未验证|没有验证|不知道|暂时跳过).*") ? "自报待补充" : "已有回答，质量未独立验证",
        "question", str(turn, "question")));
    }
    return topics.values().stream().skip(Math.max(0, topics.size() - 24)).toList();
  }

  static boolean nearDuplicate(String candidate, String previous) {
    String a = ModelService.normalizeQuestion(candidate), b = ModelService.normalizeQuestion(previous);
    if (a.equals(b)) return true;
    if (Math.min(a.length(), b.length()) < 16) return false;
    // 数值条件改变可能是有效复测，不在这里拒绝。
    if (!a.replaceAll("[^0-9.-]", "").equals(b.replaceAll("[^0-9.-]", ""))) return false;
    var left = grams(a); var right = grams(b); var union = new HashSet<>(left); union.addAll(right);
    left.retainAll(right);
    return !union.isEmpty() && (double) left.size() / union.size() >= 0.86;
  }

  static Set<String> grams(String text) {
    var result = new HashSet<String>();
    for (int i = 0; i < text.length() - 1; i++) result.add(text.substring(i, i + 2));
    return result;
  }
}
