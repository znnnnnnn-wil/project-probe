package com.projectprobe;
import static com.projectprobe.Store.*;
import static org.junit.jupiter.api.Assertions.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.web.server.ResponseStatusException;

@SpringBootTest(properties = {"spring.datasource.url=${PROBE_TEST_DB_URL:jdbc:h2:mem:practice;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1}",
  "spring.datasource.username=${PROBE_TEST_DB_USER:sa}", "spring.datasource.password=${PROBE_TEST_DB_PASSWORD:}",
  "app.model-mode=demo", "app.practice-max-turns=1"})
class ProjectPracticeTest {
  @Autowired Store s; @Autowired ProjectService projects; @Autowired ProjectPractice practice;
  @Test void projectsHaveIndependentRoundsAndKeepPastReports() {
    String user = id(); s.db.update("INSERT INTO app_users VALUES (?,?,?,?)", user, user, "unused", now());
    var p = projects.save(user, null, Map.of("name", "合成预约项目", "responsibility", "接口实现"));
    String project = str(p, "id");
    var first = practice.run(user, project, Map.of());
    assertEquals("ACTIVE", first.get("status"));
    assertEquals(first, practice.run(user, project, Map.of()));
    var complete = practice.run(user, project, Map.of("answer", "我在数据库约束中防止重复预约。"));
    assertEquals("COMPLETED", complete.get("status"));
    assertTrue(complete.containsKey("report"));
    assertFalse(PracticeRetest.object(complete.get("report")).containsKey("scoring"));
    assertEquals(complete, practice.run(user, project, Map.of()));
    var another = projects.save(user, null, Map.of("name", "另一项目", "responsibility", "测试"));
    String anotherProject = str(another, "id");
    assertEquals("AVAILABLE", practice.get(user, anotherProject).get("status"));
    var activeOtherProject = practice.run(user, anotherProject, Map.of());
    assertEquals("ACTIVE", activeOtherProject.get("status"));
    assertEquals(complete, practice.get(user, project));
    String oldRoundId = str(complete, "roundId");
    var restart = Map.<String, Object>of("restart", true, "roundId", oldRoundId);
    var next = practice.run(user, project, restart);
    assertEquals("ACTIVE", next.get("status"));
    assertEquals(2L, next.get("roundNumber"));
    assertNotEquals(oldRoundId, next.get("roundId"));
    assertEquals(complete, practice.get(user, project, oldRoundId));
    assertEquals(activeOtherProject, practice.get(user, anotherProject));
    assertEquals(3, practice.history(user).size());
    String oldTurnId = str(list(complete, "turns").get(0), "id");
    String nextTurnId = str(list(next, "turns").get(0), "id");
    assertThrows(ResponseStatusException.class, () -> practice.requireUnansweredTurn(user, project, oldTurnId, 0));
    assertThrows(ResponseStatusException.class, () -> practice.run(user, project, Map.of("turnId", oldTurnId, "answer", "上一轮的迟到发言")));
    assertEquals(nextTurnId, practice.requireUnansweredTurn(user, project, nextTurnId, 0).get("id"));
    assertThrows(ResponseStatusException.class, () -> practice.run(user, project, restart));
    assertThrows(ResponseStatusException.class, () -> practice.get(user, anotherProject, oldRoundId));
    assertThrows(ResponseStatusException.class, () -> practice.get(id(), project));
    assertEquals(0, s.db.queryForObject("SELECT COUNT(*) FROM trainings WHERE user_id=?", Integer.class, user));
  }

