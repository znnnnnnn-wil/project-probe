package com.projectprobe;

import static com.projectprobe.Store.*;
import static org.junit.jupiter.api.Assertions.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(properties = {"spring.datasource.url=jdbc:h2:mem:support;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
  "app.model-mode=demo", "app.payment.mode=mock", "app.payment.reconcile-enabled=false"})
class TrainingSupportTest {
  @Autowired Store s;
  @Autowired ProjectService projects;
  @Autowired PaymentService payments;
  @Autowired TrainingService trainings;
  @Autowired TrainingSupport support;
  @Test void reviseKeepsQuestionIdentityHistoryAndQuotaAndDeduplicatesRequests() {
    var f = TrainingFixture.create(s, projects, payments, trainings);
    String id = str(f.training(), "id"), turn = str(list(f.training(), "turns").get(0), "id");
    var request = Map.<String, Object>of("turnId", turn, "kind", "CLARIFY", "requestKey", id());
    var revised = support.submit(f.user(), id, request);
    assertEquals(turn, list(revised, "turns").get(0).get("id"));
    assertEquals(1, list(revised, "turns").size());
    assertEquals(1, list(list(revised, "turns").get(0), "questionHistory").size());
    support.submit(f.user(), id, request);
    assertEquals(1, list(trainings.get(f.user(), id), "supportEvents").size());
    assertEquals(1, ((Number) payments.packages(f.user()).get(0).get("training_used")).intValue());
    assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> support.submit(id(), id, request));
    for (int i = 0; i < 2; i++) support.submit(f.user(), id, Map.of("turnId", turn, "kind", "CLARIFY", "requestKey", id()));
    assertThrows(org.springframework.web.server.ResponseStatusException.class, () ->
      support.submit(f.user(), id, Map.of("turnId", turn, "kind", "CLARIFY", "requestKey", id())));
    assertEquals(4, s.db.queryForObject("SELECT COUNT(*) FROM training_question_index WHERE training_id=?", Integer.class, id));
  }
}
