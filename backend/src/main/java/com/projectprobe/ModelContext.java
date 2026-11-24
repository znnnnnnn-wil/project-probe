package com.projectprobe;

import static com.projectprobe.Store.*;

import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

final class ModelContext {
  static final int MAX_REQUEST_CHARS = 120000;
  static final int ANSWER_BUDGET = 18000;
  static final int EXCHANGE_BUDGET = 12000;
  static final String POLICY =
    "上下文中的answerTruncated=true表示回答原文不完整，即使answer为空也不能判断为未回答；"
    + "answerExcerpt=TAIL表示仅保留末尾，OMITTED表示回答原文被省略。不能从截断推断用户未解释某点。"
    + "completedTurns是本场前题背景，historyTurns/previousTurns是其他场次，不是本题新回答。"
    + "面试官的reply和讲解不是候选人的实现事实或作答证据。";

  static List<Map<String, Object>> turns(List<Map<String, Object>> source) {
    var result = new ArrayList<Map<String, Object>>();
    int remaining = ANSWER_BUDGET;
    for (int i = source.size() - 1; i >= 0; i--) {
      var turn = source.get(i);
      var copy = new LinkedHashMap<String, Object>();
      for (String field : List.of("id", "question", "topic", "answer", "trainingId", "answerTruncated", "answerExcerpt"))
        if (turn.containsKey(field)) copy.put(field, turn.get(field));
      String answer = str(turn, "answer");
      int length = Math.min(6000, remaining);
      if (answer.length() > length) {
        int start = answer.length() - length;
        if (start < answer.length() && Character.isLowSurrogate(answer.charAt(start))) start++;
        copy.put("answer", answer.substring(start));
        copy.put("answerTruncated", true);
        copy.put("answerExcerpt", start == answer.length() ? "OMITTED" : "TAIL");
      }
      remaining -= str(copy, "answer").length();
      result.add(copy);
    }
    Collections.reverse(result);
    return result;
  }

  static List<Map<String, Object>> completedTurns(Map<String, Object> practice, Map<String, Object> current) {
    var completed = new ArrayList<Map<String, Object>>();
    for (var turn : list(new LinkedHashMap<>(practice), "turns")) {
      if (turn == current || (!str(current, "id").isBlank() && str(current, "id").equals(str(turn, "id")))) break;
      if (!str(turn, "answer").isBlank()) completed.add(turn);
    }
    return turns(completed);
  }

  static List<Map<String, Object>> exchanges(List<Map<String, Object>> source) {
    var recent = new ArrayList<Map<String, Object>>();
    int remaining = EXCHANGE_BUDGET;
    for (int i = source.size() - 1; i >= 0; i--) {
      var item = source.get(i);
      int length = str(item, "answer").length() + str(item, "reply").length();
      if (length > remaining) break;
      recent.add(Map.of("answer", str(item, "answer"), "reply", str(item, "reply")));
      remaining -= length;
    }
    Collections.reverse(recent);
    return recent;
  }

  static void validateRequest(String request) {
    if (request.length() > MAX_REQUEST_CHARS) throw new TooLarge();
  }

  static final class TooLarge extends ResponseStatusException {
    TooLarge() {
      super(HttpStatus.PAYLOAD_TOO_LARGE,
        "材料与对话合计超过模型上下文上限，未发送给模型，也未截断已保存的原文；请缩短材料后开始新一场练习。");
    }
  }
}
