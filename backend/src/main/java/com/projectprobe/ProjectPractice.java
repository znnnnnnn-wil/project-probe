package com.projectprobe;

import static com.projectprobe.Store.*;
import java.util.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
class ProjectPractice {
  private static final Logger log = LoggerFactory.getLogger(ProjectPractice.class);
  final Store s; final ProjectService projects; final ModelService model;
  @org.springframework.beans.factory.annotation.Value("${app.practice-max-turns:5}") int maxTurns;
  @org.springframework.beans.factory.annotation.Autowired JourneyMetrics journey;
  ProjectPractice(Store s, ProjectService projects, ModelService model) { this.s = s; this.projects = projects; this.model = model; }
  List<Map<String, Object>> history(String user) {
    var projectNames = new HashMap<String, String>();
    return s.db.queryForList(
      "SELECT t.project_id,t.round_id,t.round_number,t.started_at,t.status,t.body,t.lease_until,p.body AS project_body FROM project_practice_rounds t JOIN projects p ON p.id=t.project_id AND p.user_id=t.user_id WHERE t.user_id=? AND t.status NOT IN ('CLEARED','CANCELLED') ORDER BY t.started_at DESC,t.round_number DESC,t.round_id",
      user
    ).stream().map(row -> {
      var body = s.decode(row.get("body"));
      var project = PracticeRetest.object(body.get("project"));
      var retest = PracticeRetest.object(body.get("retest"));
      var report = PracticeRetest.object(body.get("report"));
      var scoring = PracticeScoring.summarize(PracticeRetest.object(report.get("scoring")));
      var firstFinding = report.get("findings") instanceof List<?> findings && !findings.isEmpty()
        ? PracticeRetest.object(findings.get(0)) : Map.<String, Object>of();
      String projectId = str(row, "project_id");
      String name = projectNames.computeIfAbsent(projectId, id -> str(s.decode(row.get("project_body")), "name"));
      Map<String, Object> summary = new LinkedHashMap<>(Map.of(
        "projectId", projectId,
        "roundId", row.get("round_id"),
        "roundNumber", row.get("round_number"),
        "name", name.isBlank() ? str(project, "name") : name,
        "status", status(row),
        "answeredCount", ReportComparison.answered(body, "turns").size(),
        "maxTurns", body.getOrDefault("maxTurns", 1),
        "retestCompleted", "COMPLETED".equals(retest.get("status"))
      ));
      summary.put("startedAt", row.get("started_at"));
      summary.put("interviewTopic", str(body, "interviewTopic"));
      summary.put("hasScoring", scoring.scoredDimensions() > 0);
      summary.put("totalScore", scoring.total());
      summary.put("scoredDimensions", scoring.scoredDimensions());
      summary.put("prioritySuggestion", str(firstFinding, "task"));
      return summary;
    }).toList();
  }

  private String status(Map<String, Object> row) {
    return "GENERATING".equals(row.get("status")) && ((Number) row.get("lease_until")).longValue() <= now()
      ? "FAILED" : str(row, "status");
  }

  Map<String, Object> get(String user, String project) {
    return get(user, project, "");
  }

  Map<String, Object> get(String user, String project, String roundId) {
    projects.get(user, project);
    var rows = roundId.isBlank()
      ? s.db.queryForList(
        "SELECT * FROM project_practice_rounds WHERE user_id=? AND project_id=? AND status<>'CLEARED' ORDER BY round_number DESC LIMIT 1",
        user, project
      )
      : s.db.queryForList(
        "SELECT * FROM project_practice_rounds WHERE user_id=? AND project_id=? AND round_id=? AND status<>'CLEARED'",
        user, project, roundId
      );
    if (rows.isEmpty()) {
      if (!roundId.isBlank()) throw error(404, "练习记录不存在");
      return Map.of("status", "AVAILABLE", "maxTurns", maxTurns);
    }
    var row = rows.get(0);
    if ("CANCELLED".equals(row.get("status"))) {
      if (!roundId.isBlank()) throw error(404, "练习已取消");
      return Map.of("status", "AVAILABLE", "maxTurns", maxTurns, "roundNumber", row.get("round_number"));
    }
    var result = s.decode(row.get("body"));
    var report = PracticeRetest.object(result.get("report"));
    var scoring = PracticeRetest.object(report.get("scoring"));
    if (!scoring.isEmpty()) scoring.put("total", PracticeScoring.summarize(scoring).total());
    long lease = ((Number) row.get("lease_until")).longValue();
    result.put("roundId", row.get("round_id"));
    result.put("roundNumber", row.get("round_number"));
    result.put("status", status(row));
    if (result.get("retest") instanceof Map<?, ?> && lease <= now()) {
      var retest = PracticeRetest.object(result.get("retest"));
      if ("GENERATING".equals(retest.get("status"))) retest.put("status", "FAILED");
    }
    result.put("leaseUntil", lease); return result;
  }

