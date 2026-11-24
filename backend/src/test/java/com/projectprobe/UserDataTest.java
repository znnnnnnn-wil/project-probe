package com.projectprobe;

import static com.projectprobe.Store.*;
import static org.junit.jupiter.api.Assertions.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.web.server.ResponseStatusException;

@SpringBootTest(properties = {"spring.datasource.url=${PROBE_TEST_DB_URL:jdbc:h2:mem:user-data;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1}",
  "spring.datasource.username=${PROBE_TEST_DB_USER:sa}", "spring.datasource.password=${PROBE_TEST_DB_PASSWORD:}",
  "app.model-mode=demo", "app.practice-max-turns=1"})
class UserDataTest {
  @Autowired Store s;
  @Autowired Auth auth;
  @Autowired ProjectService projects;
  @Autowired TrainingService trainings;
  @Autowired UserData data;
  @Autowired ProjectPractice practice;
  @Test void deletionRequiresPasswordAndConfirmation() {
    var f = TrainingFixture.create(s, projects, trainings);
    String password = "synthetic-delete-password";
    s.db.update("UPDATE app_users SET password_hash=? WHERE id=?", auth.encoder.encode(password), f.user());
    assertThrows(org.springframework.web.server.ResponseStatusException.class, () ->
      data.removeProject(f.user(), f.project(), Map.of("password", password, "confirmation", "错误名称")));
    assertThrows(org.springframework.web.server.ResponseStatusException.class, () ->
      data.removeProject(f.user(), f.project(), Map.of("password", "wrong-password", "confirmation", "合成项目")));
    data.removeProject(f.user(), f.project(), Map.of("password", password, "confirmation", "合成项目"));
    assertEquals(0, s.db.queryForObject("SELECT COUNT(*) FROM projects WHERE user_id=?", Integer.class, f.user()));
    assertEquals(0, s.db.queryForObject("SELECT COUNT(*) FROM trainings WHERE user_id=?", Integer.class, f.user()));
    data.closeAccount(f.user(), Map.of("password", password, "confirmation", "注销账户"));
    assertTrue(str(s.one("SELECT username FROM app_users WHERE id=?", f.user()), "username").startsWith("closed-"));
  }

  @Test void anotherAccountCannotDeleteAProjectEvenWithItsFullName() {
    var owner = TrainingFixture.create(s, projects, trainings);
    var caller = TrainingFixture.create(s, projects, trainings);
    addPracticeAndRelatedRecords(owner);
    addPracticeAndRelatedRecords(caller);
    String password = "synthetic-caller-password";
    s.db.update("UPDATE app_users SET password_hash=? WHERE id=?", auth.encoder.encode(password), caller.user());
    var ownerBefore = projectRecords(owner);
    var callerBefore = projectRecords(caller);

    // Supply the caller's valid password so rejection must come from project ownership.
    var error = assertThrows(ResponseStatusException.class, () ->
      data.removeProject(caller.user(), owner.project(), Map.of("password", password, "confirmation", "合成项目")));
    assertEquals(404, error.getStatusCode().value());
    assertEquals(ownerBefore, projectRecords(owner));
    assertEquals(callerBefore, projectRecords(caller));
  }

