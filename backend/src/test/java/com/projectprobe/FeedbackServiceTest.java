package com.projectprobe;
import static com.projectprobe.Store.*;
import static org.junit.jupiter.api.Assertions.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(properties = {"spring.datasource.url=${PROBE_TEST_DB_URL:jdbc:h2:mem:feedback;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1}",
  "spring.datasource.username=${PROBE_TEST_DB_USER:sa}", "spring.datasource.password=${PROBE_TEST_DB_PASSWORD:}",
  "app.model-mode=demo", "app.payment.mode=mock", "app.payment.reconcile-enabled=false"})
class FeedbackServiceTest {
  @Autowired Store s; @Autowired FeedbackService feedback; @Autowired UsageMetrics metrics;
  @Test void feedbackIsPrivateIdempotentAndRepliesRequireOperator() {
    String user = id(), other = id();
    s.db.update("INSERT INTO app_users VALUES (?,?,?,?)", user, user, "unused", now());
    s.db.update("INSERT INTO app_users VALUES (?,?,?,?)", other, other, "unused", now());
    var request = Map.<String,Object>of("kind", "GENERAL", "detail", "合成产品反馈", "requestKey", id());
    String id = str(feedback.submit(user, request, ""), "id");
    assertEquals(id, feedback.submit(user, request, "").get("id"));
    assertEquals(1, feedback.own(user).size()); assertEquals(0, feedback.own(other).size());
    assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> feedback.reply(other, id, Map.of("reply", "回复", "status", "RESOLVED")));
    metrics.operators = other;
    feedback.reply(other, id, Map.of("reply", "已核查，感谢反馈", "status", "RESOLVED"));
    assertEquals("RESOLVED", feedback.own(user).get(0).get("status"));
    assertEquals("已核查，感谢反馈", feedback.own(user).get(0).get("reply"));
  }
}
