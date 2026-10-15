package com.projectprobe;

import static com.projectprobe.Store.*;
import static org.junit.jupiter.api.Assertions.*;

import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(properties = {
  "spring.datasource.url=${PROBE_TEST_DB_URL:jdbc:h2:mem:retest-selection;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1}",
  "spring.datasource.username=${PROBE_TEST_DB_USER:sa}", "spring.datasource.password=${PROBE_TEST_DB_PASSWORD:}",
  "app.model-mode=demo", "app.payment.mode=mock", "app.payment.reconcile-enabled=false"
})
class RetestSelectionTest {
  @Autowired Store s;
  @Autowired ProjectService projects;
  @Autowired TrainingService trainings;
  @Autowired PaymentService payments;

  @Test void selectedTopicsAndRepeatedRetestsKeepEntitlementsAndHistory() {
    String user = id();
    s.db.update("INSERT INTO app_users VALUES (?,?,?,?)", user, user, "unused", now());
    var project = projects.save(user, null, Map.of("name", "合成项目", "responsibility", "接口与测试"));
    String projectId = str(project, "id");
    project = projects.extract(user, projectId);
    projects.confirm(user, projectId, project);
    var order = payments.create(user, Map.of("requestKey", id()));
    payments.mock(user, str(order, "id"));
    var deep = trainings.start(user, Map.of("requestKey", id(), "projectId", projectId));
    String parent = str(deep, "id");
    var body = s.decode(trainings.row(user, parent).get("body"));
    list(body, "turns").get(0).put("answer", "合成回答");
    body.put("report", Map.of("findings", List.of(
      Map.of("topic", "并发约束", "assessment", "待解释", "task", "说明约束"),
      Map.of("topic", "测试证据", "assessment", "未验证", "task", "补充测试")),
      "retestTopics", List.of("并发约束", "测试证据")));
    trainings.update(parent, "COMPLETED", body);
    String key = id();
    var input = new LinkedHashMap<String, Object>(Map.of("requestKey", key, "projectId", projectId,
      "parentId", parent, "focus", "测试证据", "newRound", true,
      "exerciseMode", "QUICK", "difficulty", "BASIC"));
    var first = trainings.start(user, input);
    assertEquals("测试证据", first.get("focus"));
    assertEquals(2, first.get("maxTurns"));
    assertEquals("BASIC", first.get("difficulty"));
    assertEquals(first.get("id"), trainings.start(user, input).get("id"));
    input.put("requestKey", id());
    assertEquals(first.get("id"), trainings.start(user, input).get("id"));
    trainings.finish(user, str(first, "id"));
    var invalid = new LinkedHashMap<>(input);
    invalid.put("focus", "不属于报告的主题");
    assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> trainings.start(user, invalid));
    input.put("requestKey", id());
    input.put("focus", "并发约束");
    var second = trainings.start(user, input);
    assertNotEquals(first.get("id"), second.get("id"));
    assertEquals("并发约束", second.get("focus"));
    assertEquals(second.get("id"), trainings.retestEntry(user, trainings.row(user, parent)).get("trainingId"));
    assertEquals("COMPLETED", trainings.get(user, str(first, "id")).get("status"));
    var pack = payments.packages(user).get(0);
    assertEquals(3, ((Number) pack.get("training_used")).intValue());
  }
}
