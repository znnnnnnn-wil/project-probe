package com.projectprobe;

import static com.projectprobe.Store.*;
import static org.junit.jupiter.api.Assertions.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockHttpServletResponse;

@SpringBootTest(properties = {"spring.datasource.url=jdbc:h2:mem:account-security;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
  "app.model-mode=demo", "app.payment.mode=mock", "app.payment.reconcile-enabled=false"})
class AccountSecurityTest {
  @Autowired Store s;
  @Autowired Auth auth;
  @Autowired AccountSecurity security;
  @Test void recoveryCodesAreHashedSingleUseAndRevokeSessions() {
    String name = "recover-" + id(), password = "synthetic-old-password";
    var user = auth.login(Map.of("username", name, "password", password), true, new MockHttpServletResponse());
    String userId = str(user, "id");
    assertThrows(org.springframework.web.server.ResponseStatusException.class,
      () -> security.recovery(userId, Map.of("password", "incorrect-password")));
    var code = security.recovery(userId, Map.of("password", password));
    assertNotEquals(code.get("recoveryCode"), s.one("SELECT code_hash FROM account_recovery WHERE user_id=?", userId).get("code_hash"));
    var reset = Map.<String, Object>of("username", name, "recoveryCode", code.get("recoveryCode"), "newPassword", "synthetic-new-password");
    security.recover(reset);
    assertEquals(0, s.db.queryForObject("SELECT COUNT(*) FROM auth_sessions WHERE user_id=?", Integer.class, userId));
    assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> security.recover(reset));
    assertThrows(org.springframework.web.server.ResponseStatusException.class,
      () -> auth.login(Map.of("username", name, "password", password), false, new MockHttpServletResponse()));
    assertEquals(userId, auth.login(Map.of("username", name, "password", "synthetic-new-password"), false,
      new MockHttpServletResponse()).get("id"));
  }
}
