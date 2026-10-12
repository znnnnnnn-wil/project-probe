package com.projectprobe;

import static com.projectprobe.Store.*;

import jakarta.servlet.http.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseCookie;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Component;

@Component
public class Auth {

  final Store s;
  final boolean secure;
  final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder(12);

  Auth(Store s, @Value("${app.secure-cookie}") boolean secure) {
    this.s = s;
    this.secure = secure;
  }

  static String hash(String text) {
    try {
      return HexFormat.of().formatHex(
        MessageDigest.getInstance("SHA-256").digest(
          text.getBytes(StandardCharsets.UTF_8)
        )
      );
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  String token(HttpServletRequest req) {
    if (req.getCookies() != null) for (var c : req.getCookies())
      if (c.getName().equals("probe_session")) return c.getValue();
    return "";
  }

  String user(HttpServletRequest req) {
    var rows = s.db.queryForList(
      "SELECT user_id FROM auth_sessions WHERE token_hash=? AND expires_at>?",
      hash(token(req)),
      now()
    );
    if (rows.isEmpty()) throw error(401, "请先登录");
    return str(rows.get(0), "user_id");
  }

  Map<String, Object> login(
    Map<String, Object> input,
    boolean register,
    HttpServletResponse res
  ) {
    String name = required(input, "username", 80).toLowerCase(Locale.ROOT),
      password = required(input, "password", 72);
    if (
      password.length() < 10 ||
      password.getBytes(StandardCharsets.UTF_8).length > 72
    ) throw error(400, "密码需至少 10 个字符，且 UTF-8 长度不超过 72 字节");
    if (register) {
      try {
        s.db.update(
          "INSERT INTO app_users VALUES (?,?,?,?)",
          id(),
          name,
          encoder.encode(password),
          now()
        );
      } catch (org.springframework.dao.DuplicateKeyException e) {
        throw error(409, "用户名已存在");
      }
    }
    var rows = s.db.queryForList(
      "SELECT * FROM app_users WHERE username=?",
      name
    );
    if (
      rows.isEmpty() ||
      !encoder.matches(password, str(rows.get(0), "password_hash"))
    ) throw error(401, "用户名或密码错误");
    String user = str(rows.get(0), "id");
    byte[] bytes = new byte[32];
    new SecureRandom().nextBytes(bytes);
    String token = HexFormat.of().formatHex(bytes);
    s.db.update(
      "INSERT INTO auth_sessions VALUES (?,?,?)",
      hash(token),
      user,
      now() + 7 * 86400000L
    );
    cookie(res, token, 7 * 86400);
    return Map.of("id", user, "username", name);
  }

  void cookie(HttpServletResponse res, String value, long age) {
    res.addHeader(
      "Set-Cookie",
      ResponseCookie.from("probe_session", value)
        .httpOnly(true)
        .secure(secure)
        .sameSite("Strict")
        .path("/")
        .maxAge(age)
        .build()
        .toString()
    );
  }

  void logout(HttpServletRequest req, HttpServletResponse res) {
    s.db.update(
      "DELETE FROM auth_sessions WHERE token_hash=?",
      hash(token(req))
    );
    cookie(res, "", 0);
  }
}
