package com.projectprobe;

import static com.projectprobe.Store.*;
import java.util.*;
import org.springframework.stereotype.Service;

@Service
class JourneyMetrics {
  final Store s;
  JourneyMetrics(Store s) { this.s = s; }
  void record(String user, String event, String subject) {
    if (!Set.of("REGISTERED", "MATERIAL_SAVED", "FACTS_CONFIRMED", "PRACTICE_STARTED", "PRACTICE_COMPLETED",
        "TRAINING_STARTED", "RETEST_STARTED", "REPORT_COMPLETED", "REPORT_VIEWED").contains(event))
      throw new IllegalArgumentException("Unsupported journey stage");
    s.locked(user, () -> {
      s.db.update("""
        INSERT INTO journey_events(user_id,payment_mode,event,subject_id,occurred_at)
        SELECT ?, 'application', ?, ?, ? WHERE NOT EXISTS (
          SELECT 1 FROM journey_events WHERE user_id=? AND event=? AND subject_id=?
        )
        """, user, event, subject, now(), user, event, subject);
      return null;
    });
  }
  Map<String, Object> summary() {
    return Map.of(
      "stages", s.db.queryForList("""
        SELECT event,COUNT(*) AS events,COUNT(DISTINCT user_id) AS users
        FROM (SELECT DISTINCT user_id,event,subject_id FROM journey_events) stages
        GROUP BY event ORDER BY event
        """),
      "secondsFromRegistration", s.db.queryForList("""
        SELECT e.event,AVG((e.first_at-r.first_at)/1000.0) AS mean_seconds,COUNT(*) AS users
        FROM (SELECT user_id,event,MIN(occurred_at) AS first_at FROM journey_events GROUP BY user_id,event) e
        JOIN (SELECT user_id,MIN(occurred_at) AS first_at FROM journey_events
          WHERE event='REGISTERED' GROUP BY user_id) r ON e.user_id=r.user_id
        WHERE e.first_at>=r.first_at GROUP BY e.event
        """),
      "note", "记录各阶段独立人数。耗时仅统计同时有注册和阶段记录的账号。");
  }
}
