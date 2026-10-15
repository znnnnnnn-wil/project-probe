package com.projectprobe;
import static com.projectprobe.Store.*;
import java.util.*;
import org.springframework.stereotype.Service;

@Service
class FeedbackService {
  final Store s; final UsageMetrics metrics;
  FeedbackService(Store s, UsageMetrics metrics) { this.s = s; this.metrics = metrics; }
  List<Map<String, Object>> own(String user) { return s.db.queryForList("SELECT id,kind,body,status,reply,created_at FROM user_feedback WHERE user_id=? ORDER BY created_at DESC LIMIT 20", user); }
  Map<String, Object> submit(String user, Map<String, Object> input, String training) {
    String kind = required(input, "kind", 20), detail = required(input, "detail", 2000), key = required(input, "requestKey", 100);
    String request = str(input, "requestId");
    if (!Set.of("GENERAL", "PAYMENT", "ACCOUNT", "QUESTION").contains(kind) || (!request.isBlank() && !request.matches("[a-f0-9-]{36}"))) throw error(400, "反馈类型或请求编号不正确");
    return s.locked(user, () -> {
      var old = s.db.queryForList("SELECT id FROM user_feedback WHERE user_id=? AND request_key=?", user, key);
      if (!old.isEmpty()) return Map.of("id", old.get(0).get("id"));
      if (s.db.queryForObject("SELECT COUNT(*) FROM user_feedback WHERE user_id=? AND created_at>?", Integer.class, user, now() - 86400000L) >= 20)
        throw error(429, "每日最多提交20条反馈");
      String id = id();
      s.db.update("INSERT INTO user_feedback VALUES (?,?,?,?,?,?,?,?,?,?)", id, user, key, kind, detail,
        request.isBlank() ? null : request, training.isBlank() ? null : training, "OPEN", "", now());
      return Map.of("id", id);
    });
  }
  List<Map<String, Object>> operator(String user) {
    metrics.operator(user);
    return s.db.queryForList("SELECT id,kind,body,request_id,training_id,status,reply,created_at FROM user_feedback ORDER BY created_at DESC LIMIT 100");
  }
  void reply(String user, String id, Map<String, Object> input) {
    metrics.operator(user); String reply = required(input, "reply", 2000), status = required(input, "status", 20);
    if (!Set.of("OPEN", "RESOLVED").contains(status)) throw error(400, "处理状态不正确");
    if (s.db.update("UPDATE user_feedback SET reply=?,status=? WHERE id=?", reply, status, id) != 1) throw error(404, "反馈不存在");
  }
}
