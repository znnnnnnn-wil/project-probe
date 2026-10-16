package com.projectprobe;
import static com.projectprobe.Store.*;
import static org.junit.jupiter.api.Assertions.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(properties = {"spring.datasource.url=${PROBE_TEST_DB_URL:jdbc:h2:mem:practice;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1}",
  "spring.datasource.username=${PROBE_TEST_DB_USER:sa}", "spring.datasource.password=${PROBE_TEST_DB_PASSWORD:}",
  "app.model-mode=demo", "app.payment.mode=mock", "app.payment.reconcile-enabled=false"})
class ProjectPracticeTest {
  @Autowired Store s; @Autowired ProjectService projects; @Autowired ProjectPractice practice;
  @Test void trialWorksWithoutPaymentAndDoesNotCreateCommercialEvidence() {
    String user = id(); s.db.update("INSERT INTO app_users VALUES (?,?,?,?)", user, user, "unused", now());
    var p = projects.save(user, null, Map.of("name", "合成预约项目", "responsibility", "接口实现"));
    String project = str(p, "id");
    var first = practice.run(user, project, Map.of());
    assertEquals("ACTIVE", first.get("status"));
    assertEquals(first, practice.run(user, project, Map.of()));
    var complete = practice.run(user, project, Map.of("answer", "我在数据库约束中防止重复预约。"));
    assertEquals("COMPLETED", complete.get("status"));
    assertTrue(complete.containsKey("report"));
    assertEquals(complete, practice.run(user, project, Map.of()));
    var another = projects.save(user, null, Map.of("name", "另一项目", "responsibility", "测试"));
    assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> practice.run(user, str(another, "id"), Map.of()));
    assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> practice.get(id(), project));
    assertEquals(0, s.db.queryForObject("SELECT COUNT(*) FROM purchase_orders WHERE user_id=?", Integer.class, user));
    assertEquals(0, s.db.queryForObject("SELECT COUNT(*) FROM trainings WHERE user_id=?", Integer.class, user));
  }
  @Test void expiredQuestionLeaseCanRecoverWithoutGeneratingAnEmptyReport() {
    String user = id(); s.db.update("INSERT INTO app_users VALUES (?,?,?,?)", user, user, "unused", now());
    var p = projects.save(user, null, Map.of("name", "合成恢复项目", "responsibility", "接口"));
    String project = str(p, "id"); practice.run(user, project, Map.of());
    s.db.update("UPDATE project_trials SET status='GENERATING',lease_until=? WHERE user_id=?", now() + 60000, user);
    assertEquals("GENERATING", practice.get(user, project).get("status"));
    assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> practice.run(user, project, Map.of()));
    s.db.update("UPDATE project_trials SET lease_until=? WHERE user_id=?", now() - 1, user);
    assertEquals("FAILED", practice.get(user, project).get("status"));
    var recovered = practice.run(user, project, Map.of());
    assertEquals("ACTIVE", recovered.get("status"));
    assertFalse(recovered.containsKey("report"));
  }
}
