package com.projectprobe;

import static com.projectprobe.Store.*;
import static org.junit.jupiter.api.Assertions.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(properties = {"spring.datasource.url=${PROBE_TEST_DB_URL:jdbc:h2:mem:support;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1}",
  "spring.datasource.username=${PROBE_TEST_DB_USER:sa}", "spring.datasource.password=${PROBE_TEST_DB_PASSWORD:}",
  "app.model-mode=demo"})
class TrainingSupportTest {
  @Autowired Store s;
  @Autowired ProjectService projects;
  @Autowired TrainingService trainings;
  @Autowired TrainingSupport support;
  @Autowired AnswerDrafts drafts;
  @Test void reviseKeepsQuestionIdentityHistoryAndQuotaAndDeduplicatesRequests() {
    var f = TrainingFixture.create(s, projects, trainings);
    String id = str(f.training(), "id"), turn = str(list(f.training(), "turns").get(0), "id");
    var request = Map.<String, Object>of("turnId", turn, "kind", "CLARIFY", "requestKey", id());
    var revised = support.submit(f.user(), id, request);
    assertEquals(turn, list(revised, "turns").get(0).get("id"));
    assertEquals(1, list(revised, "turns").size());
    assertEquals(1, list(list(revised, "turns").get(0), "questionHistory").size());
    support.submit(f.user(), id, request);
    assertEquals(1, list(trainings.get(f.user(), id), "supportEvents").size());
    assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> support.submit(id(), id, request));
    for (int i = 1; i <= 2; i++) support.submit(f.user(), id, Map.of("turnId", turn, "questionVersion", i, "kind", "CLARIFY", "requestKey", id()));
    assertThrows(org.springframework.web.server.ResponseStatusException.class, () ->
      support.submit(f.user(), id, Map.of("turnId", turn, "questionVersion", 3, "kind", "CLARIFY", "requestKey", id())));
    assertEquals(4, s.db.queryForObject("SELECT COUNT(*) FROM training_question_index WHERE training_id=?", Integer.class, id));
  }

  @Test void revisionRejectsStaleAnswersDraftsAndSupportButPreservesDraftForReview() {
    var f = TrainingFixture.create(s, projects, trainings);
    String id = str(f.training(), "id"), turn = str(list(f.training(), "turns").get(0), "id");
    drafts.save(f.user(), id, Map.of("turnId", turn, "answer", "原题草稿", "version", 0));
    var revised = support.submit(f.user(), id, Map.of("turnId", turn, "kind", "CORRECT", "detail", "请修正题目前提", "requestKey", id()));
    assertEquals(1, list(revised, "turns").get(0).get("questionVersion"));
    assertEquals("原题草稿", drafts.read(f.user(), id).get("answer"));
    var stale = assertThrows(org.springframework.web.server.ResponseStatusException.class, () ->
      trainings.answer(f.user(), id, Map.of("turnId", turn, "answer", "来自旧页面的回答")));
    assertEquals(409, stale.getStatusCode().value());
    assertEquals("", list(trainings.get(f.user(), id), "turns").get(0).get("answer"));
    assertEquals(409, assertThrows(org.springframework.web.server.ResponseStatusException.class, () ->
      drafts.save(f.user(), id, Map.of("turnId", turn, "answer", "旧页面覆盖", "version", 1))).getStatusCode().value());
    assertEquals(409, assertThrows(org.springframework.web.server.ResponseStatusException.class, () ->
      support.submit(f.user(), id, Map.of("turnId", turn, "kind", "CLARIFY", "requestKey", id()))).getStatusCode().value());
    assertEquals("原题草稿", drafts.read(f.user(), id).get("answer"));
    drafts.save(f.user(), id, Map.of("turnId", turn, "questionVersion", 1, "answer", "已核对新题", "version", 1));
    var answered = trainings.answer(f.user(), id, Map.of("turnId", turn, "questionVersion", 1, "answer", "已核对新题"));
    assertEquals("已核对新题", list(answered, "turns").get(0).get("answer"));
  }

  @Test void legacyRevisionsExposeVersionAndRejectUnversionedAnswer() {
    var f = TrainingFixture.create(s, projects, trainings);
    String id = str(f.training(), "id"), turn = str(list(f.training(), "turns").get(0), "id");
    support.submit(f.user(), id, Map.of("turnId", turn, "kind", "CLARIFY", "requestKey", id()));
    var body = s.decode(trainings.row(f.user(), id).get("body"));
    list(body, "turns").get(0).remove("questionVersion");
    trainings.update(id, "ACTIVE", body);
    assertEquals(1, list(trainings.get(f.user(), id), "turns").get(0).get("questionVersion"));
    assertEquals(409, assertThrows(org.springframework.web.server.ResponseStatusException.class, () ->
      trainings.answer(f.user(), id, Map.of("turnId", turn, "answer", "旧客户端回答"))).getStatusCode().value());
    assertDoesNotThrow(() -> trainings.answer(f.user(), id, Map.of("turnId", turn, "questionVersion", 1, "answer", "已核对新题")));
  }
}
