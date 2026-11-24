package com.projectprobe;

import static com.projectprobe.Store.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;

@Service
class PracticeRetest {
  private static final List<String> ANSWER_FIELDS = List.of(
    "实现步骤", "冲突响应", "测试输入", "预期结果", "实测结果"
  );
  private final Store store;
  private final ProjectPractice practice;
  private final ModelService model;

  PracticeRetest(Store store, ProjectPractice practice, ModelService model) {
    this.store = store;
    this.practice = practice;
    this.model = model;
  }

  Map<String, Object> run(String user, String projectId, Map<String, Object> input) {
    String token = id();
    var generation = store.locked(user, () -> {
      var training = practice.get(user, projectId, str(input, "roundId"));
      if (!"COMPLETED".equals(training.get("status"))) {
        throw error(409, "先完成项目练习，再针对一项反馈复测");
      }
      String roundId = str(training, "roundId");
      var report = object(training.get("report"));
      var retest = object(training.get("retest"));
      if ("COMPLETED".equals(retest.get("status"))) return new Generation(roundId, null);
      long lease = ((Number) training.get("leaseUntil")).longValue();
      if (lease > now()) throw error(409, "本场评分或专项复测正在生成，请稍后再试");
      if (!str(training, "modelMode").equals(model.mode)) {
        throw error(409, "当前服务的反馈模式与原训练不同，请恢复原模式后复测");
      }

      String answer = required(input, "answer", 3000);
      String turnId = required(input, "turnId", 36);
      if (!(input.get("findingIndex") instanceof Integer index)) {
        throw error(400, "请选择要复测的反馈");
      }
      var findings = list(report, "findings");
      if (index < 0 || index >= findings.size()) throw error(400, "复测反馈不存在");
      var finding = findings.get(index);
      var evidence = list(finding, "evidence");
      var previous = list(training, "turns").stream()
        .filter(turn -> turnId.equals(turn.get("id")) && !str(turn, "answer").isBlank())
        .filter(turn -> evidence.stream().anyMatch(ref -> turnId.equals(ref.get("turnId"))))
        .findFirst()
        .orElseThrow(() -> error(400, "请选择该项反馈引用的原回答"));

      if (!retest.isEmpty() && (!Integer.valueOf(index).equals(retest.get("findingIndex"))
          || !turnId.equals(retest.get("turnId")) || !answer.equals(retest.get("answer")))) {
        throw error(409, "这轮补答已经保存，请继续生成原复测报告");
      }
      var saved = new LinkedHashMap<String, Object>(Map.of(
        "findingIndex", index,
        "turnId", turnId,
        "answer", answer,
        "status", "GENERATING"
      ));
      training.put("retest", saved);
      training.remove("leaseUntil");
      training.remove("status");
      training.remove("roundId");
      training.remove("roundNumber");
      store.db.update(
        "UPDATE project_practice_rounds SET body=?,lease_until=?,lease_token=? WHERE user_id=? AND round_id=?",
        store.encode(training), now() + 90000, token, user, roundId
      );
      return new Generation(roundId, Map.of(
        "kind", "RETEST",
        "focus", str(finding, "topic"),
        "previousReport", report,
        "previousTurns", List.of(previous),
        "project", training.get("project"),
        "turns", List.of(Map.of("id", id(), "question", str(previous, "question"),
          "topic", str(finding, "topic"), "answer", answer))
      ));
    });
    String roundId = generation.roundId();
    var claim = generation.input();
    if (claim == null) return practice.get(user, projectId, roundId);

    try {
      var report = model.report(new LinkedHashMap<>(claim));
      if ("demo".equals(model.mode)) report.put("comparisons", List.of(demoComparison(claim)));
      store.locked(user, () -> {
        var row = store.one("SELECT * FROM project_practice_rounds WHERE user_id=? AND round_id=?", user, roundId);
        if (!token.equals(row.get("lease_token")) || ((Number) row.get("lease_until")).longValue() <= now()) {
          throw error(409, "复测生成超时，请继续生成已保存的补答");
        }
        var training = store.decode(row.get("body"));
        var retest = object(training.get("retest"));
        retest.put("status", "COMPLETED");
        retest.put("report", report);
        store.db.update("UPDATE project_practice_rounds SET body=?,lease_until=0,lease_token=NULL WHERE user_id=? AND round_id=?",
          store.encode(training), user, roundId);
        return null;
      });
    } catch (Exception e) {
      store.db.update("UPDATE project_practice_rounds SET lease_until=0,lease_token=NULL WHERE user_id=? AND round_id=? AND lease_token=?", user, roundId, token);
      if (e instanceof ModelContext.TooLarge limit) throw limit;
      throw error(503, "补答已保存，复测报告生成失败，请重试");
    }
    return practice.get(user, projectId, roundId);
  }

  private record Generation(String roundId, Map<String, Object> input) {}

  private Map<String, Object> demoComparison(Map<String, Object> claim) {
    var before = ReportComparison.answered(claim, "previousTurns").get(0);
    var after = ReportComparison.answered(claim, "turns").get(0);
    var added = ANSWER_FIELDS.stream()
      .filter(field -> !hasDetail(str(before, "answer"), field) && hasDetail(str(after, "answer"), field))
      .toList();
    String assessment = added.isEmpty()
      ? "规则未定位到新增的标注细节。请对照两次原文，核对是否讲清本次选中的反馈。"
      : "补答新增了标注：" + String.join("、", added) + "。请核对内容是否覆盖该项反馈，技术实现和测试仍需独立验证。";
    return Map.of(
      "topic", str(claim, "focus"),
      "status", "NEEDS_REVIEW",
      "assessment", assessment,
      "previousEvidence", List.of(ReportComparison.evidence(before)),
      "currentEvidence", List.of(ReportComparison.evidence(after))
    );
  }

  private boolean hasDetail(String answer, String field) {
    return Pattern.compile("(?:^|[。；;\\n])\\s*" + field
      + "[：:]\\s*(?!尚未|未|没|不确定|未知|无(?:[。；;\\n]|$))[^\\s。；;\\n]").matcher(answer).find();
  }

  @SuppressWarnings("unchecked")
  static Map<String, Object> object(Object value) {
    return value instanceof Map<?, ?> ? (Map<String, Object>) value : new LinkedHashMap<>();
  }
}
