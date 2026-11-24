package com.projectprobe;

import static com.projectprobe.Store.*;

import java.util.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class TrainingService {
  @Autowired JourneyMetrics journey;

  static final String PAYMENT_PENDING = "PAYMENT_PENDING";
  static final String PAYMENT_VERIFYING = "PAYMENT_VERIFYING";
  private static final long PAYMENT_LEASE_MS = 30000;

  final Store s;
  final ProjectService projects;
  final ModelService model;
  final TrainingHistory history;
  final PaymentService legacyPayment;
  final WatchaPayment watchaPayment;

  TrainingService(
    Store s,
    ProjectService projects,
    ModelService model
  ) {
    this(s, projects, model, null, null);
  }

  TrainingService(Store s, ProjectService projects, ModelService model, PaymentService legacyPayment) {
    this(s, projects, model, legacyPayment, null);
  }

  @Autowired
  TrainingService(
    Store s,
    ProjectService projects,
    ModelService model,
    PaymentService legacyPayment,
    WatchaPayment watchaPayment
  ) {
    this.s = s;
    this.projects = projects;
    this.model = model;
    this.history = new TrainingHistory(s, legacyPayment);
    this.legacyPayment = legacyPayment;
    this.watchaPayment = watchaPayment;
  }

  Map<String, Object> row(String user, String id) {
    var training = s.one(
      "SELECT * FROM trainings WHERE id=? AND user_id=?",
      id,
      user
    );
    String packageId = str(training, "package_id");
    if (legacyBillingEnabled() && !packageId.isEmpty()) legacyPayment.requireTrainingScope(user, packageId);
    return training;
  }

  Map<String, Object> get(String user, String id) {
    var r = row(user, id);
    var b = s.decode(r.get("body"));
    for (var turn : list(b, "turns")) turn.put("questionVersion", questionVersion(turn));
    b.put("id", id);
    b.put("status", r.get("status"));
    b.put("leaseUntil", r.get("lease_until"));
    b.put("createdAt", r.get("created_at"));
    if (r.get("history_key") != null) b.put("historyKey", r.get("history_key"));
    b.remove("packageId");
    b.put("legacyRefundEligible", legacyBillingEnabled() && !str(r, "package_id").isBlank());
    if ("FAILED".equals(r.get("status")) && str(b, "error").contains("权益"))
      b.put("error", "生成失败，进度已保存，可以重试。");
    if (
      "DEEP".equals(r.get("kind")) && "COMPLETED".equals(r.get("status"))
    ) b.put("retestEntry", retestEntry(user, r));
    return b;
  }

  Map<String, Object> retestEntry(String user, Map<String, Object> deep) {
    var children = s.db.queryForList(
      "SELECT t.id,t.status" + history.scoped() +
        " AND t.parent_id=? AND t.kind='RETEST' ORDER BY t.created_at DESC,t.id DESC",
      history.queryArgs(user, deep.get("id"))
    );
    return retestEntry(children);
  }

  static Map<String, Object> retestEntry(List<Map<String, Object>> children) {
    return children.stream()
      .filter(child -> !"REFUNDED".equals(child.get("status")))
      .sorted(Comparator.comparing(child -> "COMPLETED".equals(child.get("status"))))
      .findFirst()
      .<Map<String, Object>>map(child -> Map.of(
        "state", "COMPLETED".equals(child.get("status")) ? "COMPLETED" : "CONTINUE",
        "trainingId", child.get("id"),
        "trainingStatus", child.get("status")
      ))
      .orElseGet(() -> Map.of("state", "AVAILABLE"));
  }

  List<Map<String, Object>> all(String user) {
    return all(user, false);
  }

  List<Map<String, Object>> all(String user, boolean summary) {
    return catalog().all(user, summary);
  }

  TrainingCatalog catalog() {
    return new TrainingCatalog(s, history);
  }

  void update(String id, String status, Map<String, Object> body) {
    s.db.update(
      "UPDATE trainings SET body=?,status=? WHERE id=?",
      s.encode(body),
      status,
      id
    );
  }

  Map<String, Object> savePlan(
    String user,
    String id,
    Map<String, Object> input
  ) {
    return s.locked(user, () -> {
      var r = row(user, id);
      if (!"COMPLETED".equals(r.get("status"))) throw error(
        409,
        "完成训练后才能保存复盘任务"
      );
      var body = s.decode(r.get("body"));
      var report = (Map<String, Object>) body.get("report");
      if (report == null) throw error(409, "报告尚未生成");
      if (
        !(input.get("taskIndex") instanceof Number index) ||
        index.doubleValue() != index.intValue() ||
        index.intValue() < 0 ||
        index.intValue() >= list(report, "findings").size()
      ) throw error(400, "补充任务不存在");
      if (
        !(input.get("done") instanceof Boolean) ||
        !(input.get("note") instanceof String note) ||
        note.length() > 2000
      ) throw error(400, "任务状态或笔记格式不正确，笔记最多 2000 字");
      int version = ((Number) body.getOrDefault("planVersion", 0)).intValue();
      if (
        !(input.get("version") instanceof Number expected) ||
        expected.doubleValue() != version
      ) throw error(409, "复盘进度已在其他页面更新，请刷新后再保存");
      var tasks = list(body, "reportPlan");
      tasks.removeIf(task ->
        Objects.equals(task.get("taskIndex"), index.intValue())
      );
      tasks.add(
        new LinkedHashMap<>(
          Map.of(
            "taskIndex",
            index.intValue(),
            "done",
            input.get("done"),
            "note",
            note.strip(),
            "updatedAt",
            now()
          )
        )
      );
      body.put("planVersion", version + 1);
      update(id, "COMPLETED", body);
      return get(user, id);
    });
  }

  Map<String, Object> start(String user, Map<String, Object> input) {
    history.backfill(user);
    var training = s.locked(user, () -> {
      s.requireActiveAccount(user);
      String requestKey = required(input, "requestKey", 100);
      var existing = s.db.queryForList(
        "SELECT id FROM trainings WHERE user_id=? AND request_key=?",
        user,
        requestKey
      );
      if (!existing.isEmpty()) return get(user, str(existing.get(0), "id"));
      String projectId = required(input, "projectId", 36);
      var project = projects.get(user, projectId);
      String historyKey = TrainingHistory.key(project, projectId);
      String parent = str(input, "parentId"),
        kind = parent.isBlank() ? "DEEP" : "RETEST";
      Map<String, Object> parentBody = null;
      String parentPackageId = "";
      if (kind.equals("RETEST")) {
        var p = row(user, parent);
        if (
          !"COMPLETED".equals(p.get("status")) ||
          !"DEEP".equals(p.get("kind")) ||
          !projectId.equals(p.get("project_id"))
        ) throw error(400, "复测必须关联本项目已完成的深挖训练");
        var entry = retestEntry(user, p);
        if (
          "CONTINUE".equals(entry.get("state")) ||
          ("COMPLETED".equals(entry.get("state")) && !Boolean.TRUE.equals(input.get("newRound")))
        ) return get(user, str(entry, "trainingId"));
        parentBody = s.decode(p.get("body"));
        parentPackageId = str(p, "package_id");
      }
      String id = id();
      var body = new LinkedHashMap<String, Object>();
      String exercise = str(input, "exerciseMode"), difficulty = str(input, "difficulty");
      if (exercise.isBlank()) exercise = "STANDARD";
      if (difficulty.isBlank()) difficulty = "IMPLEMENTATION";
      if (!Set.of("QUICK", "STANDARD").contains(exercise) ||
          !Set.of("BASIC", "IMPLEMENTATION", "TRADEOFF").contains(difficulty))
        throw error(400, "训练模式或难度不正确");
      body.put("exerciseMode", exercise);
      body.put("difficulty", difficulty);
      var projectSnapshot = new LinkedHashMap<>(project);
      projectSnapshot.put("facts", list(project, "facts").stream()
        .filter(fact -> Boolean.TRUE.equals(fact.get("confirmed")))
        .toList());
      body.put("project", projectSnapshot);
      body.put("historyKey", historyKey);
      body.putAll(history.context(user, projectId, historyKey, ""));
      body.put("kind", kind);
      body.put("parentId", parent);
      body.put("modelMode", model.mode);
      body.put("maxTurns", "QUICK".equals(exercise) ? 2 : kind.equals("DEEP") ? 5 : 3);
      String focus = "项目实现与验证";
      if (parentBody != null) {
        body.put("previousReport", parentBody.get("report"));
        body.put("previousTurns", parentBody.get("turns"));
        body.put("previousProject", parentBody.get("project"));
        String selected = str(input, "focus");
        if (selected.length() > 200) throw error(400, "复测主题过长");
        var target = model.retestTarget(parentBody, selected);
        body.put("retestTarget", target);
        focus = str(target, "topic");
      }
      body.put("focus", focus);
      body.put("turns", new ArrayList<>());
      body.put("interviewFacts", new ArrayList<>());
      body.put(
        "operation",
        kind.equals("RETEST") ? "FIRST_QUESTION" : "FIRST_DEEP_QUESTION"
      );
      String paymentScope = watchaBillingEnabled() ? watchaPayment.scope() : null;
      if (watchaBillingEnabled() && (paymentScope == null || paymentScope.isBlank()))
        throw error(503, "训练支付尚未配置，请稍后重试");
      String packageId = legacyBillingEnabled()
        ? legacyPayment.reserveTraining(user, kind, parentPackageId, id)
        : null;
      s.db.update(
        "INSERT INTO trainings(id,user_id,project_id,request_key,kind,parent_id,status,body,created_at,history_key,package_id,payment_scope) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        id,
        user,
        projectId,
        requestKey,
        kind,
        parent.isBlank() ? null : parent,
        paymentScope == null ? "PENDING" : PAYMENT_PENDING,
        s.encode(body),
        now(),
        historyKey,
        packageId,
        paymentScope
      );
      if (paymentScope == null) recordStarted(user, kind, id);
      return get(user, id);
    });
    String trainingId = str(training, "id");
    if (awaitingPayment(str(training, "status"))) {
      authorizePayment(user, trainingId);
      training = get(user, trainingId);
    }
    // 先持久化训练，再在事务外调用模型，失败保留可恢复入口。
    if ("PENDING".equals(training.get("status"))) {
      try {
        return generate(user, trainingId);
      } catch (ResponseStatusException e) {
        if (
          e.getStatusCode().value() == 503 || e.getStatusCode().value() == 409
        ) return get(user, trainingId);
        throw e;
      }
    }
    return training;
  }

  private boolean legacyBillingEnabled() {
    return legacyPayment != null && legacyPayment.trainingBillingEnabled();
  }

  private boolean watchaBillingEnabled() {
    return watchaPayment != null && watchaPayment.enabled();
  }

  private static boolean awaitingPayment(String status) {
    return PAYMENT_PENDING.equals(status) || PAYMENT_VERIFYING.equals(status);
  }

  private void recordStarted(String user, String kind, String id) {
    if (journey != null) journey.record(user, kind.equals("RETEST") ? "RETEST_STARTED" : "TRAINING_STARTED", id);
  }

  private void authorizePayment(String user, String trainingId) {
    String token = id();
    boolean claimed = s.locked(user, () -> {
      s.requireActiveAccount(user);
      var training = row(user, trainingId);
      String status = str(training, "status");
      if (!awaitingPayment(status)) return false;
      if (!watchaBillingEnabled() || !Objects.equals(training.get("payment_scope"), watchaPayment.scope()))
        throw error(503, "当前训练的支付配置不可用，请稍后重试");
      if (((Number) training.get("lease_until")).longValue() > now())
        throw error(409, "正在核对训练次数，请稍后重试");
      s.db.update(
        "UPDATE trainings SET status=?,generation_token=?,lease_until=? WHERE id=?",
        PAYMENT_VERIFYING, token, now() + PAYMENT_LEASE_MS, trainingId
      );
      return true;
    });
    if (!claimed) return;

    // 同一条训练的 ID 跨进程、网络超时和数据库提交失败保持不变。
    try {
      watchaPayment.consume(user, trainingId);
    } catch (ResponseStatusException e) {
      s.locked(user, () -> {
        s.db.update(
          "UPDATE trainings SET status=?,generation_token=NULL,lease_until=0 WHERE id=? AND generation_token=?",
          e.getStatusCode().value() == 402 ? PAYMENT_PENDING : PAYMENT_VERIFYING, trainingId, token
        );
        return null;
      });
      throw e;
    }
    s.locked(user, () -> {
      s.requireActiveAccount(user);
      var training = row(user, trainingId);
      if (!token.equals(training.get("generation_token"))) {
        if (awaitingPayment(str(training, "status"))) throw error(409, "训练次数核对中，请稍后重试");
        return null;
      }
      s.db.update(
        "UPDATE trainings SET status='PENDING',generation_token=NULL,lease_until=0 WHERE id=?",
        trainingId
      );
      recordStarted(user, str(training, "kind"), trainingId);
      return null;
    });
  }

  Map<String, Object> turn(String question, String topic) {
    return new LinkedHashMap<>(
      Map.of(
        "id",
        id(),
        "question",
        question,
        "topic",
        topic,
        "questionVersion",
        0,
        "answer",
        "",
        "createdAt",
        now()
      )
    );
  }

  static int questionVersion(Map<String, Object> turn) {
    if (turn.get("questionVersion") instanceof Number version) return version.intValue();
    // 兼容已有的纠题记录；旧客户端未带版本时只允许提交从未修改的题目。
    return turn.get("questionHistory") instanceof List<?> history ? history.size() : 0;
  }

  static void requireQuestionVersion(Map<String, Object> turn, Map<String, Object> input) {
    Object value = input.getOrDefault("questionVersion", 0);
    if (!(value instanceof Number version) || version.doubleValue() != version.intValue() || version.intValue() < 0)
      throw error(400, "题目版本格式不正确");
    if (version.intValue() != questionVersion(turn))
      throw error(409, "题目已调整，请重新加载并核对草稿后再提交");
  }

  Map<String, Object> answer(
    String user,
    String id,
    Map<String, Object> input
  ) {
    s.locked(user, () -> {
      var r = row(user, id);
      var b = s.decode(r.get("body"));
      var turns = list(b, "turns");
      String turnId = required(input, "turnId", 36),
        answer = required(input, "answer", 6000);
      var t = turns
        .stream()
        .filter(v -> turnId.equals(v.get("id")))
        .findFirst()
        .orElseThrow(() -> error(400, "问题不存在"));
      requireQuestionVersion(t, input);
      if (!str(t, "answer").isBlank()) {
        if (!answer.equals(t.get("answer"))) throw error(
          409,
          "该问题已提交其他回答"
        );
        return null;
      }
      if (
        !"ACTIVE".equals(r.get("status")) || t != turns.get(turns.size() - 1)
      ) throw error(409, "训练当前不能提交回答");
      t.put("answer", answer);
      s.db.update("DELETE FROM answer_drafts WHERE training_id=?", id);
      t.put("answeredAt", now());
      list(b, "interviewFacts").add(
        Map.of(
          "id",
          id(),
          "text",
          answer,
          "source",
          "INTERVIEW_SUPPLEMENT",
          "turnId",
          turnId,
          "confirmed",
          false
        )
      );
      b.put(
        "operation",
        turns.size() >= ((Number) b.get("maxTurns")).intValue()
          ? "REPORT"
          : "QUESTION"
      );
      update(id, "PENDING", b);
      return null;
    });
    return generate(user, id);
  }

  Map<String, Object> finish(String user, String id) {
    s.locked(user, () -> {
      var r = row(user, id);
      String status = str(r, "status");
      if (status.equals("COMPLETED")) return null;
      if (!Set.of("ACTIVE", "FAILED").contains(status)) throw error(
        409,
        "请先等待当前生成完成或恢复"
      );
      var b = s.decode(r.get("body"));
      b.put("operation", "REPORT");
      update(id, "PENDING", b);
      return null;
    });
    return generate(user, id);
  }

  Map<String, Object> generate(String user, String id) {
    if (awaitingPayment(str(row(user, id), "status"))) authorizePayment(user, id);
    history.backfill(user);
    String token = id();
    var claim = s.locked(user, () -> {
      var r = row(user, id);
      String status = str(r, "status");
      if (awaitingPayment(status)) throw error(409, "请先完成训练次数核对");
      if (
        Set.of("ACTIVE", "COMPLETED", "REFUNDED").contains(status)
      ) return null;
      if (
        status.equals("GENERATING") &&
        ((Number) r.get("lease_until")).longValue() > now()
      ) throw error(409, "正在生成，稍后刷新即可恢复");
      s.db.update(
        "UPDATE trainings SET status='GENERATING',generation_token=?,lease_until=? WHERE id=?",
        token,
        now() + 90000,
        id
      );
      var body = s.decode(r.get("body"));
      body.put(
        "historyKey",
        r.get("history_key") == null
          ? TrainingHistory.key(
              (Map<String, Object>) body.get("project"),
              str(r, "project_id")
            )
          : r.get("history_key")
      );
      if (!"REPORT".equals(body.get("operation"))) {
        var recent = history.context(
          user,
          str(r, "project_id"),
          str(body, "historyKey"),
          id
        );
        body.put("historyTurns", recent.get("historyTurns"));
        body.put("trainingHistory", recent.get("trainingHistory"));
        body.putIfAbsent(
          "historyRoundNumber",
          recent.get("historyRoundNumber")
        );
      }
      return body;
    });
    if (claim == null) return get(user, id);
    try {
      if ("REPORT".equals(claim.get("operation"))) claim.put(
        "report",
        model.report(claim)
      );
      else {
        var q = switch (str(claim, "operation")) {
          case "FIRST_QUESTION" -> model.firstRetestQuestion(claim);
          case "FIRST_DEEP_QUESTION" -> model.firstDeepQuestion(claim);
          case "REVISE_QUESTION" -> model.reviseQuestion(claim);
          default -> model.question(claim);
        };
        var turns = list(claim, "turns");
        if ("REVISE_QUESTION".equals(claim.get("operation"))) {
          var current = turns.get(turns.size() - 1);
          int version = questionVersion(current);
          list(current, "questionHistory").add(Map.of("question", current.get("question"),
            "topic", current.get("topic"), "questionVersion", version, "revisedAt", now()));
          current.put("question", q.question()); current.put("topic", q.topic());
          current.put("questionVersion", version + 1);
        } else turns.add(turn(q.question(), q.topic()));
      }
      claim.remove("qualityReviewFailure");
      return s.locked(user, () -> {
        var r = row(user, id);
        if (!token.equals(r.get("generation_token"))) return get(user, id);
        if (((Number) r.get("lease_until")).longValue() <= now()) throw error(
          409,
          "生成已超时，请重试"
        );
        if (!"REPORT".equals(claim.get("operation"))) {
          var turns = list(claim, "turns");
          var last = turns.get(turns.size() - 1);
          if (
            history.repeated(
              user,
              str(r, "project_id"),
              str(claim, "historyKey"),
              str(last, "question")
            )
          ) throw error(503, "模型重复历史问题，请重试");
          var indexed = new LinkedHashMap<>(last);
          if ("REVISE_QUESTION".equals(claim.get("operation"))) indexed.put("id", id());
          history.index(
            user,
            id,
            str(r, "project_id"),
            str(claim, "historyKey"),
            indexed
          );
        }
        claim.remove("error");
        if ("REPORT".equals(claim.get("operation"))) if (journey != null) journey.record(user, "REPORT_COMPLETED", id);
        update(
          id,
          "REPORT".equals(claim.get("operation")) ? "COMPLETED" : "ACTIVE",
          claim
        );
        s.db.update(
          "UPDATE trainings SET lease_until=0,generation_token=NULL WHERE id=?",
          id
        );
        return get(user, id);
      });
    } catch (Exception e) {
      org.slf4j.LoggerFactory.getLogger(TrainingService.class).warn(
        "training_generation_failed operation={} exceptionType={} reason={}",
        claim.get("operation"),
        e.getClass().getSimpleName(),
        e instanceof
          org.springframework.web.server.ResponseStatusException response
          ? ModelQuality.logReason(response.getReason())
          : "internal_failure"
      );
      s.locked(user, () -> {
        var r = row(user, id);
        if (token.equals(r.get("generation_token"))) {
          var saved = s.decode(r.get("body"));
          if (e instanceof ModelQuality.Rejected rejected) saved.put("qualityReviewFailure", rejected.diagnostic);
          boolean first = Set.of(
            "FIRST_QUESTION",
            "FIRST_DEEP_QUESTION"
          ).contains(str(saved, "operation"));
          String savedMessage = e instanceof ModelContext.TooLarge limit ? limit.getReason() : first
            ? "首题生成失败，训练记录已保存，可以重试。"
            : "生成失败，回答已保存，可以重试。";
          saved.put("error", savedMessage);
          update(id, "FAILED", saved);
          s.db.update("UPDATE trainings SET lease_until=0 WHERE id=?", id);
        }
        return null;
      });
      if (e instanceof ModelContext.TooLarge limit) throw limit;
      throw error(503, "生成失败，进度已保存，请重试。");
    }
  }

  Map<String, Object> refund(String user, String id) {
    if (!legacyBillingEnabled()) throw error(404, "该训练不支持返还旧套餐次数");
    return s.locked(user, () -> {
      s.requireActiveAccount(user);
      var training = row(user, id);
      String status = str(training, "status");
      if ("REFUNDED".equals(status)) return get(user, id);
      String packageId = str(training, "package_id");
      boolean expired = "GENERATING".equals(status) && ((Number) training.get("lease_until")).longValue() <= now();
      if (packageId.isBlank() || (!Set.of("PENDING", "FAILED").contains(status) && !expired))
        throw error(409, "当前训练不能返还旧套餐次数");
      legacyPayment.releaseTraining(user, str(training, "kind"), packageId, id);
      s.db.update("UPDATE trainings SET status='REFUNDED',generation_token=NULL,lease_until=0 WHERE id=?", id);
      return get(user, id);
    });
  }

}
