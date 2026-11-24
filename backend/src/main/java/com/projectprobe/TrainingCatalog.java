package com.projectprobe;

import static com.projectprobe.Store.*;

import java.util.*;

final class TrainingCatalog {

  final Store s;

  TrainingCatalog(Store s) {
    this.s = s;
  }

  Map<String, Object> overview(String user) {
    var stats = s.one(
      "SELECT COALESCE(SUM(CASE WHEN t.status NOT IN ('COMPLETED','REFUNDED') THEN 1 ELSE 0 END),0) AS active_count,COALESCE(SUM(CASE WHEN t.status='COMPLETED' THEN 1 ELSE 0 END),0) AS completed_count" +
        TrainingHistory.SCOPED,
      user
    );
    var rows = s.db.queryForList(
      "SELECT t.*" +
        TrainingHistory.SCOPED +
        " AND (t.status NOT IN ('COMPLETED','REFUNDED') OR (t.status='COMPLETED' AND NOT EXISTS (SELECT 1 FROM trainings newer WHERE newer.user_id=t.user_id AND newer.project_id=t.project_id AND newer.status<>'REFUNDED' AND (newer.created_at>t.created_at OR (newer.created_at=t.created_at AND newer.id>t.id))))) ORDER BY t.created_at DESC,t.id DESC",
      user
    );
    return Map.of(
      "items",
      assemble(user, rows, true, false),
      "activeCount",
      stats.get("active_count"),
      "completedCount",
      stats.get("completed_count")
    );
  }

  ListPage<Map<String, Object>> page(
    String user,
    int offset,
    int limit,
    String key,
    String project
  ) {
    if (
      offset < 0 ||
      offset > 1000000 ||
      limit < 1 ||
      limit > 100 ||
      key.length() > 64 ||
      project.length() > 36
    ) throw error(400, "分页或筛选参数不正确");
    String filter = "";
    var args = new ArrayList<Object>(
      List.of(user)
    );
    if (!key.isBlank()) {
      filter += " AND (t.history_key=? OR t.project_id=?)";
      args.add(key);
      args.add(key);
    }
    if (!project.isBlank()) {
      filter += " AND t.project_id=?";
      args.add(project);
    }
    long total = s.db.queryForObject(
      "SELECT COUNT(*)" + TrainingHistory.SCOPED + filter,
      Long.class,
      args.toArray()
    );
    args.add(limit);
    args.add(offset);
    var rows = s.db.queryForList(
      "SELECT t.*" +
        TrainingHistory.SCOPED +
        filter +
        " ORDER BY t.created_at DESC,t.id DESC LIMIT ? OFFSET ?",
      args.toArray()
    );
    return new ListPage<>(
      assemble(user, rows, true, false),
      (long) offset + rows.size() < total,
      total,
      offset,
      limit
    );
  }

  List<Map<String, String>> choices(String user) {
    var rows = s.db.queryForList(
      "SELECT DISTINCT t.history_key,t.project_id,pr.body" +
        TrainingHistory.SCOPED.replace(
          " WHERE",
          " JOIN projects pr ON pr.id=t.project_id WHERE"
        ),
      user
    );
    var result = new TreeMap<String, Map<String, String>>();
    for (var row : rows) {
      String key =
        row.get("history_key") == null
          ? str(row, "project_id")
          : str(row, "history_key");
      result.putIfAbsent(
        key,
        Map.of("key", key, "name", str(s.decode(row.get("body")), "name"))
      );
    }
    return new ArrayList<>(result.values());
  }

  List<Map<String, Object>> all(String user) {
    return all(user, false);
  }

  List<Map<String, Object>> all(String user, boolean summary) {
    return all(user, summary, "");
  }

  List<Map<String, Object>> all(String user, boolean summary, String project) {
    var args = new ArrayList<Object>(
      List.of(user)
    );
    if (!project.isBlank()) args.add(project);
    var rows = s.db.queryForList(
      "SELECT t.*" +
        TrainingHistory.SCOPED +
        (project.isBlank() ? "" : " AND t.project_id=?") +
        " ORDER BY t.created_at DESC,t.id DESC",
      args.toArray()
    );
    return assemble(user, rows, summary, true);
  }

  List<Map<String, Object>> assemble(
    String user,
    List<Map<String, Object>> rows,
    boolean summary,
    boolean complete
  ) {
    var children = new HashMap<String, List<Map<String, Object>>>();
    var relatedRows = rows;
    if (!complete) {
      var parentIds = rows
        .stream()
        .filter(
          r ->
            "DEEP".equals(r.get("kind")) && "COMPLETED".equals(r.get("status"))
        )
        .map(r -> r.get("id"))
        .toList();
      if (!parentIds.isEmpty()) {
        var args = new ArrayList<Object>(
          List.of(user)
        );
        args.addAll(parentIds);
        relatedRows = s.db.queryForList(
          "SELECT t.*" +
            TrainingHistory.SCOPED +
            " AND t.kind='RETEST' AND t.parent_id IN (" +
            String.join(",", Collections.nCopies(parentIds.size(), "?")) +
            ") ORDER BY t.created_at DESC,t.id DESC",
          args.toArray()
        );
      } else relatedRows = List.of();
    }
    for (var row : relatedRows)
      if ("RETEST".equals(row.get("kind"))) children
        .computeIfAbsent(str(row, "parent_id"), k -> new ArrayList<>())
        .add(row);
    var result = new ArrayList<Map<String, Object>>();
    for (var row : rows) {
      var body = s.decode(row.get("body"));
      Map<String, Object> item = body;
      if (summary) {
        item = new LinkedHashMap<>();
        for (String key : List.of("kind", "maxTurns", "historyRoundNumber", "focus", "parentId"))
          if (body.containsKey(key)) item.put(key, body.get(key));
        var project = (Map<String, Object>) body.get("project");
        item.put(
          "project",
          Map.of("id", str(project, "id"), "name", str(project, "name"))
        );
        item.put(
          "answeredCount",
          list(body, "turns")
            .stream()
            .filter(t -> !str(t, "answer").isBlank())
            .count()
        );
        item.put("turnCount", list(body, "turns").size());
        if (body.get("report") instanceof Map<?, ?> report) item.put(
          "retestTopics",
          report.getOrDefault("retestTopics", null)
        );
      }
      item.put("id", row.get("id"));
      item.put("status", row.get("status"));
      item.put("createdAt", row.get("created_at"));
      item.put("leaseUntil", row.get("lease_until"));
      if (row.get("history_key") != null) item.put(
        "historyKey",
        row.get("history_key")
      );
      if (
        "DEEP".equals(row.get("kind")) && "COMPLETED".equals(row.get("status"))
      ) {
        var related = children.getOrDefault(str(row, "id"), List.of());
        item.put("retestEntry", TrainingService.retestEntry(related));
      }
      result.add(item);
    }
    return result;
  }
}