  @Test void cancellingStartsAFreshRoundWithoutChangingReportsOrOtherProjects() {
    String user = id(); s.db.update("INSERT INTO app_users VALUES (?,?,?,?)", user, user, "unused", now());
    String project = str(projects.save(user, null, Map.of("name", "取消面试项目")), "id");
    practice.run(user, project, Map.of());
    var completed = practice.run(user, project, Map.of("answer", "我负责数据库唯一约束。"));
    String completedId = str(completed, "roundId");
    var active = practice.run(user, project, Map.of("restart", true, "roundId", completedId));
    String cancelledId = str(active, "roundId");
    String otherProject = str(projects.save(user, null, Map.of("name", "另一个项目")), "id");
    var other = practice.run(user, otherProject, Map.of());
    assertThrows(ResponseStatusException.class, () -> practice.cancel(id(), project, cancelledId));
    assertThrows(ResponseStatusException.class, () -> practice.cancel(user, otherProject, cancelledId));
    assertThrows(ResponseStatusException.class, () -> practice.cancel(user, project, completedId));
    assertEquals(active, practice.get(user, project));

    var available = practice.cancel(user, project, cancelledId);
    assertEquals("AVAILABLE", available.get("status"));
    assertFalse(available.containsKey("roundId"));
    assertFalse(available.containsKey("turns"));
    assertEquals(available, practice.cancel(user, project, cancelledId));
    assertEquals(completed, practice.get(user, project, completedId));
    assertEquals(other, practice.get(user, otherProject));
    assertEquals(2, practice.history(user).size());
    assertThrows(ResponseStatusException.class, () -> practice.get(user, project, cancelledId));
    String oldTurn = str(list(active, "turns").get(0), "id");
    assertThrows(ResponseStatusException.class, () -> practice.requireUnansweredTurn(user, project, oldTurn, 0));
    assertThrows(ResponseStatusException.class, () -> practice.run(user, project, Map.of("turnId", oldTurn, "answer", "迟到的回答")));

    var next = practice.run(user, project, Map.of("topic", "新的面试主题"));
    assertEquals(3L, next.get("roundNumber"));
    assertNotEquals(cancelledId, next.get("roundId"));
    assertNotEquals(oldTurn, list(next, "turns").get(0).get("id"));
    assertEquals(1, list(next, "turns").size());
    assertEquals("", list(next, "turns").get(0).get("answer"));
    assertEquals(next, practice.cancel(user, project, cancelledId));
    assertEquals(next, practice.get(user, project));
  }

  @Test void cancellationInvalidatesInFlightGenerationAndAllowsFailedRoundsToEnd() {
    String user = id(); s.db.update("INSERT INTO app_users VALUES (?,?,?,?)", user, user, "unused", now());
    String project = str(projects.save(user, null, Map.of("name", "生成期间取消")), "id");
    var lateModel = new ModelService(s, "demo", "https://never-called.invalid", "synthetic", "synthetic", "test") {
      @Override GeneratedQuestion firstDeepQuestion(Map<String, Object> body) {
        var generating = practice.get(user, project);
        assertEquals("GENERATING", generating.get("status"));
        practice.cancel(user, project, str(generating, "roundId"));
        return new GeneratedQuestion("不应恢复的旧题目", "职责边界");
      }
    };
    var inFlight = new ProjectPractice(s, projects, lateModel);
    inFlight.maxTurns = 1; inFlight.journey = practice.journey;
    assertThrows(ResponseStatusException.class, () -> inFlight.run(user, project, Map.of()));
    assertEquals("AVAILABLE", practice.get(user, project).get("status"));
    assertTrue(practice.history(user).isEmpty());
    var cancelled = s.one("SELECT status,lease_until,lease_token FROM project_practice_rounds WHERE user_id=? AND project_id=?", user, project);
    assertEquals("CANCELLED", cancelled.get("status"));
    assertEquals(0L, cancelled.get("lease_until"));
    assertNull(cancelled.get("lease_token"));
    var next = practice.run(user, project, Map.of());
    assertEquals(2L, next.get("roundNumber"));
    s.db.update("UPDATE project_practice_rounds SET status='FAILED' WHERE user_id=? AND round_id=?", user, next.get("roundId"));
    assertEquals("AVAILABLE", practice.cancel(user, project, str(next, "roundId")).get("status"));
  }

