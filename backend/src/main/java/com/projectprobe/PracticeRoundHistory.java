package com.projectprobe;

import static com.projectprobe.Store.*;

import java.util.*;

final class PracticeRoundHistory {
  static final String NEEDS_PRACTICE = "NEEDS_PRACTICE";
  static final String ANSWERED_INDEPENDENTLY = "ANSWERED_INDEPENDENTLY";
  private static final int RECENT_ROUNDS = 8;

  static List<Map<String, Object>> load(Store store, String user, String project, String modelMode) {
    var rounds = store.db.queryForList(
      "SELECT body FROM project_practice_rounds WHERE user_id=? AND project_id=? AND status='COMPLETED' ORDER BY round_number DESC LIMIT ?",
      user, project, RECENT_ROUNDS);
    var history = new ArrayList<Map<String, Object>>();
    for (var row : rounds) {
      var body = store.decode(row.get("body"));
      var report = PracticeRetest.object(body.get("report"));
      String previousMode = str(body, "modelMode");
      if (previousMode.isBlank()) previousMode = str(report, "mode");
      var findings = "live".equals(previousMode) ? list(report, "findings") : List.<Map<String, Object>>of();
      var turns = list(body, "turns");
      for (int i = turns.size() - 1; i >= 0; i--) {
        var turn = turns.get(i);
        String question = str(turn, "question"), topic = str(turn, "topic");
        String targetId = str(turn, "reviewOf");
        if (targetId.isBlank()) targetId = str(turn, "id");
        if (question.isBlank() || targetId.isBlank()) continue;
        if (topic.isBlank()) topic = question;

        String turnId = str(turn, "id");
        String gap = findings.stream().filter(finding -> references(finding, turnId))
          .map(finding -> str(finding, "assessment")).filter(text -> !text.isBlank()).findFirst().orElse("");
        String answer = str(turn, "answer");
        var exchanges = list(turn, "exchanges");
        boolean explained = !str(turn, "explanation").isBlank()
          || exchanges.stream().anyMatch(exchange -> Boolean.TRUE.equals(exchange.get("explained")));
        boolean needsPractice = explained || Boolean.FALSE.equals(turn.get("answeredIndependently")) || answer.isBlank() || !gap.isBlank()
          || answer.lines().anyMatch(PracticeDialogue::directExplanationRequest);
        boolean answeredIndependently = modelMode.equals(previousMode) && !exchanges.isEmpty();
        if (!needsPractice && !answeredIndependently) continue;
        if (gap.isBlank() && needsPractice) gap = explained ? "在讲解后完成，需要独立复测。" : "上次未能独立作答。";

        var entry = Map.<String, Object>of("id", targetId, "question", question, "topic", topic,
          "outcome", needsPractice ? NEEDS_PRACTICE : ANSWERED_INDEPENDENTLY, "feedback", excerpt(gap));
        if (history.stream().noneMatch(previous ->
            previous.get("id").equals(entry.get("id")) || sameTopic(previous, entry))) history.add(entry);
      }
    }
    return history;
  }

  private static boolean references(Map<String, Object> finding, String turnId) {
    return !turnId.isBlank() && (
      (finding.get("turnIds") instanceof List<?> ids && ids.contains(turnId))
        || list(new LinkedHashMap<>(finding), "evidence").stream().anyMatch(entry -> turnId.equals(entry.get("turnId"))));
  }

  private static String excerpt(String text) {
    int end = Math.min(text.length(), 160);
    if (end < text.length() && end > 0 && Character.isHighSurrogate(text.charAt(end - 1))) end--;
    return text.substring(0, end);
  }

  static Map<String, Object> nextReview(Map<String, Object> body, List<Map<String, Object>> history) {
    var current = list(new LinkedHashMap<>(body), "turns");
    var goals = QuestionCoverage.budgets(body);
    String scope = ModelService.normalizeQuestion(str(body, "interviewTopic"));
    for (var entry : history) {
      if (!NEEDS_PRACTICE.equals(entry.get("outcome"))) continue;
      if (goals.getOrDefault(QuestionCoverage.goal(entry), 0L) >= 2
        || current.stream().anyMatch(turn -> entry.get("id").equals(turn.get("reviewOf")) || sameTopic(entry, turn))) continue;
      String topic = ModelService.normalizeQuestion(str(entry, "topic"));
      if (scope.isBlank() || (!topic.isBlank() && scope.contains(topic))
        || topic.contains(scope) || ModelService.normalizeQuestion(str(entry, "question")).contains(scope)) return entry;
    }
    return Map.of();
  }

  static boolean alreadyAnswered(List<Map<String, Object>> history, Map<String, Object> candidate) {
    return history.stream().anyMatch(entry ->
      ANSWERED_INDEPENDENTLY.equals(entry.get("outcome")) &&
        QuestionCoverage.nearDuplicate(str(entry, "question"), str(candidate, "question")));
  }

  static boolean sameTopic(Map<String, Object> first, Map<String, Object> second) {
    String topic = ModelService.normalizeQuestion(str(first, "topic"));
    return (!topic.isBlank() && topic.equals(ModelService.normalizeQuestion(str(second, "topic"))))
      || QuestionCoverage.nearDuplicate(str(first, "question"), str(second, "question"));
  }
}
