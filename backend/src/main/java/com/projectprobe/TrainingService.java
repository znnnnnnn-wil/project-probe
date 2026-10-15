package com.projectprobe;

import static com.projectprobe.Store.*;

import java.util.*;
import org.springframework.stereotype.Service;

@Service
public class TrainingService {

  final Store s;
  final ProjectService projects;
  final ModelService model;
  final PaymentService payments;
  final TrainingHistory history;

  @org.springframework.beans.factory.annotation.Autowired
  TrainingService(
    Store s,
    ProjectService projects,
    ModelService model,
    PaymentService payments
  ) {
    this.s = s;
    this.projects = projects;
    this.model = model;
    this.payments = payments;
    this.history = new TrainingHistory(s, payments);
  }

  TrainingService(Store s, ProjectService projects, ModelService model) {
    this(s, projects, model, new PaymentService(s, new PaymentSettings()));
  }

  Map<String, Object> row(String user, String id) {
    var row = s.one(
      "SELECT * FROM trainings WHERE id=? AND user_id=?",
      id,
      user
    );
    var order = s.one(
      "SELECT o.* FROM purchase_orders o JOIN training_packages p ON p.order_id=o.id WHERE p.id=?",
      row.get("package_id")
    );
    payments.requireScope(order);
    return row;
  }

  Map<String, Object> get(String user, String id) {
    var r = row(user, id);
    var b = s.decode(r.get("body"));
    b.put("id", id);
    b.put("status", r.get("status"));
    b.put("leaseUntil", r.get("lease_until"));
    b.put("createdAt", r.get("created_at"));
    if (r.get("history_key") != null) b.put("historyKey", r.get("history_key"));
    b.put("packageId", r.get("package_id"));
    if (
      "DEEP".equals(r.get("kind")) && "COMPLETED".equals(r.get("status"))
    ) b.put("retestEntry", retestEntry(user, r));
    return b;
  }

  Map<String, Object> retestEntry(String user, Map<String, Object> deep) {
    var pack = s.one(
      "SELECT * FROM training_packages WHERE id=? AND user_id=?",
      deep.get("package_id"),
      user
    );
    var sourceOrder = s.one(
      "SELECT * FROM purchase_orders WHERE id=?",
      pack.get("order_id")
    );
    payments.requireScope(sourceOrder);
    if (!"PAID".equals(sourceOrder.get("status"))) return Map.of(
      "state",
      "UNAVAILABLE",
      "packageId",
      pack.get("id")
    );
    // 新套餐可为旧报告续费；仍按父训练定位已有复测，避免重复扣次。
    var children = s.db.queryForList(
      "SELECT t.id,t.status,t.package_id FROM trainings t JOIN training_packages p ON p.id=t.package_id JOIN purchase_orders o ON o.id=p.order_id WHERE t.user_id=? AND t.parent_id=? AND t.kind='RETEST' AND o.mode=? AND (o.account_scope=? OR (o.mode='mock' AND o.account_scope='legacy')) ORDER BY t.created_at DESC,t.id DESC",
      user,
      deep.get("id"),
      payments.mode,
      payments.scope()
    );
    children.sort(Comparator.comparing(c -> "COMPLETED".equals(c.get("status"))));
    for (var child : children) {
      String status = str(child, "status");
      if (!"REFUNDED".equals(status)) return Map.of(
        "state",
        "COMPLETED".equals(status) ? "COMPLETED" : "CONTINUE",
        "trainingId",
        child.get("id"),
        "trainingStatus",
        status,
        "packageId",
        child.get("package_id")
      );
    }
    boolean available =
      PaymentService.available(pack, "RETEST") &&
      (!PaymentService.legacy(pack) ||
        deep.get("id").equals(pack.get("deep_training_id")));
    if (!available) available = sharedFunding(user) != null;
    return Map.of(
      "state",
      available ? "AVAILABLE" : "UNAVAILABLE",
      "returned",
      !children.isEmpty(),
      "packageId",
      pack.get("id")
    );
  }

