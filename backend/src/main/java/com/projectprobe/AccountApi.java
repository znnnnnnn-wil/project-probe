package com.projectprobe;

import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
class AccountApi {
  final Auth auth; final AccountSecurity security;
  AccountApi(Auth auth, AccountSecurity security) { this.auth = auth; this.security = security; }
  @PostMapping("/account/recovery")
  Object recovery(HttpServletRequest r, @RequestBody Map<String, Object> input) { return security.recovery(auth.user(r), input); }
  @PostMapping("/auth/recover")
  Object recover(@RequestBody Map<String, Object> input) { return security.recover(input); }
  @PostMapping("/account/password")
  Object password(HttpServletRequest r, @RequestBody Map<String, Object> input) { return security.change(auth.user(r), input); }
}