  @Test void scoresUseOnlyAnsweredEvidenceAndAreSavedWithThePractice() {
    String user = id();
    s.db.update("INSERT INTO app_users VALUES (?,?,?,?)", user, user, "unused", now());
    String project = str(projects.save(user, null, Map.of("name", "合成评分项目")), "id");
    var scores = new ArrayList<>(List.of(
      Map.of("key", "clarity", "level", 4, "reason", "直接回答了职责。", "turnIds", List.of("T1"), "evidenceQuote", "我负责测试"),
      Map.of("key", "ownership", "level", 4, "reason", "区分了自己的职责。", "turnIds", List.of("T1"), "evidenceQuote", "我负责测试"),
      Map.of("key", "depth", "level", 3, "reason", "解释了部分实现。", "turnIds", List.of("T1"), "evidenceQuote", "我负责测试"),
      Map.of("key", "validation", "level", 5, "reason", "给出了具体测试。", "turnIds", List.of("T1"), "evidenceQuote", "我负责测试")
    ));
    var model = new ModelService(s, "live", "https://never-called.invalid", "synthetic", "synthetic", "test") {
      @Override GeneratedQuestion firstDeepQuestion(Map<String, Object> body) {
        return new GeneratedQuestion("你负责哪部分？", "职责边界");
      }

      @Override Map<String, Object> call(String rule, Object input) {
        assertTrue(rule.contains("practiceScores"));
        return new LinkedHashMap<>(Map.of(
          "clearParts", List.of("说清了个人职责。"),
          "findings", List.of(new LinkedHashMap<>(Map.of("topic", "验证", "assessment", "没说清用例。", "task", "补充测试输入和预期结果。", "turnIds", List.of("T1"), "factIds", List.of()))),
          "retestTopics", List.of("验证"),
          "practiceScores", scores
        ));
      }
    };
    var livePractice = new ProjectPractice(s, projects, model);
    livePractice.maxTurns = 1;
    livePractice.journey = practice.journey;
    var first = livePractice.run(user, project, Map.of("topic", "测试用例"));
    String firstRound = str(first, "roundId");
    var legacy = s.decode(s.one("SELECT body FROM project_practice_rounds WHERE user_id=? AND round_id=?", user, firstRound).get("body"));
    legacy.put("kind", "TRIAL");
    s.db.update("UPDATE project_practice_rounds SET body=? WHERE user_id=? AND round_id=?", s.encode(legacy), user, firstRound);
    var completed = livePractice.run(user, project, Map.of("answer", "我负责测试"));
    var scoring = PracticeRetest.object(PracticeRetest.object(completed.get("report")).get("scoring"));
    assertEquals(80, scoring.get("total"));
    assertEquals(List.of(str(list(first, "turns").get(0), "id")), list(scoring, "dimensions").get(0).get("turnIds"));

    var summary = livePractice.history(user).get(0);
    assertEquals(Boolean.TRUE, summary.get("hasScoring"));
    assertEquals(80, summary.get("totalScore"));
    assertEquals("测试用例", summary.get("interviewTopic"));
    assertEquals("补充测试输入和预期结果。", summary.get("prioritySuggestion"));
    assertTrue(((Number) summary.get("startedAt")).longValue() > 0);

    scores.set(0, Map.of("key", "clarity", "level", 5, "reason", "引用了不存在的题目。", "turnIds", List.of("T2"), "evidenceQuote", "我负责测试"));
    scores.set(1, Map.of("key", "ownership", "level", 5, "reason", "引用了不存在的原文。", "turnIds", List.of("T1"), "evidenceQuote", "我负责开发"));
    livePractice.run(user, project, Map.of("restart", true, "roundId", str(completed, "roundId")));
    var second = livePractice.run(user, project, Map.of("answer", "我负责测试"));
    assertEquals("COMPLETED", second.get("status"));
    var secondScoring = PracticeRetest.object(PracticeRetest.object(second.get("report")).get("scoring"));
    assertEquals(80, secondScoring.get("total"));
    assertNull(list(secondScoring, "dimensions").get(0).get("score"));
    assertNull(list(secondScoring, "dimensions").get(1).get("score"));
    assertEquals(15, list(secondScoring, "dimensions").get(2).get("score"));
    var history = livePractice.history(user);
    assertEquals(80, history.get(0).get("totalScore"));
    assertEquals(2, history.get(0).get("scoredDimensions"));
    assertEquals(80, history.get(1).get("totalScore"));
    assertEquals(4, history.get(1).get("scoredDimensions"));
  }

