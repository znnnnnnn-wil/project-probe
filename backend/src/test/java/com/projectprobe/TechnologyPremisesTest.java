package com.projectprobe;
import static org.junit.jupiter.api.Assertions.*;
import java.util.*;
import org.junit.jupiter.api.Test;

class TechnologyPremisesTest {
  Map<String, Object> body(String text) { return new LinkedHashMap<>(Map.of("project", Map.of("stack", "Java / Spring Boot", "implementation", text))); }
  @Test void negativesPlansAndLearningDoNotAuthorizeAssertions() {
    for (String text : List.of("没有使用Redis", "尚未接入 Redis", "计划引入Redis", "只学习过Redis", "没有使用Redis和Kafka")) {
      assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> TechnologyPremises.validate("请说明你使用的Redis如何失效。", body(text)), text);
    }
    assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> TechnologyPremises.validate("请说明你使用的Kafka消息确认方式。", body("没有使用Redis和Kafka")));
  }
  @Test void hypotheticalScopeDoesNotExcuseAnUnrelatedAssertedComponent() {
    TechnologyPremises.validate("假设使用Redis缓存，请说明你的Redis如何过期。", body("没有使用Redis"));
    assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> TechnologyPremises.validate("如果数据库超时，请说明你使用的Redis如何恢复。", body("没有使用Redis")));
  }
  @Test void openQuestionsAndLaterExplicitChangesAreAllowed() {
    var body = body("目前没有使用Redis");
    TechnologyPremises.validate("请说明是否考虑Redis。", body);
    TechnologyPremises.validate("请说明Repository实际访问数据库的方式。", body);
    body.put("turns", List.of(Map.of("answer", "后来已经改用Redis保存会话")));
    TechnologyPremises.validate("请说明你使用的Redis如何设置过期。", body);
    assertEquals(TechnologyPremises.State.USED, TechnologyPremises.state(body, "Redis"));
  }
  @Test void explicitNegationOverridesAStaleStackButInferenceDoesNotCount() {
    var body = new LinkedHashMap<String, Object>(Map.of("project", Map.of("stack", "Java / Redis", "implementation", "实际上未使用Redis", "facts", List.of(Map.of("text", "使用JPA")))));
    assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> TechnologyPremises.validate("请说明你的Redis缓存结构。", body));
    assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> TechnologyPremises.validate("请说明你使用的JPA事务。", body));
    for (String text : List.of("Redis尚未接入", "Redis实际没有使用", "Redis计划下一版接入")) {
      var stale = Map.<String,Object>of("project", Map.of("stack", "Java / Redis", "implementation", text));
      assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> TechnologyPremises.validate("请说明你的Redis缓存结构。", stale), text);
    }
  }
}