  Map<String, Object> sharedFunding(String user) {
    return payments
      .packages(user)
      .stream()
      .filter(
        p -> !PaymentService.legacy(p) && PaymentService.available(p, "RETEST")
      )
      .sorted(Comparator.comparing(p -> Boolean.TRUE.equals(p.get("lifetime"))))
      .findFirst()
      .orElse(null);
  }

  List<Map<String, Object>> all(String user) {
    return all(user, false);
  }

  List<Map<String, Object>> all(String user, boolean summary) {
    return new TrainingCatalog(s, payments).all(user, summary);
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
      Map<String, Object> pack;
      Map<String, Object> parentBody = null;
      if (kind.equals("DEEP")) {
        var packs = payments
          .packages(user)
          .stream()
          .filter(p -> PaymentService.available(p, "DEEP"))
          .sorted(
            Comparator.comparing(p -> Boolean.TRUE.equals(p.get("lifetime")))
          )
          .toList();
        if (packs.isEmpty()) throw error(
          409,
          "没有可用的深挖次数，请先获取训练包"
        );
        pack = packs.get(0);
      } else {
        var p = row(user, parent);
        if (
          !"COMPLETED".equals(p.get("status")) ||
          !"DEEP".equals(p.get("kind")) ||
          !projectId.equals(p.get("project_id"))
        ) throw error(400, "复测必须关联本项目已完成的深挖训练");
        pack = s.one(
          "SELECT * FROM training_packages WHERE id=? AND user_id=? FOR UPDATE",
          p.get("package_id"),
          user
        );
        var sourceOrder = s.one(
          "SELECT * FROM purchase_orders WHERE id=?",
          pack.get("order_id")
        );
        payments.requireScope(sourceOrder);
        if (!"PAID".equals(sourceOrder.get("status"))) throw error(
          409,
          "该订单需要支付复核，暂不能使用复测权益"
        );
        var entry = retestEntry(user, p);
        if (
          "CONTINUE".equals(entry.get("state")) ||
          ("COMPLETED".equals(entry.get("state")) && !Boolean.TRUE.equals(input.get("newRound")))
        ) return get(user, str(entry, "trainingId"));
        if (
          !PaymentService.available(pack, "RETEST") ||
          (PaymentService.legacy(pack) &&
            !parent.equals(pack.get("deep_training_id")))
        ) {
          pack = sharedFunding(user);
          if (pack == null) throw error(
            409,
            "没有可用的复测次数，请先获取训练套餐"
          );
        }
        parentBody = s.decode(p.get("body"));
      }
      if (!Boolean.TRUE.equals(project.get("factsConfirmed"))) throw error(
        400,
        "请先提取并核对项目事实"
      );
      String id = id(),
        packageId = str(pack, "id");
      var body = new LinkedHashMap<String, Object>();
      String exercise = str(input, "exerciseMode"), difficulty = str(input, "difficulty");
      if (exercise.isBlank()) exercise = "STANDARD";
      if (difficulty.isBlank()) difficulty = "IMPLEMENTATION";
      if (!Set.of("QUICK", "STANDARD").contains(exercise) ||
          !Set.of("BASIC", "IMPLEMENTATION", "TRADEOFF").contains(difficulty))
        throw error(400, "训练模式或难度不正确");
      body.put("exerciseMode", exercise);
      body.put("difficulty", difficulty);
      body.put("project", project);
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
      s.db.update(
        "INSERT INTO trainings(id,user_id,project_id,package_id,request_key,kind,parent_id,status,body,created_at,history_key) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        id,
        user,
        projectId,
        packageId,
        requestKey,
        kind,
        parent.isBlank() ? null : parent,
        "PENDING",
        s.encode(body),
        now(),
        historyKey
      );
      if (!PaymentService.legacy(pack)) s.db.update(
        "UPDATE training_packages SET training_used=training_used+1 WHERE id=?",
        packageId
      );
      else if (kind.equals("DEEP")) s.db.update(
        "UPDATE training_packages SET deep_used=TRUE,deep_training_id=? WHERE id=?",
        id,
        packageId
      );
      else s.db.update(
        "UPDATE training_packages SET retest_used=TRUE WHERE id=?",
        packageId
      );
      s.db.update(
        "INSERT INTO entitlement_events VALUES (?,?,?,?,?)",
        id(),
        packageId,
        id,
        "RESERVED",
        now()
      );
      return get(user, id);
    });
    // 先持久化训练及权益预留，再在事务外调用模型，失败保留可恢复入口。
    if ("PENDING".equals(training.get("status"))) {
      try {
        return generate(user, str(training, "id"));
      } catch (org.springframework.web.server.ResponseStatusException e) {
        if (
          e.getStatusCode().value() == 503 || e.getStatusCode().value() == 409
        ) return get(user, str(training, "id"));
        throw e;
      }
    }
    return training;
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
        "answer",
        "",
        "createdAt",
        now()
      )
    );
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
    history.backfill(user);
    String token = id();
    var claim = s.locked(user, () -> {
      var r = row(user, id);
      String status = str(r, "status");
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
          list(current, "questionHistory").add(Map.of("question", current.get("question"),
            "topic", current.get("topic"), "revisedAt", now()));
          current.put("question", q.question()); current.put("topic", q.topic());
        } else turns.add(turn(q.question(), q.topic()));
      }
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
          ? response.getReason()
          : "internal_failure"
      );
      s.locked(user, () -> {
        var r = row(user, id);
        if (token.equals(r.get("generation_token"))) {
          var saved = s.decode(r.get("body"));
          boolean first = Set.of(
            "FIRST_QUESTION",
            "FIRST_DEEP_QUESTION"
          ).contains(str(saved, "operation"));
          String savedMessage = first
            ? "首题生成失败，训练记录已保存。可重试生成或返还本次权益。"
            : "生成失败，回答已保存。可重试生成或返还本次权益。";
          saved.put(
            "error",
            e instanceof
              org.springframework.web.server.ResponseStatusException response &&
              ModelService.FREE_QUOTA_ERROR.equals(response.getReason())
              ? ModelService.FREE_QUOTA_ERROR +
                  (first
                    ? "。训练记录已保存，可恢复训练或返还本次权益。"
                    : "。回答已保存，可恢复训练或返还本次权益。")
              : savedMessage
          );
          update(id, "FAILED", saved);
          s.db.update("UPDATE trainings SET lease_until=0 WHERE id=?", id);
        }
        return null;
      });
      throw error(503, "生成失败，回答已保存。请重试或返还本次权益。");
    }
  }

  Map<String, Object> refund(String user, String id) {
    return s.locked(user, () -> {
      var r = row(user, id);
      String status = str(r, "status");
      if (status.equals("REFUNDED")) return get(user, id);
      boolean stale =
        status.equals("GENERATING") &&
        ((Number) r.get("lease_until")).longValue() <= now();
      if (
        !status.equals("FAILED") && !status.equals("PENDING") && !stale
      ) throw error(
        409,
        "只有失败或已超时的训练可以返还；普通中断请继续原训练"
      );
      String packageId = str(r, "package_id"),
        field = "DEEP".equals(r.get("kind")) ? "deep_used" : "retest_used";
      var pack = s.one(
        "SELECT * FROM training_packages WHERE id=? AND user_id=?",
        packageId,
        user
      );
      if (!PaymentService.legacy(pack)) s.db.update(
        "UPDATE training_packages SET training_used=training_used-1 WHERE id=? AND training_used>0",
        packageId
      );
      else s.db.update(
        "UPDATE training_packages SET " + field + "=FALSE WHERE id=?",
        packageId
      );
      s.db.update(
        "INSERT INTO entitlement_events VALUES (?,?,?,?,?)",
        id(),
        packageId,
        id,
        "RETURNED",
        now()
      );
      s.db.update(
        "UPDATE trainings SET status='REFUNDED',generation_token=NULL,lease_until=0 WHERE id=?",
        id
      );
      return get(user, id);
    });
  }
}