  @Test void recalculatesTheOverallScoreFromSavedPartialDimensions() {
    String user = id();
    s.db.update("INSERT INTO app_users VALUES (?,?,?,?)", user, user, "unused", now());
    String project = str(projects.save(user, null, Map.of("name", "课程资料问答助手")), "id");
    String round = id();
    var dimensions = List.of(Map.of("key", "clarity", "score", 15), Map.of("key", "ownership"),
      Map.of("key", "depth", "score", 10), Map.of("key", "validation", "score", 5));
    var body = Map.of("report", Map.of("scoring", Map.of("dimensions", dimensions)));
    s.db.update("INSERT INTO project_practice_rounds(user_id,project_id,round_id,round_number,started_at,status,body) VALUES (?,?,?,?,?,'COMPLETED',?)",
      user, project, round, 1, 0, s.encode(body));

    var report = PracticeRetest.object(practice.get(user, project, round).get("report"));
    var scoring = PracticeRetest.object(report.get("scoring"));
    assertEquals(40, scoring.get("total"));
    assertEquals(dimensions, scoring.get("dimensions"));
    var record = practice.history(user).get(0);
    assertEquals(40, record.get("totalScore"));
    assertEquals(3, record.get("scoredDimensions"));
    assertEquals(new PracticeScoring.Summary(0, 1), PracticeScoring.summarize(Map.of("dimensions", List.of(Map.of("score", 0)))));
    assertEquals(new PracticeScoring.Summary(null, 0), PracticeScoring.summarize(Map.of("dimensions", List.of(Map.of("key", "ownership")))));
  }

  @Test void canScoreAnAlreadyCompletedLiveReportWithoutRewritingFeedback() {
    String user = id();
    s.db.update("INSERT INTO app_users VALUES (?,?,?,?)", user, user, "unused", now());
    String project = str(projects.save(user, null, Map.of("name", "合成历史评分项目")), "id");
    String round = id();
    var originalReport = Map.of("mode", "live", "clearParts", List.of("说清了职责。"));
    var body = Map.of("kind", "TRIAL", "modelMode", "live", "report", originalReport,
      "turns", List.of(Map.of("id", "answered", "question", "你负责哪部分？", "answer", "我负责测试"),
        Map.of("id", "unanswered", "question", "尚无回答的问题", "answer", "")));
    s.db.update("INSERT INTO project_practice_rounds(user_id,project_id,round_id,round_number,started_at,status,body) VALUES (?,?,?,?,?,'COMPLETED',?)",
      user, project, round, 1, 0, s.encode(body));
    var calls = new java.util.concurrent.atomic.AtomicInteger();
    var live = new ModelService(s, "live", "https://never-called.invalid", "synthetic", "synthetic", "test") {
      @Override Map<String, Object> call(String rule, Object input) {
        assertEquals(Map.of("allowedTurnIds", Set.of("T1"), "answeredTurns", List.of(
          Map.of("id", "T1", "question", "你负责哪部分？", "answer", "我负责测试"))), input);
        if (calls.incrementAndGet() == 1) return Map.of();
        return Map.of("practiceScores", List.of(Map.of("key", "ownership", "level", 4,
          "reason", "说明了测试职责。", "turnIds", List.of("T1"), "evidenceQuote", "我负责测试")));
      }
    };
    var livePractice = new ProjectPractice(s, projects, live);
    assertThrows(ResponseStatusException.class, () -> practice.score(user, project, round));
    assertThrows(ResponseStatusException.class, () -> livePractice.score(user, project, round));
    var afterFailure = livePractice.get(user, project, round);
    assertEquals(originalReport, afterFailure.get("report"));
    assertEquals(0L, afterFailure.get("leaseUntil"));
    var scored = livePractice.score(user, project, round);
    assertEquals("COMPLETED", scored.get("status"));
    assertEquals(afterFailure.get("turns"), scored.get("turns"));
    var scoredReport = PracticeRetest.object(scored.get("report"));
    assertNotNull(scoredReport.get("scoring"));
    assertEquals(originalReport.get("clearParts"), scoredReport.get("clearParts"));
    assertEquals(Boolean.TRUE, livePractice.history(user).get(0).get("hasScoring"));
    assertEquals(scored, livePractice.score(user, project, round));
    assertEquals(2, calls.get());
  }