  @Test void deletionWaitsForPracticeLeaseThenOnlyErasesTheTargetProject() {
    var target = TrainingFixture.create(s, projects, trainings);
    String siblingProject = str(projects.save(target.user(), null, Map.of("name", "合成项目", "responsibility", "独立测试")), "id");
    var extracted = projects.extract(target.user(), siblingProject);
    projects.confirm(target.user(), siblingProject, extracted);
    var sibling = new TrainingFixture.Fixture(target.user(), siblingProject,
      trainings.start(target.user(), Map.of("projectId", siblingProject, "requestKey", id())));
    var otherUser = TrainingFixture.create(s, projects, trainings);
    for (var fixture : List.of(target, sibling, otherUser)) addPracticeAndRelatedRecords(fixture);
    String password = "synthetic-delete-password";
    s.db.update("UPDATE app_users SET password_hash=? WHERE id=?", auth.encoder.encode(password), target.user());
    var input = Map.<String, Object>of("password", password, "confirmation", "合成项目");
    String round = str(practice.get(target.user(), target.project()), "roundId");
    assertEquals(1, s.db.update("UPDATE project_practice_rounds SET status='GENERATING',lease_until=?,lease_token=? WHERE user_id=? AND round_id=?",
      now() + 60000, id(), target.user(), round));
    var targetBefore = projectRecords(target);
    var siblingBefore = projectRecords(sibling);
    var otherBefore = projectRecords(otherUser);

    var error = assertThrows(ResponseStatusException.class, () -> data.removeProject(target.user(), target.project(), input));
    assertEquals(409, error.getStatusCode().value());
    assertEquals(targetBefore, projectRecords(target));
    assertEquals(siblingBefore, projectRecords(sibling));
    assertEquals(otherBefore, projectRecords(otherUser));

    assertEquals(1, s.db.update("UPDATE project_practice_rounds SET status='ACTIVE',lease_until=0,lease_token=NULL WHERE user_id=? AND round_id=?",
      target.user(), round));
    data.removeProject(target.user(), target.project(), input);
    projectRecords(target).forEach((table, rows) -> assertTrue(rows.isEmpty(), table + " must be cleared"));
    assertEquals(siblingBefore, projectRecords(sibling));
    assertEquals(otherBefore, projectRecords(otherUser));
  }

  private void addPracticeAndRelatedRecords(TrainingFixture.Fixture f) {
    practice.run(f.user(), f.project(), Map.of());
    var completed = practice.run(f.user(), f.project(), Map.of("answer", "我负责接口测试，用唯一约束验证重复请求。"));
    assertEquals("COMPLETED", completed.get("status"));
    assertTrue(completed.containsKey("report"));
    var active = practice.run(f.user(), f.project(), Map.of("restart", true, "roundId", completed.get("roundId")));
    assertEquals("ACTIVE", active.get("status"));
    String training = str(f.training(), "id");
    String turn = str(list(f.training(), "turns").get(0), "id");
    s.db.update("INSERT INTO answer_drafts(training_id,turn_id,body,version,updated_at) VALUES (?,?,?,?,?)",
      training, turn, s.encode(Map.of("answer", "保留的草稿")), 1, now());
    s.db.update("INSERT INTO report_views(user_id,training_id,viewed_at) VALUES (?,?,?)", f.user(), training, now());
    s.db.update("INSERT INTO user_feedback(id,user_id,request_key,kind,body,training_id,status,reply,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      id(), f.user(), id(), "BUG", "合成反馈", training, "OPEN", "", now());
    projectRecords(f).forEach((table, rows) -> assertFalse(rows.isEmpty(), table + " must be seeded"));
    assertEquals(2, projectRecords(f).get("project_practice_rounds").size());
  }

  private Map<String, List<Map<String, Object>>> projectRecords(TrainingFixture.Fixture f) {
    String training = str(f.training(), "id");
    // Query dependent records directly, not through parents that deletion could hide.
    return Map.of(
      "projects", s.db.queryForList("SELECT * FROM projects WHERE id=? AND user_id=?", f.project(), f.user()),
      "project_revisions", s.db.queryForList("SELECT * FROM project_revisions WHERE project_id=? ORDER BY version", f.project()),
      "project_practice_rounds", s.db.queryForList("SELECT * FROM project_practice_rounds WHERE user_id=? AND project_id=? ORDER BY round_number", f.user(), f.project()),
      "trainings", s.db.queryForList("SELECT * FROM trainings WHERE user_id=? AND project_id=? ORDER BY id", f.user(), f.project()),
      "training_question_index", s.db.queryForList("SELECT * FROM training_question_index WHERE user_id=? AND project_id=? ORDER BY turn_id", f.user(), f.project()),
      "answer_drafts", s.db.queryForList("SELECT * FROM answer_drafts WHERE training_id=?", training),
      "report_views", s.db.queryForList("SELECT * FROM report_views WHERE training_id=? ORDER BY user_id", training),
      "user_feedback", s.db.queryForList("SELECT * FROM user_feedback WHERE training_id=? ORDER BY id", training),
      "journey_events", s.db.queryForList("SELECT * FROM journey_events WHERE user_id=? AND subject_id IN (?,?) ORDER BY payment_mode,event,subject_id", f.user(), f.project(), training)
    );
  }
}
