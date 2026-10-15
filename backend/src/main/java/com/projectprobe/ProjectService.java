package com.projectprobe;

import static com.projectprobe.Store.*;

import java.util.*;
import org.springframework.stereotype.Service;

@Service
public class ProjectService {

  final Store s;
  final ModelService model;

  @org.springframework.beans.factory.annotation.Value(
    "${app.extraction-daily-limit:20}"
  )
  int extractionDailyLimit = 20;

  @jakarta.annotation.PostConstruct
  void validateExtractionLimit() {
    if (
      extractionDailyLimit < 1 || extractionDailyLimit > 1000
    ) throw new IllegalArgumentException(
      "事实提取额度须为每账号每 24 小时 1–1000 次"
    );
  }

  ProjectService(Store s, ModelService model) {
    this.s = s;
    this.model = model;
  }

  Map<String, Object> get(String user, String id) {
    var row = s.one(
      "SELECT * FROM projects WHERE id=? AND user_id=?",
      id,
      user
    );
    var b = s.decode(row.get("body"));
    b.put("id", id);
    b.put("version", row.get("version"));
    return b;
  }

  List<Map<String, Object>> all(String user) {
    return all(user, false);
  }

  List<Map<String, Object>> all(String user, boolean summary) {
    return s.db
      .queryForList(
        "SELECT id,version,body FROM projects WHERE user_id=? ORDER BY updated_at DESC,id DESC",
        user
      )
      .stream()
      .map(r -> {
        var body = s.decode(r.get("body"));
        body.put("id", r.get("id"));
        body.put("version", r.get("version"));
        if (summary) {
          var fields = new LinkedHashMap<String, Object>();
          for (String key : List.of(
            "id",
            "name",
            "stack",
            "background",
            "factsConfirmed",
            "version"
          ))
            if (body.containsKey(key)) fields.put(key, body.get(key));
          return fields;
        }
        return body;
      })
      .toList();
  }

  Map<String, Object> save(
    String user,
    String projectId,
    Map<String, Object> input
  ) {
    return s.locked(user, () -> {
      Map<String, Object> old = projectId == null ? null : get(user, projectId);
      String id = projectId == null ? id() : projectId;
      if (
        old != null && !Objects.equals(old.get("version"), input.get("version"))
      ) throw error(409, "项目已在其他页面修改，请重新加载后保存");
      var body = new LinkedHashMap<String, Object>();
      for (String field : List.of(
        "name",
        "background",
        "targetRole",
        "stack",
        "responsibility",
        "resume",
        "architecture",
        "implementation",
        "problems",
        "verification",
        "materials"
      )) {
        String v = str(input, field);
        if (v.length() > 12000) throw error(400, "单项材料最多 12000 字");
        body.put(field, v);
      }
      required(body, "name", 100);
      required(body, "responsibility", 12000);
      if (s.encode(body).length() > 45000) throw error(
        400,
        "项目总材料请控制在 45000 字以内"
      );
      if (
        old != null &&
        body
          .entrySet()
          .stream()
          .allMatch(e -> Objects.equals(old.get(e.getKey()), e.getValue()))
      ) return old;
      body.put("facts", List.of());
      body.put("factsConfirmed", false);
      int version =
        old == null ? 1 : ((Number) old.get("version")).intValue() + 1;
      if (old == null) s.db.update(
        "INSERT INTO projects VALUES (?,?,?,?,?)",
        id,
        user,
        s.encode(body),
        version,
        now()
      );
      else s.db.update(
        "UPDATE projects SET body=?,version=?,updated_at=? WHERE id=?",
        s.encode(body),
        version,
        now(),
        id
      );
      s.db.update(
        "INSERT INTO project_revisions VALUES (?,?,?)",
        id,
        version,
        s.encode(body)
      );
      return get(user, id);
    });
  }

