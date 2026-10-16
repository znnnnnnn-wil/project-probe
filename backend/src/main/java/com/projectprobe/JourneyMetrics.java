package com.projectprobe;

import static com.projectprobe.Store.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
class JourneyMetrics {
  final Store s;
  @Value("${app.payment.mode:mock}") String mode = "mock";
  JourneyMetrics(Store s) { this.s = s; }
  void record(String user, String event, String subject) {
    if (!Set.of("REGISTERED", "MATERIAL_SAVED", "FACTS_CONFIRMED", "TRIAL_STARTED", "TRIAL_COMPLETED",
        "TRAINING_STARTED", "RETEST_STARTED", "REPORT_COMPLETED", "REPORT_VIEWED").contains(event))
      throw new IllegalArgumentException("Unsupported journey stage");
    s.locked(user, () -> {
      s.db.update("INSERT INTO journey_events SELECT ?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM journey_events WHERE user_id=? AND payment_mode=? AND event=? AND subject_id=?)",
        user, mode, event, subject, now(), user, mode, event, subject);
      return null;
    });
  }
  Map<String, Object> summary() {
    return Map.of("paymentMode", mode,
      "stages", s.db.queryForList("SELECT event,COUNT(*) AS events,COUNT(DISTINCT user_id) AS users FROM journey_events WHERE payment_mode=? GROUP BY event ORDER BY event", mode),
      "secondsFromRegistration", s.db.queryForList("SELECT e.event,AVG((e.first_at-r.first_at)/1000.0) AS mean_seconds,COUNT(*) AS users FROM (SELECT user_id,event,MIN(occurred_at) AS first_at FROM journey_events WHERE payment_mode=? GROUP BY user_id,event) e JOIN (SELECT user_id,MIN(occurred_at) AS first_at FROM journey_events WHERE payment_mode=? AND event='REGISTERED' GROUP BY user_id) r ON e.user_id=r.user_id WHERE e.first_at>=r.first_at GROUP BY e.event", mode, mode),
      "note", "自功能启用起记录各阶段独立人数，体验为可选路径，不代表严格连续转化率；耗时仅统计同期有注册记录的账号，不回填历史测试成果。");
  }
}
