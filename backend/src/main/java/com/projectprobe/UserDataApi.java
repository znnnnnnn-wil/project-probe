package com.projectprobe;

import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
class UserDataApi {
  final Auth auth; final UserData data;
  UserDataApi(Auth auth, UserData data) { this.auth = auth; this.data = data; }
  @DeleteMapping("/projects/{id}")
  Object project(HttpServletRequest r, @PathVariable String id, @RequestBody Map<String, Object> input) { return data.removeProject(auth.user(r), id, input); }
  @DeleteMapping("/account/resume-cache")
  Object cache(HttpServletRequest r) { return data.clearCache(auth.user(r)); }
  @DeleteMapping("/account")
  Object account(HttpServletRequest r, @RequestBody Map<String, Object> input) { return data.closeAccount(auth.user(r), input); }
}
