package com.projectprobe;

import static com.projectprobe.Store.*;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.*;
import org.springframework.stereotype.Service;

@Service
class AccountSecurity {
  final Store s; final Auth auth;
  AccountSecurity(Store s, Auth auth) { this.s = s; this.auth = auth; }
  void verify(String user, Map<String, Object> input) {
    String password = required(input, "password", 72);
    var row = s.one("SELECT password_hash FROM app_users WHERE id=?", user);
    if (!auth.encoder.matches(password, str(row, "password_hash"))) throw error(403, "当前密码不正确");
  }
  static String password(Map<String, Object> input) {
    String value = required(input, "newPassword", 72);
    if (value.length() < 10 || value.getBytes(StandardCharsets.UTF_8).length > 72) throw error(400, "新密码至少10字符，UTF-8最多72字节");
    return value;
  }
  Map<String, Object> recovery(String user, Map<String, Object> input) {
    return s.locked(user, () -> {
      verify(user, input); byte[] bytes = new byte[24]; new SecureRandom().nextBytes(bytes);
      String code = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
      s.db.update("DELETE FROM account_recovery WHERE user_id=?", user);
      s.db.update("INSERT INTO account_recovery VALUES (?,?,?)", user, Auth.hash(code), now());
      return Map.of("recoveryCode", code);
    });
  }
  Map<String, Object> recover(Map<String, Object> input) {
    String name = required(input, "username", 80).toLowerCase(Locale.ROOT);
    String code = required(input, "recoveryCode", 100), password = password(input);
    var users = s.db.queryForList("SELECT id FROM app_users WHERE username=?", name);
    if (users.isEmpty()) throw error(403, "用户名或恢复码不正确");
    return s.locked(str(users.get(0), "id"), () -> {
      String user = str(users.get(0), "id");
      var codes = s.db.queryForList("SELECT code_hash FROM account_recovery WHERE user_id=?", user);
      if (codes.isEmpty() || !java.security.MessageDigest.isEqual(Auth.hash(code).getBytes(StandardCharsets.UTF_8),
          str(codes.get(0), "code_hash").getBytes(StandardCharsets.UTF_8))) throw error(403, "用户名或恢复码不正确");
      s.db.update("UPDATE app_users SET password_hash=? WHERE id=?", auth.encoder.encode(password), user);
      s.db.update("DELETE FROM account_recovery WHERE user_id=?", user);
      s.db.update("DELETE FROM auth_sessions WHERE user_id=?", user);
      return Map.of("message", "密码已重置，恢复码已失效。请重新登录并生成新的恢复码。");
    });
  }
  Map<String, Object> change(String user, Map<String, Object> input) {
    String password = password(input);
    return s.locked(user, () -> {
      verify(user, input);
      s.db.update("UPDATE app_users SET password_hash=? WHERE id=?", auth.encoder.encode(password), user);
      s.db.update("DELETE FROM auth_sessions WHERE user_id=?", user);
      s.db.update("DELETE FROM account_recovery WHERE user_id=?", user);
      return Map.of("message", "密码已修改，所有设备已退出，请重新登录。");
    });
  }
}