  Map<String, Object> cancel(String user, String projectId, String roundId) {
    return s.locked(user, () -> {
      projects.get(user, projectId);
      var row = s.one("SELECT status FROM project_practice_rounds WHERE user_id=? AND project_id=? AND round_id=? AND status<>'CLEARED'",
        user, projectId, roundId);
      if ("COMPLETED".equals(row.get("status"))) throw error(409, "面试已完成，请查看本场报告");
      s.db.update("UPDATE project_practice_rounds SET status='CANCELLED',lease_until=0,lease_token=NULL WHERE user_id=? AND project_id=? AND round_id=?",
        user, projectId, roundId);
      return get(user, projectId);
    });
  }

  Map<String, Object> score(String user, String projectId, String roundId) {
    String token = id();
    var answered = s.locked(user, () -> {
      projects.get(user, projectId);
      var row = s.one("SELECT status,body,lease_until FROM project_practice_rounds WHERE user_id=? AND project_id=? AND round_id=? AND status<>'CLEARED'",
        user, projectId, roundId);
      var body = s.decode(row.get("body"));
      var report = PracticeRetest.object(body.get("report"));
      if (!"COMPLETED".equals(row.get("status")) || !"live".equals(report.get("mode")) || !"live".equals(body.get("modelMode")))
        throw error(409, "只有已完成的 AI 面试报告可以补评分");
      if (PracticeScoring.hasScore(PracticeRetest.object(report.get("scoring")))) return List.<Map<String, Object>>of();
      if (!"live".equals(model.mode)) throw error(409, "当前服务未启用 AI 评分");
      long started = now();
      if (((Number) row.get("lease_until")).longValue() > started)
        throw error(409, "本场评分或专项复测正在生成，请稍后再试");
      var turns = ReportComparison.answered(body, "turns");
      if (turns.isEmpty()) throw error(409, "本场没有已保存的回答可以评分");
      var retest = PracticeRetest.object(body.get("retest"));
      if ("GENERATING".equals(retest.get("status"))) retest.put("status", "FAILED");
      s.db.update("UPDATE project_practice_rounds SET body=?,lease_until=?,lease_token=? WHERE user_id=? AND round_id=?",
        s.encode(body), started + 90000, token, user, roundId);
      return turns;
    });
    if (answered.isEmpty()) return get(user, projectId, roundId);

    try {
      var scoring = model.practiceScore(answered);
      s.locked(user, () -> {
        requireLease(user, roundId, token);
        var row = s.one("SELECT body FROM project_practice_rounds WHERE user_id=? AND round_id=?", user, roundId);
        var body = s.decode(row.get("body"));
        PracticeRetest.object(body.get("report")).put("scoring", scoring);
        s.db.update("UPDATE project_practice_rounds SET body=? WHERE user_id=? AND round_id=?",
          s.encode(body), user, roundId);
        return null;
      });
    } finally {
      s.db.update("UPDATE project_practice_rounds SET lease_until=0,lease_token=NULL WHERE user_id=? AND round_id=? AND lease_token=?",
        user, roundId, token);
    }
    return get(user, projectId, roundId);
  }

