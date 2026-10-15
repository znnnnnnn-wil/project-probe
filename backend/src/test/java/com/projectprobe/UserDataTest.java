package com.projectprobe;

import static com.projectprobe.Store.*;
import static org.junit.jupiter.api.Assertions.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(properties = {"spring.datasource.url=${PROBE_TEST_DB_URL:jdbc:h2:mem:user-data;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1}",
  "spring.datasource.username=${PROBE_TEST_DB_USER:sa}", "spring.datasource.password=${PROBE_TEST_DB_PASSWORD:}",
  "app.model-mode=demo", "app.payment.mode=mock", "app.payment.reconcile-enabled=false"})
class UserDataTest {
  @Autowired Store s;
  @Autowired Auth auth;
  @Autowired ProjectService projects;
  @Autowired PaymentService payments;
  @Autowired TrainingService trainings;
  @Autowired UserData data;
  @Test void deletionRequiresPasswordAndConfirmationAndPreservesFinancialRecords() {
    var f = TrainingFixture.create(s, projects, payments, trainings);
    String password = "synthetic-delete-password";
    s.db.update("UPDATE app_users SET password_hash=? WHERE id=?", auth.encoder.encode(password), f.user());
    assertThrows(org.springframework.web.server.ResponseStatusException.class, () ->
      data.removeProject(f.user(), f.project(), Map.of("password", password, "confirmation", "错误名称")));
    assertThrows(org.springframework.web.server.ResponseStatusException.class, () ->
      data.removeProject(f.user(), f.project(), Map.of("password", "wrong-password", "confirmation", "合成项目")));
    data.removeProject(f.user(), f.project(), Map.of("password", password, "confirmation", "合成项目"));
    assertEquals(0, s.db.queryForObject("SELECT COUNT(*) FROM projects WHERE user_id=?", Integer.class, f.user()));
    assertEquals(0, s.db.queryForObject("SELECT COUNT(*) FROM trainings WHERE user_id=?", Integer.class, f.user()));
    assertEquals(1, s.db.queryForObject("SELECT COUNT(*) FROM purchase_orders WHERE user_id=?", Integer.class, f.user()));
    assertEquals(1, ((Number) payments.packages(f.user()).get(0).get("training_used")).intValue());
    data.closeAccount(f.user(), Map.of("password", password, "confirmation", "注销账户"));
    assertTrue(str(s.one("SELECT username FROM app_users WHERE id=?", f.user()), "username").startsWith("closed-"));
  }
}
