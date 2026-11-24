package com.projectprobe;

import static com.projectprobe.Store.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.context.request.*;

@Service
class UsageMetrics {
  final Store s; final Auth auth;
  @org.springframework.beans.factory.annotation.Autowired JourneyMetrics journey;
  @Value("${app.model-input-price-per-million:-1}") double inputPrice = -1;
  @Value("${app.model-output-price-per-million:-1}") double outputPrice = -1;
  @Value("${app.operator-user-ids:}") String operators = "";
  UsageMetrics(Store s, Auth auth) { this.s = s; this.auth = auth; }

  void record(String model, long prompt, long completion, long elapsed) {
    if (!(RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attributes)) return;
    try { recordFor(auth.user(attributes.getRequest()), model, prompt, completion, elapsed); }
    catch (Exception e) { org.slf4j.LoggerFactory.getLogger(UsageMetrics.class).warn("usage_record_failed type={}", e.getClass().getSimpleName()); }
  }
  void recordFor(String user, String model, long prompt, long completion, long elapsed) {
    Long cost = null;
    if (prompt >= 0 && completion >= 0 && inputPrice >= 0 && outputPrice >= 0 &&
        Double.isFinite(inputPrice) && Double.isFinite(outputPrice)) {
      cost = java.math.BigDecimal.valueOf(inputPrice).multiply(java.math.BigDecimal.valueOf(prompt))
        .add(java.math.BigDecimal.valueOf(outputPrice).multiply(java.math.BigDecimal.valueOf(completion)))
        .setScale(0, java.math.RoundingMode.CEILING).longValueExact();
    }
    s.db.update("INSERT INTO model_usage VALUES (?,?,?,?,?,?,?,?,?)", id(), user, model, "application", prompt, completion, elapsed, cost, now());
  }
  void attempt(String model, long elapsed, boolean successful) {
    if (!(RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attributes)) return;
    try {
      s.db.update("INSERT INTO model_attempts VALUES (?,?,?,?,?,?,?)", id(), auth.user(attributes.getRequest()), "application",
        model, successful ? "SUCCEEDED" : "FAILED", Math.max(0, elapsed), now());
    } catch (Exception e) { org.slf4j.LoggerFactory.getLogger(UsageMetrics.class).warn("attempt_record_failed type={}", e.getClass().getSimpleName()); }
  }
  Map<String, Object> own(String user) {
    var result = new LinkedHashMap<String, Object>(s.one("SELECT COUNT(*) AS started,COALESCE(SUM(CASE WHEN t.status='COMPLETED' THEN 1 ELSE 0 END),0) AS completed,COALESCE(SUM(CASE WHEN t.status='FAILED' THEN 1 ELSE 0 END),0) AS failed,COALESCE(SUM(CASE WHEN t.kind='RETEST' THEN 1 ELSE 0 END),0) AS retests" + TrainingHistory.SCOPED,
      user));
    result.put("reportViews", s.db.queryForObject("SELECT COUNT(*) FROM report_views WHERE user_id=?", Long.class, user));
    result.put("textUsage", s.one("SELECT COUNT(*) AS successful_calls,COALESCE(SUM(CASE WHEN prompt_tokens>=0 THEN prompt_tokens ELSE 0 END),0) AS prompt_tokens,COALESCE(SUM(CASE WHEN completion_tokens>=0 THEN completion_tokens ELSE 0 END),0) AS completion_tokens,COALESCE(SUM(elapsed_ms),0) AS elapsed_ms FROM model_usage WHERE user_id=?", user));
    return result;
  }
  void view(String user, String id, TrainingService trainings) {
    s.locked(user, () -> {
      var training = trainings.get(user, id);
      if (!"COMPLETED".equals(training.get("status"))) throw error(409, "报告尚未完成");
      s.db.update("INSERT INTO report_views SELECT ?,?,? WHERE NOT EXISTS (SELECT 1 FROM report_views WHERE user_id=? AND training_id=?)", user, id, now(), user, id);
      journey.record(user, "REPORT_VIEWED", id);
      return null;
    });
  }
  Map<String, Object> operator(String user) {
    requireOperator(user);
    var result = new LinkedHashMap<String, Object>();
    result.put("accountRecords", s.db.queryForObject("SELECT COUNT(*) FROM app_users", Long.class));
    result.put("journey", journey.summary());
    result.put("modelAttempts", s.db.queryForList("SELECT model_name,outcome,COUNT(*) AS attempts,AVG(elapsed_ms) AS mean_ms,MAX(elapsed_ms) AS max_ms FROM model_attempts GROUP BY model_name,outcome"));
    result.put("textCosts", s.db.queryForList("SELECT COUNT(*) AS responses,COALESCE(SUM(prompt_tokens),0) AS input_tokens,COALESCE(SUM(completion_tokens),0) AS output_tokens,COALESCE(SUM(estimated_cost_micros),0) AS estimated_cost_micros,SUM(CASE WHEN estimated_cost_micros IS NULL THEN 1 ELSE 0 END) AS unpriced_calls FROM model_usage"));
    result.put("costNote", "失败请求和重试计入尝试次数，缺少供应商用量数据时无法估算成本。本项仅统计文本模型。");
    result.put("projectPractice", s.db.queryForList("SELECT status,COUNT(*) AS total FROM project_practice_rounds WHERE status<>'CLEARED' GROUP BY status"));
    result.put("trainingFunnel", s.db.queryForList("SELECT kind,status,COUNT(*) AS total FROM trainings GROUP BY kind,status"));
    return result;
  }
  void requireOperator(String user) {
    if (Arrays.stream(operators.split(",")).map(String::strip).noneMatch(user::equals)) throw error(403, "未配置运营统计权限");
  }
}
