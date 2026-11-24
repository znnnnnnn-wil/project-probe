package com.projectprobe;

import static com.projectprobe.Store.*;
import static org.junit.jupiter.api.Assertions.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockHttpServletResponse;

@SpringBootTest(properties = {"spring.datasource.url=${PROBE_TEST_DB_URL:jdbc:h2:mem:account-security;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1}",
  "spring.datasource.username=${PROBE_TEST_DB_USER:sa}", "spring.datasource.password=${PROBE_TEST_DB_PASSWORD:}",
  "app.model-mode=demo"})
class AccountSecurityTest {
  @Autowired Store s;
  @Autowired Auth auth;
  @Autowired AccountSecurity security;
  @Autowired UserData data;

  @Test void delayedLoginCannotRecreateSessionsAfterCredentialRevocation() throws Exception {
    for (String operation : List.of("change", "recover", "close")) {
      String name = "race-" + id(), password = "synthetic-old-password";
      String user = str(auth.login(Map.of("username", name, "password", password), true,
        new MockHttpServletResponse()), "id");
      String code = operation.equals("recover")
        ? str(security.recovery(user, Map.of("password", password)), "recoveryCode") : "";
      var verified = new CountDownLatch(1);
      var resume = new CountDownLatch(1);
      var paused = new Store(s.db, s.tx, s.json) {
        @Override <T> T locked(String owner, Supplier<T> work) {
          verified.countDown();
          try {
            if (!resume.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Login did not resume");
          } catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new IllegalStateException(e); }
          return super.locked(owner, work);
        }
      };
      var response = new MockHttpServletResponse();
      var executor = Executors.newSingleThreadExecutor();
      try {
        var login = executor.submit(() -> new Auth(paused, false).login(
          Map.of("username", name, "password", password), false, response));
        assertTrue(verified.await(10, TimeUnit.SECONDS));
        switch (operation) {
          case "change" -> security.change(user, Map.of("password", password, "newPassword", "synthetic-new-password"));
          case "recover" -> security.recover(Map.of("username", name, "recoveryCode", code, "newPassword", "synthetic-new-password"));
          default -> data.closeAccount(user, Map.of("password", password, "confirmation", "注销账户"));
        }
        resume.countDown();
        var failure = assertThrows(ExecutionException.class, () -> login.get(10, TimeUnit.SECONDS));
        var status = assertInstanceOf(org.springframework.web.server.ResponseStatusException.class, failure.getCause());
        assertEquals(401, status.getStatusCode().value());
        assertNull(response.getHeader("Set-Cookie"));
        assertEquals(0, s.db.queryForObject("SELECT COUNT(*) FROM auth_sessions WHERE user_id=?", Integer.class, user));
        if (!operation.equals("close")) assertEquals(user, auth.login(
          Map.of("username", name, "password", "synthetic-new-password"), false, new MockHttpServletResponse()).get("id"));
      } finally { resume.countDown(); executor.shutdownNow(); }
    }
  }
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