  Map<String, Object> requireUnansweredTurn(String user, String projectId, String turnId, Object exchangeCount) {
    var current = get(user, projectId);
    if (!"ACTIVE".equals(current.get("status"))) {
      throw error(409, "本题已结束，请重新加载当前问题");
    }
    var turns = list(current, "turns");
    var turn = turns.isEmpty() ? Map.<String, Object>of() : turns.get(turns.size() - 1);
    if (!turnId.equals(turn.get("id")) || !str(turn, "answer").isBlank() ||
        (exchangeCount != null && !PracticeDialogue.matchesCount(exchangeCount, PracticeDialogue.count(turn)))) {
      throw error(409, "本题已结束，请重新加载当前问题");
    }
    return turn;
  }

  String speechPrompt(String user, String projectId, String turnId, Object exchangeCount) {
    return PracticeDialogue.currentPrompt(requireUnansweredTurn(user, projectId, turnId, exchangeCount));
  }

  void refreshLegacyExampleOpener(String user, String projectId, String scenario) {
    s.locked(user, () -> {
      var rows = s.db.queryForList("SELECT round_id,round_number,status,body,lease_until FROM project_practice_rounds " +
        "WHERE user_id=? AND project_id=? AND status<>'CLEARED' ORDER BY round_number DESC LIMIT 1", user, projectId);
      if (rows.isEmpty()) return null;
      var row = rows.get(0);
      if (!"ACTIVE".equals(row.get("status")) || ((Number) row.get("lease_until")).longValue() > now()) return null;
      var body = s.decode(row.get("body"));
      var turns = list(body, "turns");
      if (!ExampleReference.enabled(body) || !"live".equals(body.get("modelMode")) || turns.size() != 1 ||
          !PracticeRetest.object(body.get("pendingExchange")).isEmpty()) return null;
      var first = turns.get(0);
      if (!str(first, "answer").isBlank() || !str(first, "explanation").isBlank() || PracticeDialogue.count(first) > 0 ||
          !ModelService.isGenericPracticeOpener(str(first, "question"))) return null;
      body.put("exampleScenario", scenario);
      body.put("exampleRoundNumber", row.get("round_number"));
      body.put("turns", new ArrayList<>());
      model.examplePracticeOpener(body).ifPresent(question -> {
        list(body, "turns").add(newTurn(question));
        s.db.update("UPDATE project_practice_rounds SET body=? WHERE user_id=? AND project_id=? AND round_id=?",
          s.encode(body), user, projectId, row.get("round_id"));
      });
      return null;
    });
  }

  Map<String, Object> run(String user, String projectId, Map<String, Object> input) {
    return run(user, projectId, input, false);
  }

  Map<String, Object> run(String user, String projectId, Map<String, Object> input, boolean example) {
    return run(user, projectId, input, example, null);
  }

