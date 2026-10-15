package com.projectprobe;
import static com.projectprobe.Store.*;
import static org.junit.jupiter.api.Assertions.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(properties = {"spring.datasource.url=jdbc:h2:mem:usage;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
  "app.model-mode=demo", "app.payment.mode=mock", "app.payment.reconcile-enabled=false"})
class UsageMetricsTest {
  @Autowired Store s; @Autowired ProjectService projects; @Autowired TrainingService trainings;
  @Autowired PaymentService payments; @Autowired UsageMetrics metrics;
  @Test void usageIsPrivateAndUnknownPricesDoNotMeanFreeAndAdminIsExplicit() {
    var f = TrainingFixture.create(s, projects, payments, trainings);
    metrics.recordFor(f.user(), "synthetic-model", 100, 50, 1000);
    var first = metrics.ownScoped(f.user(), payments);
    assertEquals(1L, ((Number) first.get("started")).longValue());
    assertTrue(first.get("textUsage").toString().contains("unpriced_calls=1"));
    metrics.inputPrice = 1; metrics.outputPrice = 2;
    metrics.recordFor(f.user(), "synthetic-model", 100, 50, 2000);
    assertEquals(200L, s.db.queryForObject("SELECT SUM(estimated_cost_micros) FROM model_usage WHERE user_id=?", Long.class, f.user()));
    assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> metrics.operator(f.user()));
    metrics.operators = f.user();
    assertTrue(metrics.operator(f.user()).get("payments").toString().contains("mock"));
    assertFalse(metrics.operator(f.user()).get("payments").toString().contains("production"));
    assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> metrics.view(id(), str(f.training(), "id"), trainings));
    trainings.finish(f.user(), str(f.training(), "id"));
    metrics.view(f.user(), str(f.training(), "id"), trainings); metrics.view(f.user(), str(f.training(), "id"), trainings);
    assertEquals(1, s.db.queryForObject("SELECT COUNT(*) FROM report_views WHERE user_id=?", Integer.class, f.user()));
  }
}
