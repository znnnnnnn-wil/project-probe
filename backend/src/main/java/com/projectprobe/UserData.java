package com.projectprobe;

import static com.projectprobe.Store.*;
import java.util.*;
import org.springframework.stereotype.Service;

@Service
class UserData {
  final Store s; final AccountSecurity security; final ProjectService projects;
  UserData(Store s, AccountSecurity security, ProjectService projects) { this.s = s; this.security = security; this.projects = projects; }
  void idle(String user) {
    int active = s.db.queryForObject("SELECT COUNT(*) FROM trainings WHERE user_id=? AND status='GENERATING'", Integer.class, user);
    active += s.db.queryForObject("SELECT COUNT(*) FROM project_trials WHERE user_id=? AND status='GENERATING'", Integer.class, user);
    active += s.db.queryForObject("SELECT COUNT(*) FROM input_limits WHERE user_id=? AND lease_until>?", Integer.class, user, now());
    active += s.db.queryForObject("SELECT COUNT(*) FROM extraction_limits WHERE user_id=? AND lease_until>?", Integer.class, user, now());
    if (active > 0) throw error(409, "仍有生成或导入任务，请等待完成或恢复后再清理");
  }
  void eraseProject(String user, String projectId) {
    projects.get(user, projectId);
    s.db.update("UPDATE project_trials SET body='{}',status='CLEARED',lease_token=NULL,lease_until=0 WHERE user_id=? AND project_id=?", user, projectId);
    s.db.update("DELETE FROM answer_drafts WHERE training_id IN (SELECT id FROM trainings WHERE user_id=? AND project_id=?)", user, projectId);
    s.db.update("DELETE FROM training_question_index WHERE user_id=? AND project_id=?", user, projectId);
    s.db.update("DELETE FROM trainings WHERE user_id=? AND project_id=?", user, projectId);
    s.db.update("DELETE FROM project_revisions WHERE project_id=?", projectId);
    s.db.update("DELETE FROM projects WHERE id=? AND user_id=?", projectId, user);
  }
  Map<String, Object> removeProject(String user, String projectId, Map<String, Object> input) {
    return s.locked(user, () -> {
      security.verify(user, input); idle(user);
      var project = projects.get(user, projectId);
      if (!str(project, "name").equals(str(input, "confirmation"))) throw error(400, "请输入完整项目名称确认删除");
      eraseProject(user, projectId);
      return Map.of("message", "项目材料、修订、问答、报告和草稿已删除；订单与权益流水保留，不返还已用次数。");
    });
  }
  Map<String, Object> clearCache(String user) {
    return s.locked(user, () -> {
      idle(user); s.db.update("DELETE FROM resume_import_cache WHERE user_id=?", user);
      return Map.of("message", "简历识别缓存已清空；已保存为项目的内容需单独删除。");
    });
  }
  Map<String, Object> closeAccount(String user, Map<String, Object> input) {
    return s.locked(user, () -> {
      security.verify(user, input); idle(user);
      if (!"注销账户".equals(str(input, "confirmation"))) throw error(400, "请输入注销账户确认");
      for (var row : s.db.queryForList("SELECT id FROM projects WHERE user_id=?", user)) eraseProject(user, str(row, "id"));
      s.db.update("DELETE FROM resume_import_cache WHERE user_id=?", user);
      s.db.update("DELETE FROM account_recovery WHERE user_id=?", user);
      s.db.update("DELETE FROM auth_sessions WHERE user_id=?", user);
      s.db.update("UPDATE app_users SET username=?,password_hash=? WHERE id=?", "closed-" + id(), security.auth.encoder.encode(id()), user);
      return Map.of("message", "账户已注销，个人训练内容已清除；交易和权益账务记录保留，备份副本需由运营者按保留策略清理。");
    });
  }
}