  @Test void retriesInvalidInlineScoresSeparatelyAndKeepsFeedbackIfScoringIsUnavailable() {
    String answer = "我负责预约接口，用唯一键防重复，再用并发请求核对结果。";
    var dimensions = List.of("clarity", "ownership", "depth", "validation");
    for (boolean recovers : List.of(true, false)) {
      var calls = new java.util.concurrent.atomic.AtomicInteger();
      var model = new ModelService(s, "live", "https://never-called.invalid", "synthetic", "synthetic", "test") {
        @Override Map<String, Object> call(String rule, Object input) {
          boolean scoreOnly = calls.incrementAndGet() == 2;
          assertEquals(scoreOnly, rule.startsWith("只为这场项目面试补生成评分"));
          var scores = dimensions.stream().map(key -> Map.of("key", key, "level", 4,
            "reason", "结合回答中的说明。", "turnIds", List.of("T1"),
            "evidenceQuote", scoreOnly && recovers ? answer : "我负责一个没有在回答中出现的功能")).toList();
          return scoreOnly ? Map.of("practiceScores", scores) : Map.of("practiceScores", scores,
            "clearParts", List.of("描述了预约流程。"), "findings", List.of(), "retestTopics", List.of());
        }
      };
      var body = new LinkedHashMap<String, Object>(Map.of("kind", "PRACTICE",
        "project", new LinkedHashMap<String, Object>(),
        "turns", List.of(Map.of("id", "answered", "question", "怎样实现预约？", "answer", answer))));
      var report = model.report(body);
      assertEquals(List.of("描述了预约流程。"), report.get("clearParts"));
      assertEquals(2, calls.get());
      assertEquals(recovers, report.containsKey("scoring"));
      if (recovers) assertEquals(80, PracticeRetest.object(report.get("scoring")).get("total"));
    }
  }

  @Test void expiredQuestionLeaseCanRecoverWithoutGeneratingAnEmptyReport() {
    String user = id(); s.db.update("INSERT INTO app_users VALUES (?,?,?,?)", user, user, "unused", now());
    var p = projects.save(user, null, Map.of("name", "合成恢复项目", "responsibility", "接口"));
    String project = str(p, "id");
    String roundId = str(practice.run(user, project, Map.of()), "roundId");
    s.db.update("UPDATE project_practice_rounds SET status='GENERATING',lease_until=? WHERE user_id=? AND round_id=?", now() + 60000, user, roundId);
    assertEquals("GENERATING", practice.get(user, project).get("status"));
    assertThrows(ResponseStatusException.class, () -> practice.run(user, project, Map.of()));
    s.db.update("UPDATE project_practice_rounds SET lease_until=? WHERE user_id=? AND round_id=?", now() - 1, user, roundId);
    assertEquals("FAILED", practice.get(user, project).get("status"));
    var recovered = practice.run(user, project, Map.of());
    assertEquals("ACTIVE", recovered.get("status"));
    assertFalse(recovered.containsKey("report"));
  }

