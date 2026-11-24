package com.projectprobe;

import static com.projectprobe.Store.*;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.Normalizer;
import java.util.*;

final class TrainingHistory {

  final Store s;
  final PaymentService payment;
  static final String SCOPED =
    " FROM trainings t WHERE t.user_id=? AND t.status<>'PAYMENT_PENDING'";

  TrainingHistory(Store s) {
    this(s, null);
  }

  TrainingHistory(Store s, PaymentService payment) {
    this.s = s;
    this.payment = payment;
  }

  String scoped() {
    return SCOPED + visibility("t");
  }

  String visibility(String alias) {
    if (payment == null || !payment.trainingBillingEnabled()) return "";
    return " AND (" + alias + ".package_id IS NULL OR EXISTS (SELECT 1 FROM training_packages p" +
      " JOIN purchase_orders o ON o.id=p.order_id WHERE p.id=" + alias + ".package_id" +
      " AND o.mode=? AND (o.account_scope=? OR (o.mode='mock' AND o.account_scope='legacy'))))";
  }

  Object[] visibilityArgs() {
    return payment != null && payment.trainingBillingEnabled()
      ? new Object[] {payment.mode, payment.scope()}
      : new Object[0];
  }

  Object[] queryArgs(String user, Object... extra) {
    var args = new ArrayList<>();
    args.add(user);
    Collections.addAll(args, visibilityArgs());
    Collections.addAll(args, extra);
    return args.toArray();
  }

  static String hash(String text) {
    try {
      return HexFormat.of().formatHex(
        MessageDigest.getInstance("SHA-256").digest(
          text.getBytes(StandardCharsets.UTF_8)
        )
      );
    } catch (java.security.NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }

  static String key(Map<String, Object> project, String projectId) {
    String resume = Normalizer.normalize(
      str(project, "resume"),
      Normalizer.Form.NFKC
    ).replaceAll("[\\s\\p{Z}\\u200B\\uFEFF]+", "");
    return hash(
      resume.isBlank() ? "project:" + projectId : "resume-project-v1:" + resume
    );
  }

  void backfill(String user) {
    boolean more;
    do {
      if (Thread.currentThread().isInterrupted()) throw error(
        503,
        "历史索引已中断，请稍后重试"
      );
      more = s.locked(user, () -> {
        var rows = s.db.queryForList(
          "SELECT t.id,t.project_id,t.body" +
            scoped() +
            " AND t.history_key IS NULL ORDER BY t.created_at,t.id LIMIT 25",
          queryArgs(user)
        );
        for (var row : rows) {
          var body = s.decode(row.get("body"));
          var project =
            body.get("project") instanceof Map<?, ?>
              ? (Map<String, Object>) body.get("project")
              : Map.<String, Object>of();
          String historyKey = key(project, str(row, "project_id"));
          s.db.update(
            "UPDATE trainings SET history_key=? WHERE id=? AND user_id=?",
            historyKey,
            row.get("id"),
            user
          );
          for (var turn : list(body, "turns"))
            index(
              user,
              str(row, "id"),
              str(row, "project_id"),
              historyKey,
              turn
            );
        }
        return rows.size() == 25;
      });
    } while (more);
  }

  void index(
    String user,
    String trainingId,
    String projectId,
    String historyKey,
    Map<String, Object> turn
  ) {
    s.db.update(
      "INSERT INTO training_question_index(turn_id,training_id,user_id,project_id,history_key,question_hash) SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM training_question_index WHERE turn_id=?)",
      turn.get("id"),
      trainingId,
      user,
      projectId,
      historyKey,
      hash(ModelService.normalizeQuestion(str(turn, "question"))),
      turn.get("id")
    );
  }

  boolean repeated(
    String user,
    String projectId,
    String historyKey,
    String question
  ) {
    return (
      s.db.queryForObject(
        "SELECT COUNT(*)" + SCOPED.replace(" WHERE", " JOIN training_question_index q ON q.training_id=t.id WHERE") +
          visibility("t") + " AND q.user_id=t.user_id AND (q.project_id=? OR q.history_key=?) AND q.question_hash=?",
        Integer.class,
        queryArgs(user, projectId, historyKey, hash(ModelService.normalizeQuestion(question)))
      ) > 0
    );
  }

  Map<String, Object> context(
    String user,
    String projectId,
    String historyKey,
    String excluding
  ) {
    var rows = s.db.queryForList(
      "SELECT t.id,t.kind,t.status,t.created_at,t.body" +
        scoped() +
        " AND (t.project_id=? OR t.history_key=?) AND t.id<>? AND t.status<>'PAYMENT_VERIFYING' ORDER BY t.created_at DESC,t.id DESC LIMIT 6",
      queryArgs(user, projectId, historyKey, excluding)
    );
    var turns = new ArrayList<Map<String, Object>>();
    var rounds = new ArrayList<Map<String, Object>>();
    int budget = 18000;
    for (var row : rows) {
      var body = s.decode(row.get("body"));
      var record = new LinkedHashMap<String, Object>(
        Map.of(
          "trainingId",
          row.get("id"),
          "kind",
          row.get("kind"),
          "status",
          row.get("status"),
          "createdAt",
          row.get("created_at")
        )
      );
      var saved = new ArrayList<Map<String, Object>>();
      for (var turn : list(body, "turns")) {
        String question = str(turn, "question"),
          answer = str(turn, "answer");
        if (budget < question.length() + 200) break;
        int limit = Math.min(1500, budget - question.length() - 200);
        boolean truncated = answer.length() > limit;
        var copy = new LinkedHashMap<String, Object>(
          Map.of(
            "id",
            turn.get("id"),
            "question",
            question,
            "topic",
            str(turn, "topic"),
            "answer",
            answer.substring(0, Math.min(answer.length(), limit)),
            "answerTruncated",
            truncated
          )
        );
        copy.put("trainingId", row.get("id"));
        saved.add(copy);
        turns.add(copy);
        budget -= question.length() + str(copy, "answer").length() + 200;
      }
      // 问答只保留在 historyTurns，逐轮元数据不再重复携带同一批原文。
      record.put(
        "turnIds",
        saved
          .stream()
          .map(t -> t.get("id"))
          .toList()
      );
      rounds.add(record);
    }
    int count = s.db.queryForObject(
      "SELECT COUNT(*)" +
        scoped() +
        " AND (t.project_id=? OR t.history_key=?) AND t.id<>? AND t.status<>'PAYMENT_VERIFYING'",
      Integer.class,
      queryArgs(user, projectId, historyKey, excluding)
    );
    return Map.of(
      "historyTurns",
      turns,
      "trainingHistory",
      rounds,
      "historyRoundNumber",
      count + 1
    );
  }
}