  Map<String, Object> run(String user, String projectId, Map<String, Object> input, boolean example,
      java.util.function.Consumer<String> sentences) {
    String token = id();
    boolean restart = Boolean.TRUE.equals(input.get("restart"));
    String answer = str(input, "answer").strip();
    var claim = s.locked(user, () -> {
      var current = get(user, projectId); String status = str(current, "status");
      String roundId = str(current, "roundId");
      long roundNumber = ((Number) current.getOrDefault("roundNumber", 0L)).longValue();
      if (restart) {
        if (!status.equals("COMPLETED") || !roundId.equals(required(input, "roundId", 36)))
          throw error(409, "练习状态已变化，请刷新后再开始");
        if (((Number) current.get("leaseUntil")).longValue() > now())
          throw error(409, "本场评分或专项复测正在生成，请稍后再开始");
      } else if (status.equals("COMPLETED")) return null;
      if (status.equals("AVAILABLE") || restart) {
        if (!answer.isBlank()) throw error(409, "当前问题已变化，请重新读取后再提交");
        Object requestedTopic = input.get("topic");
        if (requestedTopic != null && !(requestedTopic instanceof String))
          throw error(400, "面试主题格式不正确");
        String interviewTopic = str(input, "topic").strip();
        if (interviewTopic.length() > 200) throw error(400, "面试主题最多 200 字");
        var project = new LinkedHashMap<>(projects.get(user, projectId));
        project.put("facts", list(project, "facts").stream().filter(f -> Boolean.TRUE.equals(f.get("confirmed"))).toList());
        if (maxTurns < 1 || maxTurns > 5) throw error(503, "练习轮数配置不正确");
        roundNumber++;
        roundId = id();
        current = new LinkedHashMap<>(Map.of("project", project, "kind", "PRACTICE", "turns", new ArrayList<>(), "modelMode", model.mode, "maxTurns", maxTurns));
        if (!interviewTopic.isBlank()) current.put("interviewTopic", interviewTopic);
        if (!example) {
          var history = PracticeRoundHistory.load(s, user, projectId, model.mode);
          if (!history.isEmpty()) current.put("practiceHistory", history);
        }
        s.db.update(
          "INSERT INTO project_practice_rounds(user_id,project_id,round_id,round_number,started_at,status,body) VALUES (?,?,?,?,?,?,?)",
          user, projectId, roundId, roundNumber, now(), "PENDING", s.encode(current)
        );
        journey.record(user, "PRACTICE_STARTED", projectId);
      } else if (status.equals("GENERATING")) throw error(409, "练习正在生成，请稍后刷新");
      var turns = list(current, "turns");
      if (!turns.isEmpty()) {
        var turn = turns.get(turns.size() - 1);
        int limit = ((Number) current.getOrDefault("maxTurns", 1)).intValue();
        String turnId = str(input, "turnId");
        int exchangeCount = PracticeDialogue.count(turn);
        var pending = PracticeRetest.object(current.get("pendingExchange"));
        boolean dialogue = Boolean.TRUE.equals(input.get("dialogue")) || exchangeCount > 0 || !pending.isEmpty();
        if (!answer.isBlank() && (limit > 1 || !turnId.isBlank()) && !str(turn, "id").equals(turnId))
          throw error(409, "当前问题已变化，请重新读取后再提交");
        if (!answer.isBlank() && dialogue && (
          !str(turn, "id").equals(turnId) ||
          !PracticeDialogue.matchesCount(input.get("exchangeCount"), exchangeCount)
        )) throw error(409, "对话进度已更新，请重新读取后再回复");
        if (answer.isBlank() && str(turn, "answer").isBlank() && pending.isEmpty()) {
          s.db.update("UPDATE project_practice_rounds SET status='ACTIVE',lease_until=0,lease_token=NULL WHERE user_id=? AND round_id=?", user, roundId);
          return null;
        }
        if (!answer.isBlank()) {
          if (answer.length() > 3000) throw error(400, "练习回答最多 3000 字");
          boolean sameExchange = dialogue && exchangeCount > 0 &&
            answer.equals(str(list(turn, "exchanges").get(exchangeCount - 1), "answer"));
          if (!str(turn, "answer").isBlank() && !answer.equals(turn.get("answer")) && !sameExchange)
            throw error(409, "练习回答已提交");
          if (dialogue && str(turn, "answer").isBlank()) {
            if (!pending.isEmpty() && !answer.equals(str(pending, "answer")))
              throw error(409, "上一段发言已保存，请先恢复生成");
            current.put("pendingExchange", Map.of("turnId", turn.get("id"), "answer", answer, "exchangeCount", exchangeCount));
          } else if (!dialogue) turn.put("answer", answer);
        }
      }
      if (example) {
        current.put("example", true);
        current.put("exampleScenario", ExampleQuestions.scenario(user, projectId));
        current.put("exampleRoundNumber", roundNumber);
        current.remove("practiceHistory");
      }
      current.remove("status");
      current.remove("leaseUntil");
      current.remove("roundId");
      current.remove("roundNumber");
      s.db.update("UPDATE project_practice_rounds SET status='GENERATING',body=?,lease_until=?,lease_token=? WHERE user_id=? AND round_id=?",
        s.encode(current), now() + 90000, token, user, roundId);
      return new Generation(roundId, current);
    });
    if (claim == null) return get(user, projectId);
    var body = claim.body();
    String roundId = claim.roundId();
    long priorDeadline = model.questionDeadline.get();
    model.questionDeadline.set(Math.min(priorDeadline, now() + 85000));
    try {
      var turns = list(body, "turns");
      if (turns.isEmpty()) {
        turns.add(newTurn(model.firstDeepQuestion(body)));
      } else {
        var turn = turns.get(turns.size() - 1);
        Map<String, Object> nextQuestion = Map.of();
        var pending = PracticeRetest.object(body.get("pendingExchange"));
        if (!pending.isEmpty()) {
          if (!str(turn, "id").equals(str(pending, "turnId")) ||
              !PracticeDialogue.matchesCount(pending.get("exchangeCount"), PracticeDialogue.count(turn)))
            throw error(409, "对话进度已更新，请重新读取后再回复");
          String utterance = str(pending, "answer");
          var reply = PracticeDialogue.decide(model, body, turn, utterance, sentences);
          var exchanges = list(turn, "exchanges");
          var exchange = new LinkedHashMap<String, Object>(Map.of("answer", utterance, "reply", reply.text()));
          if (!reply.referenceAnswer().isBlank()) exchange.put(ExampleReference.FIELD, reply.referenceAnswer());
          if (reply.explained()) {
            exchange.put("explained", true);
            turn.put("explanation", reply.text());
          }
          exchanges.add(exchange);
          body.remove("pendingExchange");
          if (reply.advance()) {
            nextQuestion = reply.nextQuestion();
            turn.put("answer", PracticeDialogue.combinedAnswer(exchanges));
            turn.put("answeredIndependently", reply.answeredIndependently());
            // Keep the model's decision if generating the next question or report fails.
            s.locked(user, () -> {
              requireLease(user, roundId, token);
              s.db.update("UPDATE project_practice_rounds SET body=? WHERE user_id=? AND round_id=?", s.encode(body), user, roundId);
              return null;
            });
          }
        }
        if (!str(turn, "answer").isBlank()) {
          if (turns.size() < ((Number) body.getOrDefault("maxTurns", 1)).intValue()) {
            turns.add(newTurn(nextQuestion.isEmpty() ? model.question(body) : model.question(body, nextQuestion)));
          } else body.put("report", model.report(body));
        }
      }
      s.locked(user, () -> {
        requireLease(user, roundId, token);
        s.db.update("UPDATE project_practice_rounds SET status=?,body=?,lease_until=0,lease_token=NULL WHERE user_id=? AND round_id=?",
          body.containsKey("report") ? "COMPLETED" : "ACTIVE", s.encode(body), user, roundId);
        if (body.containsKey("report")) journey.record(user, "PRACTICE_COMPLETED", projectId);
        return null;
      });
    } catch (Exception e) {
      var reviewIssueCodes = e instanceof ModelQuality.Rejected rejected ? rejected.issueCodes() : List.<String>of();
      log.warn("practice_generation_failed roundId={} exceptionType={} reviewIssueCodes={} locations={}", roundId,
        e.getClass().getName(), reviewIssueCodes, Arrays.stream(e.getStackTrace()).limit(6).toList());
      s.db.update("UPDATE project_practice_rounds SET status='FAILED',lease_until=0 WHERE user_id=? AND round_id=? AND lease_token=?", user, roundId, token);
      if (e instanceof ModelContext.TooLarge limit) throw limit;
      throw error(503, "练习生成失败，已保存进度，可在原项目重试");
    } finally {
      if (priorDeadline == Long.MAX_VALUE) model.questionDeadline.remove();
      else model.questionDeadline.set(priorDeadline);
    }
    return get(user, projectId, roundId);
  }

  private record Generation(String roundId, Map<String, Object> body) {}

  private static Map<String, Object> newTurn(ModelService.GeneratedQuestion question) {
    var turn = new LinkedHashMap<String, Object>(Map.of("id", id(), "question", question.question(), "topic", question.topic(), "answer", ""));
    if (!question.reviewOf().isBlank()) turn.put("reviewOf", question.reviewOf());
    if (!question.referenceAnswer().isBlank()) turn.put(ExampleReference.FIELD, question.referenceAnswer());
    return turn;
  }

  private void requireLease(String user, String roundId, String token) {
    var row = s.one("SELECT lease_token,lease_until FROM project_practice_rounds WHERE user_id=? AND round_id=?", user, roundId);
    if (!token.equals(row.get("lease_token")) || ((Number) row.get("lease_until")).longValue() <= now())
      throw error(409, "生成租约已失效，请重试");
  }
}
