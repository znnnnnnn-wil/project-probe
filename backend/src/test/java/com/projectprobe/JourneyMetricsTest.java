package com.projectprobe;

import static com.projectprobe.Store.*;
import static org.junit.jupiter.api.Assertions.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(properties = {"spring.datasource.url=${PROBE_TEST_DB_URL:jdbc:h2:mem:journey;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1}",
  "spring.datasource.username=${PROBE_TEST_DB_USER:sa}", "spring.datasource.password=${PROBE_TEST_DB_PASSWORD:}",
  "app.model-mode=demo", "app.payment.mode=mock", "app.payment.reconcile-enabled=false"})
class JourneyMetricsTest {
  @Autowired Store s; @Autowired JourneyMetrics journey; @Autowired Auth auth;
  @Autowired ProjectService projects; @Autowired ProjectPractice practice; @Autowired UserData data;
  @Test void stagesAreIdempotentEnvironmentScopedAndErasedWithUserContent() {
    String user = id(), password = "synthetic-journey-password";
    s.db.update("INSERT INTO app_users VALUES (?,?,?,?)", user, user, auth.encoder.encode(password), now());
    journey.record(user, "REGISTERED", user); journey.record(user, "REGISTERED", user);
    var project = projects.save(user, null, Map.of("name", "合成漏斗项目", "responsibility", "预约接口"));
    String projectId = str(project, "id");
    practice.run(user, projectId, Map.of()); practice.run(user, projectId, Map.of("answer", "我实现数据库约束。"));
    assertEquals(4, s.db.queryForObject("SELECT COUNT(*) FROM journey_events WHERE user_id=? AND payment_mode='mock'", Integer.class, user));
    journey.mode = "sandbox";
    try { journey.record(user, "REGISTERED", user); assertEquals("sandbox", journey.summary().get("paymentMode")); }
    finally { journey.mode = "mock"; }
    assertEquals(1, s.db.queryForObject("SELECT COUNT(*) FROM journey_events WHERE user_id=? AND payment_mode='sandbox'", Integer.class, user));
    data.removeProject(user, projectId, Map.of("password", password, "confirmation", "合成漏斗项目"));
    assertEquals(2, s.db.queryForObject("SELECT COUNT(*) FROM journey_events WHERE user_id=?", Integer.class, user));
    data.closeAccount(user, Map.of("password", password, "confirmation", "注销账户"));
    assertEquals(0, s.db.queryForObject("SELECT COUNT(*) FROM journey_events WHERE user_id=?", Integer.class, user));
  }
}
