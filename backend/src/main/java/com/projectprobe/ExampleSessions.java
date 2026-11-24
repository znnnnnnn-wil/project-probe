package com.projectprobe;

import static com.projectprobe.Store.*;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.security.SecureRandom;
import java.util.*;
import java.util.function.Function;
import org.springframework.http.ResponseCookie;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

@Component
class ExampleSessions {
  private static final String COOKIE = "probe_example";
  private static final long LIFETIME_SECONDS = 30 * 86400L;
  private static final SecureRandom RANDOM = new SecureRandom();

  private final Store store;
  private final Auth auth;
  private final UserData data;

  ExampleSessions(Store store, Auth auth, UserData data) {
    this.store = store;
    this.auth = auth;
    this.data = data;
  }

  String find(HttpServletRequest request) {
    if (request.getCookies() != null) for (var cookie : request.getCookies()) {
      String value = cookie.getValue();
      if (COOKIE.equals(cookie.getName()) && value != null && value.matches("[a-f0-9]{64}")) {
        var users = store.db.queryForList(
          "SELECT user_id FROM example_sessions WHERE token_hash=? AND expires_at>?",
          String.class, Auth.hash(value), now());
        if (!users.isEmpty()) return users.get(0);
      }
    }
    return null;
  }

  String require(HttpServletRequest request) {
    String user = find(request);
    if (user == null) throw error(404, "当前浏览器没有可用的示例练习，请从示例项目进入");
    return user;
  }

  <T> T open(HttpServletRequest request, HttpServletResponse response, Function<String, T> prepare) {
    String existing = find(request);
    if (existing != null) return prepare.apply(existing);

    String user = id();
    byte[] bytes = new byte[32];
    RANDOM.nextBytes(bytes);
    String token = HexFormat.of().formatHex(bytes);
    T result = store.tx.execute(transaction -> {
      long created = now();
      // 示例身份不能取得账户登录会话。
      store.db.update("INSERT INTO app_users VALUES (?,?,?,?)", user, "example-" + user, "!", created);
      store.db.update("INSERT INTO example_sessions VALUES (?,?,?)",
        Auth.hash(token), user, created + LIFETIME_SECONDS * 1000);
      return prepare.apply(user);
    });
    response.addHeader("Set-Cookie", ResponseCookie.from(COOKIE, token)
      .httpOnly(true).secure(auth.secure).sameSite("Strict")
      .path(request.getContextPath() + "/api/examples").maxAge(LIFETIME_SECONDS).build().toString());
    return result;
  }

  @Scheduled(fixedDelay = 3600000, initialDelay = 60000)
  void purgeExpired() {
    var expired = store.db.queryForList(
      "SELECT user_id FROM example_sessions WHERE expires_at<=? ORDER BY expires_at LIMIT 100",
      String.class, now());
    for (String user : expired) {
      try {
        store.locked(user, () -> {
          data.idle(user);
          for (String project : store.db.queryForList("SELECT id FROM projects WHERE user_id=?", String.class, user))
            data.eraseProject(user, project);
          store.db.update("DELETE FROM user_feedback WHERE user_id=?", user);
          store.db.update("DELETE FROM input_limits WHERE user_id=?", user);
          store.db.update("DELETE FROM journey_events WHERE user_id=?", user);
          store.db.update("DELETE FROM model_attempts WHERE user_id=?", user);
          store.db.update("DELETE FROM example_sessions WHERE user_id=?", user);
          store.db.update("DELETE FROM app_users WHERE id=?", user);
          return null;
        });
      } catch (ResponseStatusException cause) {
        // 下一轮清理仍在生成的记录；其他实例也可能已清理当前访客。
        if (cause.getStatusCode().value() != 409 && cause.getStatusCode().value() != 404) throw cause;
      }
    }
  }
}
