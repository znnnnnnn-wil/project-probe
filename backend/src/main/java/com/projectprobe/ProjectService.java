package com.projectprobe;

import static com.projectprobe.Store.*;

import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class ProjectService {

  private static final int MAX_BATCH_SIZE = 10;

  final Store s;
  final ModelService model;
  @org.springframework.beans.factory.annotation.Autowired JourneyMetrics journey;

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
      return saveLocked(user, id, old, materialBody(input));
    });
  }

  Map<String, Object> openExample(String user, String id, Map<String, Object> input) {
    return s.locked(user, () -> {
      var exists = s.db.queryForList("SELECT id FROM projects WHERE id=? AND user_id=?", id, user);
      return exists.isEmpty() ? saveLocked(user, id, null, materialBody(input)) : get(user, id);
    });
  }

  List<Map<String, Object>> createBatch(String user, Map<String, Object> input) {
    if (
      !(input.get("projects") instanceof List<?> entries) ||
      entries.isEmpty() || entries.size() > MAX_BATCH_SIZE
    ) throw error(400, "每次可保存 1–" + MAX_BATCH_SIZE + " 个项目");

    String requestKey = input.get("requestKey") == null
      ? ""
      : required(input, "requestKey", 100);
    var bodies = new ArrayList<Map<String, Object>>(entries.size());
    for (int i = 0; i < entries.size(); i++) {
      if (!(entries.get(i) instanceof Map<?, ?> project)) throw error(
        400, "第 " + (i + 1) + " 个项目的格式不正确"
      );
      try {
        bodies.add(materialBody(project));
      } catch (ResponseStatusException e) {
        throw error(400, "第 " + (i + 1) + " 个项目：" + e.getReason());
      }
    }

    String fingerprint = requestKey.isEmpty() ? "" : Auth.hash(s.encode(bodies));
    return s.locked(user, () -> {
      if (!requestKey.isEmpty()) {
        var existing = s.db.queryForList(
          "SELECT fingerprint,project_ids FROM project_batch_creations WHERE user_id=? AND request_key=?",
          user,
          requestKey
        );
        if (!existing.isEmpty()) {
          var saved = existing.get(0);
          if (!fingerprint.equals(saved.get("fingerprint"))) throw error(
            409, "本次保存标识已用于另一批项目，请重新提交"
          );
          return Arrays.stream(str(saved, "project_ids").split(","))
            .map(id -> get(user, id))
            .toList();
        }
      }
      var projects = new ArrayList<Map<String, Object>>(bodies.size());
      for (var body : bodies) projects.add(saveLocked(user, id(), null, body));
      if (!requestKey.isEmpty()) {
        var ids = projects.stream().map(project -> str(project, "id")).toList();
        s.db.update(
          "INSERT INTO project_batch_creations(user_id,request_key,fingerprint,project_ids) VALUES (?,?,?,?)",
          user,
          requestKey,
          fingerprint,
          String.join(",", ids)
        );
      }
      return projects;
    });
  }

  private Map<String, Object> materialBody(Map<?, ?> input) {
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
      String v = Objects.toString(input.get(field), "");
      if (v.length() > 12000) throw error(400, "单项材料最多 12000 字");
      body.put(field, v);
    }
    required(body, "name", 100);
    if (s.encode(body).length() > 45000) throw error(
      400,
      "项目总材料请控制在 45000 字以内"
    );
    return body;
  }

  private Map<String, Object> saveLocked(
    String user,
    String id,
    Map<String, Object> old,
    Map<String, Object> body
  ) {
    if (
      old != null &&
      body.entrySet().stream().allMatch(e -> Objects.equals(old.get(e.getKey()), e.getValue()))
    ) return old;
    body.put("facts", List.of());
    body.put("factsConfirmed", false);
    int version = old == null ? 1 : ((Number) old.get("version")).intValue() + 1;
    String encoded = s.encode(body);
    if (old == null) s.db.update(
      "INSERT INTO projects VALUES (?,?,?,?,?)",
      id,
      user,
      encoded,
      version,
      now()
    );
    else s.db.update(
      "UPDATE projects SET body=?,version=?,updated_at=? WHERE id=?",
      encoded,
      version,
      now(),
      id
    );
    s.db.update(
      "INSERT INTO project_revisions VALUES (?,?,?)",
      id,
      version,
      encoded
    );
    if (journey != null) journey.record(user, "MATERIAL_SAVED", id);
    return get(user, id);
  }

  private record Extraction(Map<String, Object> project, MaterialJob job) {}

  Map<String, Object> extract(String user, String id) {
    String identity = s.encode(List.of(model.mode, model.provider, model.model));
    var task = s.locked(user, () -> {
      var project = get(user, id);
      // 确认后的编辑仍保留；只有保存新材料或切换模型才重新提取。
      if (identity.equals(project.get("factsExtractionIdentity"))) return new Extraction(project, null);
      return new Extraction(project, MaterialJob.claim(s, user, "EXTRACTION", id, "该项目正在提取事实，请稍后重试"));
    });
    if (task.job() == null) return task.project();

    try {
      var facts = model.extract(task.project());
      return s.locked(user, () -> {
        task.job().requireCurrent(s);
        var project = get(user, id);
        if (!project.get("version").equals(task.project().get("version"))) throw error(409, "材料已更改，请重新提取");
        project.put("facts", facts);
        project.put("factsConfirmed", false);
        project.put("factsExtractionIdentity", identity);
        persist(id, project);
        return project;
      });
    } finally {
      task.job().release(s);
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
      if (journey != null) journey.record(user, "FACTS_CONFIRMED", id);
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
