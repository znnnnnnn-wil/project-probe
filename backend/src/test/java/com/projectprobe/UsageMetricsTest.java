package com.projectprobe;
import static com.projectprobe.Store.*;
import static org.junit.jupiter.api.Assertions.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(properties = {"spring.datasource.url=${PROBE_TEST_DB_URL:jdbc:h2:mem:usage;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1}",
  "spring.datasource.username=${PROBE_TEST_DB_USER:sa}", "spring.datasource.password=${PROBE_TEST_DB_PASSWORD:}",
  "app.model-mode=demo"})
class UsageMetricsTest {
  @Autowired Store s; @Autowired ProjectService projects; @Autowired TrainingService trainings;
  @Autowired UsageMetrics metrics;
  @Test void failedAndRetriedRequestsAreRecordedWithoutPretendingTheirCostIsKnown() {
    String user = id(), token = id();
    s.db.update("INSERT INTO app_users VALUES (?,?,?,?)", user, user, "unused", now());
    s.db.update("INSERT INTO auth_sessions VALUES (?,?,?)", Auth.hash(token), user, now() + 60000);
    var request = new org.springframework.mock.web.MockHttpServletRequest();
    request.setCookies(new jakarta.servlet.http.Cookie("probe_session", token));
    org.springframework.web.context.request.RequestContextHolder.setRequestAttributes(
      new org.springframework.web.context.request.ServletRequestAttributes(request));
    try { metrics.attempt("synthetic-model", 1200, false); metrics.attempt("synthetic-model", 800, true); }
    finally { org.springframework.web.context.request.RequestContextHolder.resetRequestAttributes(); }
    assertEquals(2, s.db.queryForObject("SELECT COUNT(*) FROM model_attempts WHERE user_id=?", Integer.class, user));
    assertEquals(1, s.db.queryForObject("SELECT COUNT(*) FROM model_attempts WHERE user_id=? AND outcome='FAILED'", Integer.class, user));
    assertEquals(0, s.db.queryForObject("SELECT COUNT(*) FROM model_usage WHERE user_id=?", Integer.class, user));
  }
  @Test void usageIsPrivateAndCostEstimatesRequireExplicitOperatorAccess() {
    var f = TrainingFixture.create(s, projects, trainings);
    metrics.recordFor(f.user(), "synthetic-model", 100, 50, 1000);
    var first = metrics.own(f.user());
    assertEquals(1L, ((Number) first.get("started")).longValue());
    assertTrue(first.get("textUsage").toString().contains("successful_calls=1"));
    assertFalse(first.get("textUsage").toString().contains("estimated_cost_micros"));
    metrics.inputPrice = 1; metrics.outputPrice = 2;
    metrics.recordFor(f.user(), "synthetic-model", 100, 50, 2000);
    assertEquals(200L, s.db.queryForObject("SELECT SUM(estimated_cost_micros) FROM model_usage WHERE user_id=?", Long.class, f.user()));
    assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> metrics.operator(f.user()));
    metrics.operators = f.user();
    assertTrue(metrics.operator(f.user()).get("textCosts").toString().contains("unpriced_calls"));
    assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> metrics.view(id(), str(f.training(), "id"), trainings));
    trainings.finish(f.user(), str(f.training(), "id"));
    metrics.view(f.user(), str(f.training(), "id"), trainings); metrics.view(f.user(), str(f.training(), "id"), trainings);
    assertEquals(1, s.db.queryForObject("SELECT COUNT(*) FROM report_views WHERE user_id=?", Integer.class, f.user()));
  }
}
