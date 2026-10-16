package com.projectprobe;

import static com.projectprobe.Store.*;
import java.util.*;

final class QuestionCoverage {
  static String goal(Map<String, Object> turn) {
    String text = (str(turn, "question") + " " + str(turn, "topic")).toLowerCase(Locale.ROOT);
    if (text.matches("(?s).*(事务|transactional).*(边界|同一|两个|分开|独立|提交|回滚).*")) return "事务边界";
    if (text.matches("(?s).*(repository|派生查询|方法签名|自定义sql).*")) return "查询实现";
    if (text.matches("(?s).*(参数.*校验|@valid|手动if|校验.*实现).*")) return "参数校验实现";
    if (text.matches("(?s).*(幂等|重复提交|重复请求|重复执行).*")) return "幂等与重试";
    if (text.matches("(?s).*(测试|断言|压测|验证).*")) return "验证证据";
    if (text.matches("(?s).*(负责|职责|亲自|分工).*")) return "职责边界";
    return ModelService.normalizeQuestion(str(turn, "topic"));
  }

  static Map<String, Long> budgets(Map<String, Object> body) {
    var result = new LinkedHashMap<String, Long>();
    for (var turn : list(new LinkedHashMap<>(body), "turns")) result.merge(goal(turn), 1L, Long::sum);
    return result;
  }

  static void validateGoal(Map<String, Object> output, Map<String, Object> body) {
    if ("REVISE_QUESTION".equals(body.get("operation"))) return;
    var turns = list(body, "turns");
    if (!turns.isEmpty()) {
      var last = turns.get(turns.size() - 1);
      if ("暂时不会，这部分需要补充。".equals(str(last, "answer")) && goal(last).equals(goal(output)))
        throw error(503, "用户已明确暂时不会此目标，请记录缺口并换一个未覆盖目标");
    }
    if ("RETEST".equals(body.get("kind"))) {
      String focus = goal(Map.of("question", str(body, "focus")));
      String candidate = goal(Map.of("question", str(output, "question")));
      // 查询与验证等目标可相关联；只拦截明确转向参数校验的无关追问。
      if (Set.of("事务边界", "查询实现", "幂等与重试").contains(focus) && candidate.equals("参数校验实现"))
        throw error(503, "复测偏离所选目标，请围绕focus及首题变化条件继续询问");
    }
    if (budgets(body).getOrDefault(goal(output), 0L) < 2) return;
    String condition = str(output, "changedCondition"), question = str(output, "question");
    if (condition.length() < 4 || condition.length() > 150 || !question.contains(condition) ||
        !(question.contains("假设") || question.contains("如果")) || list(body, "turns").stream()
          .anyMatch(t -> str(t, "question").contains(condition)))
      throw error(503, "本轮已问过该目标，请选择未覆盖目标，或明确改变假设条件并返回changedCondition");
  }

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

  static void validateBurden(String question) {
    // 保守识别显式复合询问，不把字数或一个问号误当成单一目标。
    var requests = java.util.regex.Pattern.compile("如何|怎样|怎么|为什么|为何|哪些|什么|哪一|是否|能否|多少|多长|何时|在哪里").matcher(question);
    int count = 0;
    while (requests.find()) if (++count >= 3)
      throw error(503, "单题并列了多个询问，请只保留一个可独立回答的具体目标");
  }

  static Set<String> grams(String text) {
    var result = new HashSet<String>();
    for (int i = 0; i < text.length() - 1; i++) result.add(text.substring(i, i + 2));
    return result;
  }
}
