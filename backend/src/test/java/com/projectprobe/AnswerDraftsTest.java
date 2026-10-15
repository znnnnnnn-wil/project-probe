package com.projectprobe;

import static com.projectprobe.Store.*;
import static org.junit.jupiter.api.Assertions.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(properties = {"spring.datasource.url=${PROBE_TEST_DB_URL:jdbc:h2:mem:drafts;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1}",
  "spring.datasource.username=${PROBE_TEST_DB_USER:sa}", "spring.datasource.password=${PROBE_TEST_DB_PASSWORD:}",
  "app.model-mode=demo", "app.payment.mode=mock", "app.payment.reconcile-enabled=false"})
class AnswerDraftsTest {
  @Autowired Store s;
  @Autowired ProjectService projects;
  @Autowired PaymentService payments;
  @Autowired TrainingService trainings;
  @Autowired AnswerDrafts drafts;
  @Test void draftsArePrivateVersionedAndNotUsedAsSubmittedEvidence() {
    var f = TrainingFixture.create(s, projects, payments, trainings);
    String training = str(f.training(), "id"), turn = str(list(f.training(), "turns").get(0), "id");
    var input = Map.<String, Object>of("turnId", turn, "answer", "尚未提交的私人草稿", "version", 0);
    assertEquals(1, drafts.save(f.user(), training, input).get("version"));
    assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> drafts.save(f.user(), training, input));
    assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> drafts.read(id(), training));
    assertFalse(trainings.get(f.user(), training).toString().contains("私人草稿"));
    trainings.answer(f.user(), training, Map.of("turnId", turn, "answer", "已提交的合成回答"));
    assertEquals(0, s.db.queryForObject("SELECT COUNT(*) FROM answer_drafts WHERE training_id=?", Integer.class, training));
    assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> drafts.save(f.user(), training, input));
  }
}