  @Test void newRoundsRevisitGapsAndRetireThemAfterAnIndependentAnswer() {
    String user = id();
    s.db.update("INSERT INTO app_users VALUES (?,?,?,?)", user, user, "unused", now());
    var material = projects.save(user, null, Map.of("name", "合成任务调度", "stack", "RabbitMQ"));
    String projectId = str(material, "id"), firstRound = id(), missed = id(), answered = id();
    var original = Map.of("project", material, "modelMode", "live", "maxTurns", 2, "report", Map.of("mode", "live"),
      "turns", List.of(
        Map.of("id", missed, "topic", "ACK 前宕机恢复", "question", "说明 ACK 前进程宕机后的恢复流程。",
          "answer", "请直接给我答案。", "explanation", "需要结合租约和重试。"),
        Map.of("id", answered, "topic", "重复写入防护", "question", "如何避免相同任务重复写入？",
          "answer", "使用任务 ID 唯一约束识别重复请求。",
          "exchanges", List.of(Map.of("answer", "使用任务 ID 唯一约束识别重复请求。", "reply", "这一点说清楚了。")))));
    s.db.update("INSERT INTO project_practice_rounds(user_id,project_id,round_id,round_number,started_at,status,body) VALUES (?,?,?,?,?,'COMPLETED',?)",
      user, projectId, firstRound, 1, now(), s.encode(original));
    var rejected = new java.util.concurrent.atomic.AtomicInteger();
    var model = new ModelService(s, "live", "https://never-called.invalid", "synthetic", "synthetic", "test") {
      @Override Map<String, Object> call(String rule, Object data) {
        var input = PracticeRetest.object(data);
        if (input.get("latestAnswer") instanceof String answer)
          return Map.of("decision", "ADVANCE", "reply", "好的。", "evidence", answer, "answeredIndependently", true);

        if (input.containsKey("candidate")) {
          var candidate = PracticeRetest.object(input.get("candidate"));
          if ("相同负载的写入保护".equals(candidate.get("topic"))) {
            rejected.incrementAndGet();
            assertTrue(rule.contains("以前独立答清"));
            return Map.of("issues", List.of(Map.of("code", "REPEATED_GOAL", "reason", "仍在考相同任务的去重。",
              "previousQuestionId", answered, "previousGoalQuote", "如何避免相同任务重复写入",
              "candidateGoalQuote", "怎样防止插入两笔数据")));
          }
          return Map.of("issues", List.of());
        }

        var history = list(input, "practiceHistory");
        assertFalse(history.isEmpty());
        assertTrue(history.stream().noneMatch(entry -> entry.containsKey("answer")));
        var review = PracticeRetest.object(input.get("practiceReview"));
        if (!review.isEmpty()) {
          assertEquals(missed, review.get("id"));
          assertEquals(PracticeRoundHistory.NEEDS_PRACTICE, review.get("outcome"));
          return Map.of("topic", "消息确认与恢复", "question", "请说明工作进程在发出确认前退出时如何恢复任务。");
        }
        if (history.stream().anyMatch(entry -> missed.equals(entry.get("id"))
            && PracticeRoundHistory.ANSWERED_INDEPENDENTLY.equals(entry.get("outcome"))))
          return Map.of("topic", "部署配置", "question", "请说明任务进程的环境配置如何在部署时注入。");
        assertTrue(history.stream().anyMatch(entry -> answered.equals(entry.get("id"))
          && PracticeRoundHistory.ANSWERED_INDEPENDENTLY.equals(entry.get("outcome"))));
        if (!input.containsKey("repair")) return Map.of("topic", "相同负载的写入保护",
          "question", "请说明完全相同的任务再次投递时怎样防止插入两笔数据。");
        return Map.of("topic", "任务监控", "question", "请说明用什么指标监控任务队列是否积压。");
      }

      @Override Map<String, Object> report(Map<String, Object> body) {
        return Map.of("mode", "live", "findings", List.of(), "clearParts", List.of("说明了本轮的恢复流程。"));
      }
    };
    var service = new ProjectPractice(s, projects, model);
    service.maxTurns = 2;
    service.journey = practice.journey;

    var second = service.run(user, projectId, Map.of("restart", true, "roundId", firstRound));
    var reviewTurn = list(second, "turns").get(0);
    assertEquals(missed, reviewTurn.get("reviewOf"));
    assertEquals("ACK 前宕机恢复", reviewTurn.get("topic"));
    assertTrue(PracticeRoundHistory.nextReview(Map.of("interviewTopic", "部署配置"), list(second, "practiceHistory")).isEmpty());
    second = service.run(user, projectId, Map.of("turnId", reviewTurn.get("id"), "dialogue", true, "exchangeCount", 0,
      "answer", "未确认的消息会重投，新的 Worker 会等旧租约到期再原子领取并恢复任务。"));
    assertEquals(Boolean.TRUE, list(second, "turns").get(0).get("answeredIndependently"));
    var newTurn = list(second, "turns").get(1);
    assertEquals("任务监控", newTurn.get("topic"));
    assertEquals(1, rejected.get());
    second = service.run(user, projectId, Map.of("turnId", newTurn.get("id"), "dialogue", true, "exchangeCount", 0,
      "answer", "我观察待消费消息数和最老消息的等待时间，以识别积压和恢复情况。"));
    assertEquals("COMPLETED", second.get("status"));

    var third = service.run(user, projectId, Map.of("restart", true, "roundId", second.get("roundId")));
    assertEquals("部署配置", list(third, "turns").get(0).get("topic"));
    assertTrue(list(third, "practiceHistory").stream().anyMatch(entry -> missed.equals(entry.get("id"))
      && PracticeRoundHistory.ANSWERED_INDEPENDENTLY.equals(entry.get("outcome"))));
    assertEquals(original.get("turns"), service.get(user, projectId, firstRound).get("turns"));
    String otherProject = str(projects.save(user, null, Map.of("name", "其它项目")), "id");
    assertFalse(practice.run(user, otherProject, Map.of()).containsKey("practiceHistory"));
  }