  Map<String, Object> extract(String user, String id) {
    String identity = s.encode(
      List.of(model.mode, model.provider, model.model)
    );
    String token = id();
    var before = s.locked(user, () -> {
      var b = get(user, id);
      // 确认后的编辑仍保留；只有保存新材料或切换模型才重新提取。
      if (identity.equals(b.get("factsExtractionIdentity"))) return b;
      var rows = s.db.queryForList(
        "SELECT * FROM extraction_limits WHERE user_id=?",
        user
      );
      long time = now();
      if (rows.isEmpty()) {
        s.db.update(
          "INSERT INTO extraction_limits(user_id,window_start) VALUES (?,?)",
          user,
          time
        );
        rows = s.db.queryForList(
          "SELECT * FROM extraction_limits WHERE user_id=?",
          user
        );
      }
      var limit = rows.get(0);
      if (((Number) limit.get("lease_until")).longValue() > time) throw error(
        409,
        "已有事实提取正在执行，请稍后再试"
      );
      long start = ((Number) limit.get("window_start")).longValue();
      int attempts = ((Number) limit.get("attempts")).intValue();
      if (time - start >= 86400000L) {
        start = time;
        attempts = 0;
      }
      if (attempts >= extractionDailyLimit) throw error(
        429,
        "本账号的事实提取额度已用完，请在当前 24 小时窗口结束后重试"
      );
      s.db.update(
        "UPDATE extraction_limits SET window_start=?,attempts=?,lease_until=?,lease_token=? WHERE user_id=?",
        start,
        attempts + 1,
        time + 90000,
        token,
        user
      );
      return b;
    });
    if (identity.equals(before.get("factsExtractionIdentity"))) return before;
    try {
      var facts = model.extract(before);
      return s.locked(user, () -> {
        var lease = s.one(
          "SELECT * FROM extraction_limits WHERE user_id=?",
          user
        );
        if (!token.equals(lease.get("lease_token"))) throw error(
          409,
          "提取任务已超时并被替换，请重新加载"
        );
        var b = get(user, id);
        if (!b.get("version").equals(before.get("version"))) throw error(
          409,
          "材料已更改，请重新提取"
        );
        b.put("facts", facts);
        b.put("factsConfirmed", false);
        b.put("factsExtractionIdentity", identity);
        persist(id, b);
        return b;
      });
    } finally {
      // 旧任务不得清除已被新任务接管的租约。
      s.db.update(
        "UPDATE extraction_limits SET lease_until=0,lease_token=NULL WHERE user_id=? AND lease_token=?",
        user,
        token
      );
    }
  }

  Map<String, Object> confirm(
    String user,
    String id,
    Map<String, Object> input
  ) {
    return s.locked(user, () -> {
      var b = get(user, id);
      if (!Objects.equals(b.get("version"), input.get("version"))) throw error(
        409,
        "材料已更改，请重新加载"
      );
      var original = list(b, "facts");
      var edited = list(input, "facts");
      if (original.isEmpty() || edited.size() != original.size()) throw error(
        400,
        "请先提取并核对事实"
      );
      for (int i = 0; i < original.size(); i++) {
        var f = original.get(i);
        var e = edited.get(i);
        if (!f.get("id").equals(e.get("id"))) throw error(
          400,
          "事实 ID 不匹配"
        );
        f.put("text", required(e, "text", 12000));
        f.put("confirmed", Boolean.TRUE.equals(e.get("confirmed")));
      }
      // 确认表示已审阅；未确认的推断仍保留原类别。
      b.put("factsConfirmed", true);
      persist(id, b);
      return b;
    });
  }

  void persist(String id, Map<String, Object> b) {
    int version = ((Number) b.get("version")).intValue() + 1;
    b.put("version", version);
    s.db.update(
      "UPDATE projects SET body=?,version=?,updated_at=? WHERE id=?",
      s.encode(b),
      version,
      now(),
      id
    );
    s.db.update(
      "INSERT INTO project_revisions VALUES (?,?,?)",
      id,
      version,
      s.encode(b)
    );
  }
}