  @Test void practiceAdvancesWithOpenQuestionsWhenBothModelCandidatesAreRejected() {
    String user = id();
    s.db.update("INSERT INTO app_users VALUES (?,?,?,?)", user, user, "unused", now());
    String project = str(projects.save(user, null, Map.of("name", "合成预约项目")), "id");
    var reviewCount = new java.util.concurrent.atomic.AtomicInteger();
    var model = new ModelService(s, "live", "https://never-called.invalid", "synthetic", "synthetic", "test") {
      @Override Map<String, Object> call(String rule, Object input) {
        if (rule.startsWith(ModelQuality.QUESTION_RULE)) {
          reviewCount.incrementAndGet();
          return Map.of("issues", List.of(Map.of("code", "UNSUPPORTED_PREMISE", "reason", "材料尚未证明这个实现已完成")));
        }
        return Map.of("question", "请说明你已完成的索引设计。", "topic", "索引设计");
      }
    };
    model.qualityReviewEnabled = true;
    var livePractice = new ProjectPractice(s, projects, model);
    livePractice.maxTurns = 5;
    livePractice.journey = practice.journey;

    var started = livePractice.run(user, project, Map.of("topic", "并发预约"));
    assertEquals("ACTIVE", started.get("status"));
    var first = list(started, "turns").get(0);
    assertTrue(str(first, "question").startsWith("围绕本轮面试主题，"));
    assertEquals("个人贡献范围", first.get("topic"));
    String answer = "我负责预约接口。";
    var resumed = livePractice.run(user, project, Map.of("turnId", first.get("id"), "answer", answer));
    var turns = list(resumed, "turns");
    assertEquals("ACTIVE", resumed.get("status"));
    assertEquals(started.get("roundId"), resumed.get("roundId"));
    assertEquals(2, turns.size());
    assertEquals(answer, turns.get(0).get("answer"));
    assertEquals("场景处理流程", turns.get(1).get("topic"));
    assertEquals(4, reviewCount.get());
  }

  @Test void exampleFallbackQuestionsFollowEachScenarioAndChangeAcrossNewRounds() {
    String user = id();
    s.db.update("INSERT INTO app_users VALUES (?,?,?,?)", user, user, "unused", now());
    var model = new ModelService(s, "live", "https://never-called.invalid", "synthetic", "synthetic", "test") {
      @Override Map<String, Object> call(String rule, Object data) {
        assertFalse(rule.startsWith(ModelQuality.QUESTION_RULE));
        throw error(503, "模型暂不可用");
      }
    };
    model.qualityReviewEnabled = true;
    var livePractice = new ProjectPractice(s, projects, model);
    livePractice.maxTurns = 5;
    livePractice.journey = practice.journey;

    var keywords = Map.of("rag", List.of("文档切分", "向量检索"),
      "booking", List.of("后端接口", "座位预约"), "scheduler", List.of("任务领取", "到期通知"));
    for (var entry : keywords.entrySet()) {
      String project = ExampleQuestions.projectId(user, entry.getKey());
      projects.openExample(user, project, Map.of("name", "合成示例 " + entry.getKey()));
      var first = livePractice.run(user, project, Map.of(), true);
      assertEquals("ACTIVE", first.get("status"));
      var firstTurn = list(first, "turns").get(0);
      assertTrue(str(firstTurn, "question").contains(entry.getValue().get(0)));
      assertFalse(ExampleReference.read(firstTurn.get(ExampleReference.FIELD)).isBlank());
      assertEquals(first, livePractice.run(user, project, Map.of(), true));

      livePractice.cancel(user, project, str(first, "roundId"));
      var next = livePractice.run(user, project, Map.of(), true);
      assertEquals(2L, next.get("roundNumber"));
      var nextTurn = list(next, "turns").get(0);
      assertTrue(str(nextTurn, "question").contains(entry.getValue().get(1)));
      assertNotEquals(firstTurn.get("question"), nextTurn.get("question"));
      assertFalse(ExampleReference.read(nextTurn.get(ExampleReference.FIELD)).isBlank());
    }
  }
}
