package com.projectprobe;

import static com.projectprobe.Store.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.web.server.ResponseStatusException;

@SpringBootTest(properties = {"spring.datasource.url=jdbc:h2:mem:competition-practice;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
  "app.model-mode=demo", "app.practice-max-turns=5"})
class CompetitionPracticeTest {
  @Autowired Store s;
  @Autowired ProjectService projects;
  @Autowired ProjectPractice practice;
  @Autowired PracticeRetest retest;
  String[] fixture() {
    String user = id();
    s.db.update("INSERT INTO app_users VALUES (?,?,?,?)", user, user, "unused", now());
    var project = projects.save(user, null, Map.of("name", "合成预约项目", "responsibility", "预约接口、数据库约束", "verification", "并发测试尚未完成"));
    return new String[]{user, str(project, "id")};
  }
  @Test void completesFiveTurnsAndRejectsStaleSubmissions() {
    var f = fixture();
    var state = practice.run(f[0], f[1], Map.of());
    assertEquals(5, state.get("maxTurns"));
    for (int i = 0; i < 5; i++) {
      var turns = list(state, "turns");
      assertEquals(i + 1, turns.size());
      assertEquals("ACTIVE", state.get("status"));
      var input = Map.<String,Object>of("turnId", turns.get(i).get("id"), "answer", "合成回答" + i + "：我负责接口，通过数据库约束防止冲突；并发测试尚未完成。");
      state = practice.run(f[0], f[1], input);
      if (i < 4) {
        var stale = assertThrows(ResponseStatusException.class, () -> practice.run(f[0], f[1], input));
        assertEquals(409, stale.getStatusCode().value());
        assertEquals(state, practice.run(f[0], f[1], Map.of()));
      }
    }
    assertEquals("COMPLETED", state.get("status"));
    var report = (Map<String,Object>)state.get("report");
    assertEquals(5, list(report, "findings").size());
    assertEquals(state, practice.run(f[0], f[1], Map.of()));
    var turns = list(state, "turns");
    var invalid = Map.<String, Object>of(
      "findingIndex", 0, "turnId", turns.get(1).get("id"), "answer", "来自另一题");
    assertThrows(ResponseStatusException.class, () -> retest.run(f[0], f[1], invalid));

    var input = Map.<String, Object>of(
      "findingIndex", 0, "turnId", turns.get(0).get("id"),
      "answer", "测试输入：两次并发请求。预期结果：仅成功一笔。实测结果：尚未执行。");
    var compared = retest.run(f[0], f[1], input);
    var saved = PracticeRetest.object(compared.get("retest"));
    var comparison = list(PracticeRetest.object(saved.get("report")), "comparisons").get(0);
    assertEquals("COMPLETED", saved.get("status"));
    assertEquals(report, compared.get("report"));
    assertEquals(turns.get(0).get("answer"), list(comparison, "previousEvidence").get(0).get("quote"));
    assertEquals(input.get("answer"), list(comparison, "currentEvidence").get(0).get("quote"));
    assertTrue(str(comparison, "assessment").contains("测试输入、预期结果"));
    assertFalse(str(comparison, "assessment").contains("、实测结果"));
    assertEquals(compared, retest.run(f[0], f[1], input));
    assertEquals(true, practice.history(f[0]).get(0).get("retestCompleted"));
    assertTrue(practice.history(id()).isEmpty());
    assertThrows(ResponseStatusException.class, () -> practice.get(id(), f[1]));
  }
  @Test void resumesSavedAnswerAfterExpiredGenerationWithoutLosingOrDuplicatingIt() {
    var f = fixture();
    var state = practice.run(f[0], f[1], Map.of());
    list(state, "turns").get(0).put("answer", "已经提交的回答，故障后应保留。");
    s.db.update("UPDATE project_practice_rounds SET body=?,status='GENERATING',lease_until=? WHERE user_id=? AND round_id=?", s.encode(state), now()-1, f[0], str(state, "roundId"));
    assertEquals("FAILED", practice.get(f[0], f[1]).get("status"));
    var recovered = practice.run(f[0], f[1], Map.of());
    assertEquals("ACTIVE", recovered.get("status"));
    assertEquals(2, list(recovered, "turns").size());
    assertEquals("已经提交的回答，故障后应保留。", list(recovered, "turns").get(0).get("answer"));
    assertEquals(recovered, practice.run(f[0], f[1], Map.of()));
    assertEquals("ACTIVE", practice.history(f[0]).get(0).get("status"));
    assertEquals(1, practice.history(f[0]).get(0).get("answeredCount"));
  }
  @Test void requiresQuestionIdentityAndKeepsTheOriginalMaterialSnapshot() {
    var f = fixture();
    var first = practice.run(f[0], f[1], Map.of());
    assertThrows(ResponseStatusException.class, () -> practice.run(f[0], f[1], Map.of("answer", "未标明题目")));
    var changed = new LinkedHashMap<>(projects.get(f[0], f[1]));
    changed.put("responsibility", "后来补充的材料");
    projects.save(f[0], f[1], changed);
    var next = practice.run(f[0], f[1], Map.of("answer", "已提交", "turnId", list(first,"turns").get(0).get("id")));
    assertEquals("预约接口、数据库约束", ((Map<?,?>)next.get("project")).get("responsibility"));
  }
  @Test void dialogueKeepsTheTopicUntilTheAnswerIsDeveloped() {
    var fixture = fixture();
    String user = fixture[0], project = fixture[1];
    var state = practice.run(user, project, Map.of());
    var first = list(state, "turns").get(0);
    String turnId = str(first, "id");
    String question = str(first, "question");

    var greeting = Map.<String, Object>of("turnId", turnId, "dialogue", true, "exchangeCount", 0, "answer", "你好！");
    state = practice.run(user, project, greeting);
    assertEquals("ACTIVE", state.get("status"));
    assertEquals(1, list(state, "turns").size());
    first = list(state, "turns").get(0);
    assertEquals(turnId, str(first, "id"));
    assertEquals(question, str(first, "question"));
    assertEquals("", str(first, "answer"));
    assertEquals(question, PracticeDialogue.currentPrompt(first));
    assertEquals(409, assertThrows(ResponseStatusException.class,
      () -> practice.run(user, project, greeting)).getStatusCode().value());
    assertEquals(409, assertThrows(ResponseStatusException.class,
      () -> practice.requireUnansweredTurn(user, project, turnId, 0)).getStatusCode().value());
    assertEquals(first, practice.requireUnansweredTurn(user, project, turnId, 1));

    String brief = "服务端用数据库唯一键保存请求记录。";
    var partial = Map.<String, Object>of("turnId", turnId, "dialogue", true, "exchangeCount", 1, "answer", brief);
    state = practice.run(user, project, partial);
    assertEquals(1, list(state, "turns").size());
    assertEquals(2, PracticeDialogue.count(list(state, "turns").get(0)));
    assertEquals("", str(list(state, "turns").get(0), "answer"));

    String detail = "同一个幂等键查到之前的处理结果，重复请求直接返回第一次的结果。";
    state = practice.run(user, project, Map.of(
      "turnId", turnId, "dialogue", true, "exchangeCount", 2, "answer", detail));
    var turns = list(state, "turns");
    assertEquals(2, turns.size());
    assertEquals(3, PracticeDialogue.count(turns.get(0)));
    assertEquals(brief + "\n" + detail, str(turns.get(0), "answer"));
    assertEquals(1, practice.history(user).get(0).get("answeredCount"));
    assertNotEquals(turnId, str(turns.get(1), "id"));
  }

  @Test void restoresPendingDialogueOnceAfterAnExpiredLease() {
    var fixture = fixture();
    String user = fixture[0], project = fixture[1];
    var state = practice.run(user, project, Map.of());
    String turnId = str(list(state, "turns").get(0), "id");
    state.put("pendingExchange", Map.of("turnId", turnId, "exchangeCount", 0, "answer", "使用唯一键。"));
    s.db.update("UPDATE project_practice_rounds SET body=?,status='GENERATING',lease_until=? WHERE user_id=? AND round_id=?", s.encode(state), now()-1, user, str(state, "roundId"));

    var recovered = practice.run(user, project, Map.of());
    assertEquals("ACTIVE", recovered.get("status"));
    assertFalse(recovered.containsKey("pendingExchange"));
    assertEquals(1, list(recovered, "turns").size());
    assertEquals(1, PracticeDialogue.count(list(recovered, "turns").get(0)));
    assertEquals(recovered, practice.run(user, project, Map.of()));
  }

  @Test void modelCannotAdvanceOnInventedEvidence() {
    String answer = "数据库使用唯一键拒绝相同请求。";
    var previous = List.<Map<String, Object>>of(Map.of("answer", "请求会带唯一的幂等键。", "reply", "如何处理重复请求？"));
    assertTrue(PracticeDialogue.parse(Map.of(
      "decision", "ADVANCE", "reply", "说清楚了。", "evidence", "使用唯一键拒绝相同请求"), previous, answer).advance());
    assertFalse(PracticeDialogue.parse(Map.of(
      "decision", "FOLLOW_UP", "reply", "重试会收到什么响应？"), previous, answer).advance());
    assertThrows(ResponseStatusException.class, () -> PracticeDialogue.parse(Map.of(
      "decision", "ADVANCE", "reply", "说清楚了。", "evidence", "如何处理重复请求"), previous, answer));
    assertThrows(ResponseStatusException.class, () -> PracticeDialogue.parse(Map.of(
      "decision", "ADVANCE", "reply", "说清楚了。", "evidence", "请求会带唯一的幂等键"), previous, "你好"));
  }
  ModelService dialogueModel() {
    return spy(new ModelService(s, "live", "https://model.example/v1", "synthetic-key", "test", "test"));
  }

  @ParameterizedTest
  @ValueSource(strings = {"还是使用前面说的请求键", "不会"})
  void bothDialogueAndTeachingReceiveEarlierTopicsWithoutBorrowingTheirEvidence(String answer) {
    var model = dialogueModel();
    var previous = Map.<String, Object>of("id", "before", "question", "如何去重？", "answer", "请求键在服务端持久化",
      "exchanges", List.of(Map.of("answer", "请求键在服务端持久化", "reply", "旧讲解")));
    var exchange = Map.<String, Object>of("answer", "超时会先查询状态", "reply", "然后怎样处理？");
    var current = Map.<String, Object>of("id", "now", "question", "怎样处理超时？", "exchanges", List.of(exchange));
    var future = Map.<String, Object>of("id", "future", "answer", "不应被传入的后续回答");
    var context = Map.<String, Object>of("project", Map.of("name", "合成项目"), "interviewTopic", "幂等",
      "turns", List.of(previous, current, future), "historyTurns", List.of(Map.of("answer", "另一场回答")));
    String saved = s.encode(context);
    doReturn(Map.of("decision", "FOLLOW_UP", "reply", "假设请求仍在处理，先查询已有状态。"))
      .when(model).call(anyString(), any());
    PracticeDialogue.decide(model, context, current, answer);
    var captor = org.mockito.ArgumentCaptor.forClass(Object.class);
    verify(model).call(anyString(), captor.capture());
    var input = PracticeRetest.object(captor.getValue());
    assertEquals(List.of(Map.of("id", "before", "question", "如何去重？", "answer", "请求键在服务端持久化")), input.get("completedTurns"));
    assertEquals(List.of(exchange), input.get("exchanges"));
    assertEquals(false, input.get("exchangesTruncated"));
    assertEquals(answer, input.get("latestAnswer"));
    assertEquals("幂等", input.get("interviewTopic"));
    assertFalse(input.containsKey("historyTurns"));
    assertEquals(saved, s.encode(context));

    if (!answer.equals("不会")) {
      doReturn(Map.of("decision", "ADVANCE", "reply", "好的", "evidence", "请求键在服务端持久化"))
        .when(model).call(anyString(), any());
      assertThrows(ResponseStatusException.class, () -> PracticeDialogue.decide(model, context, current, answer));
    }
  }

  @Test void longDialogueRetainsRecentCompleteExchangesAndTheEntireLatestAnswer() {
    var model = dialogueModel();
    var exchanges = new ArrayList<Map<String, Object>>();
    for (int i = 0; i < 6; i++) exchanges.add(Map.of("answer", "答".repeat(3000), "reply", "追问" + i, "internal", "不发送"));
    var turn = Map.<String, Object>of("id", "current", "question", "如何验证？", "exchanges", exchanges);
    String latest = "最新解释".repeat(750);
    doReturn(Map.of("decision", "FOLLOW_UP", "reply", "请说明预期结果。"))
      .when(model).call(anyString(), any());
    PracticeDialogue.decide(model, Map.of("project", Map.of()), turn, latest);
    var captor = org.mockito.ArgumentCaptor.forClass(Object.class);
    verify(model).call(anyString(), captor.capture());
    var input = PracticeRetest.object(captor.getValue());
    var recent = list(new LinkedHashMap<>(input), "exchanges");
    assertEquals(3, recent.size());
    assertEquals("追问3", recent.get(0).get("reply"));
    assertEquals("追问5", recent.get(2).get("reply"));
    assertEquals(3000, str(recent.get(0), "answer").length());
    assertFalse(recent.get(0).containsKey("internal"));
    assertEquals(true, input.get("exchangesTruncated"));
    assertEquals(latest, input.get("latestAnswer"));
    assertEquals(6, exchanges.size());
    assertTrue(exchanges.get(0).containsKey("internal"));
  }

  @Test void contextLimitKeepsSavedAnswerAndReleasesTheGenerationLease() {
    var f = fixture();
    var model = dialogueModel();
    var service = new ProjectPractice(s, projects, model);
    service.maxTurns = 1;
    service.journey = practice.journey;
    doReturn(new ModelService.GeneratedQuestion("请说明验证方法。", "验证"))
      .when(model).firstDeepQuestion(any());
    doThrow(new ModelContext.TooLarge()).when(model).report(any());
    var state = service.run(f[0], f[1], Map.of());
    String turnId = str(list(state, "turns").get(0), "id");
    assertEquals(413, assertThrows(ModelContext.TooLarge.class, () -> service.run(f[0], f[1],
      Map.of("turnId", turnId, "answer", "已保存的原始回答"))).getStatusCode().value());
    var failed = service.get(f[0], f[1]);
    assertEquals("FAILED", failed.get("status"));
    assertEquals(0L, failed.get("leaseUntil"));
    assertEquals("已保存的原始回答", list(failed, "turns").get(0).get("answer"));
    verify(model, times(1)).report(any());
  }

  @Test void exampleFollowUpSavesASeparateReferenceForTheCurrentPrompt() {
    var f = fixture();
    var model = dialogueModel();
    var service = new ProjectPractice(s, projects, model);
    service.maxTurns = 1;
    service.journey = practice.journey;
    doReturn(new ModelService.GeneratedQuestion("请说明预约唯一约束。", "预约约束", "", "我按座位和时段建立唯一约束。"))
      .when(model).firstDeepQuestion(any());
    doReturn(Map.of("decision", "FOLLOW_UP", "reply", "发生冲突时接口返回什么。",
        "referenceAnswer", "我会返回 409，提示该时段已预约。"))
      .when(model).call(anyString(), any());
    var state = service.run(f[0], f[1], Map.of(), true);
    var first = list(state, "turns").get(0);
    assertEquals("我按座位和时段建立唯一约束。", first.get("referenceAnswer"));
    var next = service.run(f[0], f[1], Map.of("turnId", first.get("id"),
      "answer", "数据库限制了重复插入。", "dialogue", true, "exchangeCount", 0), true);
    var turn = list(next, "turns").get(0);
    var exchanges = list(turn, "exchanges");
    assertEquals("数据库限制了重复插入。", exchanges.get(0).get("answer"));
    assertEquals("我会返回 409，提示该时段已预约。", exchanges.get(0).get("referenceAnswer"));
    var acknowledgement = PracticeDialogue.decide(model, next, turn, "嗯，好。");
    assertEquals("发生冲突时接口返回什么。", acknowledgement.text());
    assertEquals("我会返回 409，提示该时段已预约。", acknowledgement.referenceAnswer());
    assertEquals("", turn.get("answer"));
    assertFalse(ModelContext.exchanges(exchanges).get(0).containsKey("referenceAnswer"));
    verify(model).call(contains("FOLLOW_UP 时，附加 referenceAnswer"), any());
  }

  @Test void retestContextLimitKeepsTheSupplementAndOriginalReport() {
    var f = fixture();
    var service = new ProjectPractice(s, projects, practice.model);
    service.maxTurns = 1;
    service.journey = practice.journey;
    var state = service.run(f[0], f[1], Map.of());
    String turnId = str(list(state, "turns").get(0), "id");
    state = service.run(f[0], f[1], Map.of("turnId", turnId, "answer", "原始回答"));
    var gateway = spy(practice.model);
    doThrow(new ModelContext.TooLarge()).when(gateway).report(any());
    var retesting = new PracticeRetest(s, service, gateway);
    var input = Map.<String, Object>of("turnId", turnId, "findingIndex", 0, "answer", "新的补答");
    assertEquals(413, assertThrows(ModelContext.TooLarge.class,
      () -> retesting.run(f[0], f[1], input)).getStatusCode().value());
    var failed = service.get(f[0], f[1]);
    assertEquals(state.get("report"), failed.get("report"));
    assertEquals(0L, failed.get("leaseUntil"));
    var saved = PracticeRetest.object(failed.get("retest"));
    assertEquals("FAILED", saved.get("status"));
    assertEquals("新的补答", saved.get("answer"));
    verify(gateway, times(1)).report(any());
  }
  @ParameterizedTest
  @ValueSource(strings = {"不会", "不知道", "我不会回答", "求答案", "直接告诉我答案", "这道题我不会，请讲解一下。",
    "你直接给我答案吧。", "请你直接告诉我答案", "麻烦您讲解一下这道题"})
  void explicitRequestsTeachWithoutAnotherProgressDecision(String answer) {
    var model = dialogueModel();
    String explanation = "假设请求超时，以同一幂等键重试并读取已保存结果。去重记录应与业务写入一致；跨服务副作用仍需核对或补偿。";
    doReturn(Map.of("reply", explanation)).when(model).call(anyString(), any());
    var turn = new LinkedHashMap<String, Object>(Map.of("topic", "幂等", "question", "重试如何避免重复写入？"));
    var reply = PracticeDialogue.decide(model, Map.of("project", Map.of()), turn, answer);
    assertFalse(reply.advance());
    assertTrue(reply.explained());
    assertEquals(explanation, reply.text());
    verify(model, times(1)).call(contains("只返回"), argThat(data ->
      data instanceof Map<?, ?> input && answer.equals(input.get("latestAnswer")) && turn.get("question").equals(input.get("question"))));
    var demo = PracticeDialogue.decide(practice.model, Map.of(), turn, answer);
    assertFalse(demo.advance());
    assertTrue(demo.explained());
    assertTrue(demo.text().startsWith("规则示例"));
    assertTrue(demo.text().contains("同一请求键"));
    assertTrue(demo.text().contains("跨服务"));
    assertTrue(demo.text().length() <= 300);
  }

  @ParameterizedTest
  @ValueSource(strings = {"没听懂，请澄清题意，不是要答案。", "我不知道你问的题意是什么，请换个说法讲一下问题而不是给出答案。",
    "不会重复消费", "不知道结果是否提交", "你先不要告诉我答案", "他说：‘你直接给我答案吧。’"})
  void clarificationAndTechnicalNegationsDoNotTriggerTeaching(String answer) {
    var turn = new LinkedHashMap<String, Object>(Map.of("question", "如何处理重复请求？"));
    var model = dialogueModel();
    doReturn(Map.of("decision", "FOLLOW_UP", "reply", "这道题问的是请求去重，可以说说判断依据。"))
      .when(model).call(anyString(), any());
    var reply = PracticeDialogue.decide(model, Map.of("project", Map.of()), turn, answer);
    assertFalse(reply.advance());
    assertFalse(reply.explained());
    verify(model).call(contains("不会重复消费"), any());
    var demo = PracticeDialogue.decide(practice.model, Map.of(), turn, answer);
    assertFalse(demo.advance());
    assertFalse(demo.explained());
  }

  @Test void liveModelRecognizesNonFormulaicRequestsFromLatestUtterance() {
    var model = dialogueModel();
    String answer = "关于这个机制我确实答不出来，希望你先给一个参考解法。";
    doReturn(Map.of("decision", "EXPLAIN", "reply", "假设使用稳定请求键，重复提交可读取原结果；写入与去重记录应保持一致。", "evidence", "我确实答不出来"))
      .when(model).call(anyString(), any());
    var turn = new LinkedHashMap<String, Object>(Map.of("question", "如何处理重复请求？"));
    var reply = PracticeDialogue.decide(model, Map.of("project", Map.of()), turn, answer);
    assertFalse(reply.advance());
    assertTrue(reply.explained());
    verify(model).call(contains("只能来自latestAnswer"), argThat(data ->
      data instanceof Map<?, ?> input && answer.equals(input.get("latestAnswer"))));
  }

  @Test void explanationEvidenceMustBeNonemptyAndFromLatestAnswerOnly() {
    var prior = List.<Map<String, Object>>of(Map.of("answer", "请告诉我答案", "reply", "我先解释题意。"));
    var reply = PracticeDialogue.parse(Map.of("decision", "EXPLAIN", "reply", "讲".repeat(300), "evidence", "不会"), prior, "不会");
    assertFalse(reply.advance());
    assertTrue(reply.explained());
    for (Object evidence : List.of("请告诉我答案", "我先解释题意", "不知道", " 不会 ", " ", 12)) {
      assertThrows(ResponseStatusException.class, () -> PracticeDialogue.parse(
        Map.of("decision", "EXPLAIN", "reply", "示例讲解", "evidence", evidence), prior, "不会"));
    }
    assertThrows(ResponseStatusException.class, () -> PracticeDialogue.parse(
      Map.of("decision", "EXPLAIN", "reply", "讲".repeat(301), "evidence", "不会"), prior, "不会"));
    assertThrows(ResponseStatusException.class, () -> PracticeDialogue.parse(
      Map.of("decision", "ADVANCE", "reply", "好的", "evidence", "不会"), prior, "不会"));
    var detailed = List.<Map<String, Object>>of(Map.of("answer", "使用唯一键保存请求结果"));
    assertTrue(PracticeDialogue.parse(Map.of("decision", "ADVANCE", "reply", "好的", "evidence", "唯一键保存请求结果"), detailed, "重复返回原结果").advance());
  }

  @Test void advancingPastSomeoneElsesResponsibilityDoesNotMarkAnIndependentAnswer() {
    String boundary = "这部分由同事负责，我没有参与实现。";
    var reply = PracticeDialogue.parse(Map.of("decision", "ADVANCE", "reply", "我们继续。", "evidence", boundary,
      "answeredIndependently", false), List.of(), boundary);
    assertTrue(reply.advance());
    assertFalse(reply.answeredIndependently());
  }

  @ParameterizedTest
  @ValueSource(strings = {"明白了", "我学会了", "听懂了", "我已经理解了", "好的，我懂了，下一题吧", "这下明白了，我们继续下一题吧",
    "学会了，下一题吧", "学会了，你下一题吧。", "我学会了，你继续下一题吧", "嗯，学会了，请你出下一题吧", "懂了，咱们继续下一题吧",
    "我学会了，继续吧。", "学会了，继续", "我懂了，你继续吧", "嗯，听懂了，我们继续吧", "我明白了，可以继续了",
    "我已经理解了，请您接着问吧", "这下我听明白了，咱们继续下一题吧", "我学会了，谢谢老师，继续吧", "好的，我懂了，继续吧，谢谢",
    "听懂了呀，接着来吧", "我学会了啦，下一题吧", "我懂了，请继续问下一个问题吧",
    "OK，我学会了下一题吧。", "理解了，已经全部都理解了。", "嗯嗯，完全听懂了，继续吧。"})
  void understandingConfirmationOnlyAdvancesDuringTeaching(String answer) {
    var turn = Map.<String, Object>of("question", "如何处理重复请求？", "explanation", "假设使用稳定请求键。");
    var model = dialogueModel();
    assertTrue(PracticeDialogue.parseLearning(Map.of("decision", "LEARNED", "reply", "好的", "evidence", answer), answer).advance());
    var reply = PracticeDialogue.decide(model, Map.of("project", Map.of()), turn, answer);
    assertTrue(reply.advance());
    assertFalse(reply.explained());
    verify(model, never()).call(anyString(), any());
    assertTrue(PracticeDialogue.decide(practice.model, Map.of(), turn, answer).advance());
    assertFalse(PracticeDialogue.decide(practice.model, Map.of(), Map.of("question", turn.get("question")), answer).advance());
  }

  @ParameterizedTest
  @ValueSource(strings = {"还没懂", "明白了，但是为什么要先提交事务？", "懂了？", "请继续下一题", "同一请求键先查已有结果再写入，跨服务还需要核对状态或者补偿",
    "你下一题吧", "哎呀，做下一题吧。", "没学会，你下一题吧", "学会了，你下一题吧，不过还有疑问", "学会了？你下一题吧", "你说学会了就下一题吧",
    "继续吧", "可以继续了", "我还没学会，继续讲吧", "我学会了？继续吧", "我学会了吗，继续吧", "我学会了，继续讲解这道题吧",
    "我学会了，不过为什么要这样做", "我好像学会了，继续吧", "如果我学会了，就继续吧", "等我学会了再继续", "你说我学会了，继续吧", "他说‘我学会了，继续吧’"})
  void questionsAndRestatedAnswersStayInTeaching(String answer) {
    var model = dialogueModel();
    var turn = Map.<String, Object>of("question", "如何处理重复请求？", "explanation", "先查询持久化结果。");
    String explanation = "换个例子，假设请求超时后重试，先用原请求键核对是否已完成。还有不懂的可以继续问。";
    doReturn(Map.of("decision", "EXPLAIN", "reply", explanation)).when(model).call(anyString(), any());
    var reply = PracticeDialogue.decide(model, Map.of("project", Map.of()), turn, answer);
    assertFalse(reply.advance());
    assertTrue(reply.explained());
    assertEquals(explanation, reply.text());
    verify(model).call(contains("没有尚未解决的疑问"), argThat(data ->
      data instanceof Map<?, ?> input && turn.get("explanation").equals(input.get("currentExplanation"))));
    assertFalse(PracticeDialogue.decide(practice.model, Map.of(), turn, answer).advance());
  }

  @Test void learningCannotBorrowConfirmationOrUseTheNormalAdvanceDecision() {
    assertTrue(PracticeDialogue.parseLearning(Map.of("decision", "LEARNED", "reply", "好的", "evidence", "学会了"),
      "你这样一解释，我确实学会了这个处理方法。").advance());
    for (String evidence : List.of("我学会了", "我学会了，继续吧。"))
      assertTrue(PracticeDialogue.parseLearning(Map.of("decision", "LEARNED", "reply", "好的", "evidence", evidence),
        "我学会了，继续吧。").advance());
    for (String answer : List.of("还没懂", "继续吧"))
      assertThrows(ResponseStatusException.class, () -> PracticeDialogue.parseLearning(
        Map.of("decision", "LEARNED", "reply", "好的", "evidence", "懂了"), answer));
    assertThrows(ResponseStatusException.class, () -> PracticeDialogue.parseLearning(
      Map.of("decision", "ADVANCE", "reply", "好的", "evidence", "明白了"), "明白了"));
    for (Object evidence : List.of(" ", 12, "懂".repeat(241)))
      assertThrows(ResponseStatusException.class, () -> PracticeDialogue.parseLearning(
        Map.of("decision", "LEARNED", "reply", "好的", "evidence", evidence), "我学会了，继续吧。"));
  }

  @ParameterizedTest
  @CsvSource({"我已经全部都理解了，你怎么还问？,我已经全部都理解了", "我听懂了，不用再讲了，继续吧。,我听懂了"})
  void unrelatedRemarksDoNotInvalidateSpokenLearningConfirmation(String answer, String evidence) {
    var model = dialogueModel();
    var turn = Map.<String, Object>of("question", "如何处理重复请求？", "explanation", "先查询持久化结果。");
    doReturn(Map.of("decision", "LEARNED", "reply", "好的，我们继续。", "evidence", evidence))
      .when(model).call(anyString(), any());
    assertTrue(PracticeDialogue.decide(model, Map.of("project", Map.of()), turn, answer).advance());
    verify(model).call(contains("与本题无关的反问"), any());
  }

  @ParameterizedTest
  @CsvSource({"好的,好的", "继续吧,继续吧", "懂了，但还有疑问,懂了", "懂了？,懂了", "我没学会了，继续吧,学会了",
    "我学会了，不过为什么要这样做,学会了", "我学会了，先别继续,学会了", "我学会了，再讲一下吧,学会了",
    "我学会了，继续讲解这道题吧,学会了", "我学会了，请接着解释这个例子,学会了", "我不认为我学会了，继续讲吧,学会了",
    "我没有学会，等我学会了再继续,学会了", "我好像学会了，继续吧,学会了", "如果我学会了，就继续吧,学会了", "等我学会了再继续,学会了",
    "你说我学会了，继续吧,学会了", "他说‘我学会了，继续吧’,学会了", "我已经把这个流程理顺了,我已经把这个流程理顺了",
    "OK，我学会了，不过为什么要先提交事务？,我学会了", "理解了，但我还没学会怎么去重。,理解了"})
  void uncertainLearningEvidenceAsksForClarificationInsteadOfFailing(String answer, String evidence) {
    var model = dialogueModel();
    doReturn(Map.of("decision", "LEARNED", "reply", "我们进入下一题", "evidence", evidence))
      .when(model).call(anyString(), any());
    var turn = Map.<String, Object>of("question", "如何处理重复请求？", "explanation", "先查询持久化结果。");
    var reply = PracticeDialogue.decide(model, Map.of("project", Map.of()), turn, answer);
    assertFalse(reply.advance());
    assertFalse(reply.explained());
    assertFalse(reply.text().contains("下一题"));
    var parsed = PracticeDialogue.parseLearning(Map.of("decision", "LEARNED", "reply", "我们进入下一题", "evidence", evidence), answer);
    assertFalse(parsed.advance());
    assertFalse(parsed.explained());
    assertTrue(parsed.text().contains("这道题已经理解了吗"));
  }

  @Test void teachingWaitsForLearningOnEveryTurnAndKeepsUnassistedEvidence() {
    var f = fixture();
    var state = practice.run(f[0], f[1], Map.of());
    String firstId = str(list(state, "turns").get(0), "id");
    state = practice.run(f[0], f[1], Map.of("turnId", firstId, "dialogue", true, "exchangeCount", 0, "answer", "使用唯一键。"));
    var answers = List.of("不会", "求答案", "不知道", "请告诉我答案", "这道题我不会，请讲解一下。");
    for (int i = 0; i < answers.size(); i++) {
      var turn = list(state, "turns").get(i);
      state = practice.run(f[0], f[1], Map.of("turnId", turn.get("id"), "dialogue", true,
        "exchangeCount", PracticeDialogue.count(turn), "answer", answers.get(i)));
      var saved = list(state, "turns").get(i);
      String explanation = str(saved, "explanation");
      assertTrue(explanation.startsWith("规则示例"));
      assertEquals(explanation, PracticeDialogue.currentPrompt(saved));
      assertEquals("", str(saved, "answer"));
      assertEquals("ACTIVE", state.get("status"));
      assertFalse(state.containsKey("report"));
      assertEquals(i + 1, list(state, "turns").size());
      assertEquals(state, practice.get(f[0], f[1]));
      assertEquals(state, practice.run(f[0], f[1], Map.of()));
      for (String followUp : List.of("还没懂，再解释一下", "同一请求键先查已有结果再写入，跨服务还需要核对状态或者补偿", "好的")) {
        state = practice.run(f[0], f[1], Map.of("turnId", turn.get("id"), "dialogue", true,
          "exchangeCount", PracticeDialogue.count(saved), "answer", followUp));
        saved = list(state, "turns").get(i);
        assertEquals("", saved.get("answer"));
        assertEquals(i + 1, list(state, "turns").size());
        assertEquals("ACTIVE", state.get("status"));
      }
      state = practice.run(f[0], f[1], Map.of("turnId", turn.get("id"), "dialogue", true,
        "exchangeCount", PracticeDialogue.count(saved), "answer", "我学会了，下一题"));
      saved = list(state, "turns").get(i);
      assertEquals(i == 0 ? "使用唯一键。\n不会" : answers.get(i), saved.get("answer"));
      if (i < 4) {
        assertEquals("ACTIVE", state.get("status"));
        assertEquals(i + 2, list(state, "turns").size());
        assertFalse(list(state, "turns").get(i + 1).containsKey("explanation"));
      }
    }
    assertEquals("COMPLETED", state.get("status"));
    var findings = list(PracticeRetest.object(state.get("report")), "findings");
    assertEquals(5, findings.size());
    for (int i = 0; i < findings.size(); i++)
      assertEquals(list(state, "turns").get(i).get("answer"), list(findings.get(i), "evidence").get(0).get("quote"));
  }
  @Test void uncertainLearningKeepsTheRoundActiveAndCanBeConfirmedLater() {
    var f = fixture();
    var model = dialogueModel();
    var service = new ProjectPractice(s, projects, model);
    service.maxTurns = 1;
    service.journey = practice.journey;
    doReturn(new ModelService.GeneratedQuestion("如何处理重复请求？", "幂等")).when(model).firstDeepQuestion(any());
    doReturn(Map.of("reply", "假设用同一请求键查询已保存结果。"))
      .doReturn(Map.of("decision", "LEARNED", "reply", "我们进入下一题", "evidence", "这个流程理顺了"))
      .when(model).call(anyString(), any());
    doReturn(Map.of("mode", "live", "findings", List.of())).when(model).report(any());
    var state = service.run(f[0], f[1], Map.of());
    String turnId = str(list(state, "turns").get(0), "id");
    state = service.run(f[0], f[1], Map.of("turnId", turnId, "dialogue", true, "exchangeCount", 0, "answer", "不会"));
    var initial = list(state, "turns").get(0);
    state = service.run(f[0], f[1], Map.of("turnId", turnId, "dialogue", true, "exchangeCount", 1, "answer", "我已经把这个流程理顺了"));
    assertEquals("ACTIVE", state.get("status"));
    assertFalse(state.containsKey("pendingExchange"));
    assertFalse(state.containsKey("report"));
    assertEquals(1, list(state, "turns").size());
    var turn = list(state, "turns").get(0);
    assertEquals(turnId, turn.get("id"));
    assertEquals("", turn.get("answer"));
    assertEquals(initial.get("explanation"), turn.get("explanation"));
    assertEquals(2, PracticeDialogue.count(turn));
    assertTrue(PracticeDialogue.currentPrompt(turn).contains("这道题已经理解了吗"));
    assertEquals(state, service.run(f[0], f[1], Map.of()));
    verify(model, never()).question(any());
    verify(model, never()).report(any());
    state = service.run(f[0], f[1], Map.of("turnId", turnId, "dialogue", true, "exchangeCount", 2, "answer", "我学会了，继续吧。"));
    assertEquals("COMPLETED", state.get("status"));
    turn = list(state, "turns").get(0);
    assertEquals("不会", turn.get("answer"));
    assertEquals(3, PracticeDialogue.count(turn));
    assertEquals("我学会了，继续吧。", list(turn, "exchanges").get(2).get("answer"));
    verify(model, times(2)).call(anyString(), any());
    verify(model, times(1)).report(any());
  }

  @Test void failedSpokenAnswerRequestResumesAsExplanationOnTheSameTurn() {
    var f = fixture();
    var model = dialogueModel();
    var service = new ProjectPractice(s, projects, model);
    service.maxTurns = 2;
    service.journey = practice.journey;
    doReturn(new ModelService.GeneratedQuestion("重试如何避免重复写入？", "幂等")).when(model).firstDeepQuestion(any());
    String utterance = "你直接给我答案吧。";
    String explanation = "假设同一个请求超时后重试，可用相同幂等键查找已经保存的结果。还有不懂的可以继续问。";
    doReturn(Map.of("decision", "FOLLOW_UP", "reply", "可以先说说你会怎样判断请求已完成。"))
      .doThrow(new IllegalStateException("temporary model error"))
      .doReturn(Map.of("reply", explanation)).when(model).call(anyString(), any());
    var state = service.run(f[0], f[1], Map.of());
    String turnId = str(list(state, "turns").get(0), "id");
    service.run(f[0], f[1], Map.of("turnId", turnId, "dialogue", true, "exchangeCount", 0, "answer", "我答呀。"));
    assertThrows(ResponseStatusException.class, () -> service.run(f[0], f[1],
      Map.of("turnId", turnId, "dialogue", true, "exchangeCount", 1, "answer", utterance)));
    var failed = service.get(f[0], f[1]);
    assertEquals("FAILED", failed.get("status"));
    assertEquals(utterance, PracticeRetest.object(failed.get("pendingExchange")).get("answer"));

    var recovered = service.run(f[0], f[1], Map.of());
    assertEquals("ACTIVE", recovered.get("status"));
    assertFalse(recovered.containsKey("pendingExchange"));
    assertEquals(1, list(recovered, "turns").size());
    var turn = list(recovered, "turns").get(0);
    assertEquals(turnId, turn.get("id"));
    assertEquals("", turn.get("answer"));
    assertEquals(explanation, turn.get("explanation"));
    assertEquals(2, PracticeDialogue.count(turn));
    assertEquals(utterance, list(turn, "exchanges").get(1).get("answer"));
    assertEquals(recovered, service.run(f[0], f[1], Map.of()));
    verify(model, times(2)).call(contains("只返回"), any());
    verify(model, never()).question(any());
    verify(model, never()).report(any());
  }

  @Test void failedFollowUpResumesTheSameTeachingTurnWithoutDuplicatingExchanges() {
    var f = fixture();
    var model = dialogueModel();
    var service = new ProjectPractice(s, projects, model);
    service.maxTurns = 1;
    service.journey = practice.journey;
    doReturn(new ModelService.GeneratedQuestion("重试如何避免重复写入？", "幂等")).when(model).firstDeepQuestion(any());
    doReturn(Map.of("reply", "假设重复请求使用同一请求键。")).when(model).call(anyString(), any());
    var state = service.run(f[0], f[1], Map.of());
    String turnId = str(list(state, "turns").get(0), "id");
    state = service.run(f[0], f[1], Map.of("turnId", turnId, "dialogue", true, "exchangeCount", 0, "answer", "不会"));
    String clarification = "假设首次请求已完成，重试只读取保存的结果，不再执行写入。";
    doThrow(new IllegalStateException("teaching failed"))
      .doReturn(Map.of("decision", "EXPLAIN", "reply", clarification)).when(model).call(anyString(), any());
    assertThrows(ResponseStatusException.class, () -> service.run(f[0], f[1],
      Map.of("turnId", turnId, "dialogue", true, "exchangeCount", 1, "answer", "还没懂，重试怎么读取结果？")));
    var failed = service.get(f[0], f[1]);
    assertEquals("FAILED", failed.get("status"));
    assertEquals(1, PracticeDialogue.count(list(failed, "turns").get(0)));
    state = service.run(f[0], f[1], Map.of());
    var turn = list(state, "turns").get(0);
    assertEquals("ACTIVE", state.get("status"));
    assertEquals(turnId, turn.get("id"));
    assertEquals("", turn.get("answer"));
    assertEquals(2, PracticeDialogue.count(turn));
    assertEquals(clarification, turn.get("explanation"));
    assertEquals(state, service.run(f[0], f[1], Map.of()));
    verify(model, never()).question(any());
    verify(model, never()).report(any());
  }

  @ParameterizedTest
  @CsvSource({"1,学会了，你下一题吧。", "2,学会了，你下一题吧。", "1,我学会了，继续吧。", "2,我学会了，继续吧。",
    "1,理解了，已经全部都理解了。", "2,OK，我学会了下一题吧。"})
  void failedSpokenConfirmationResumesWithoutAnotherLearningModelCall(int maxTurns, String confirmation) {
    var f = fixture();
    var model = dialogueModel();
    var service = new ProjectPractice(s, projects, model);
    service.maxTurns = maxTurns;
    service.journey = practice.journey;
    doReturn(new ModelService.GeneratedQuestion("如何处理重复请求？", "幂等")).when(model).firstDeepQuestion(any());
    doReturn(Map.of("reply", "假设用同一请求键查询已保存结果。")).when(model).call(anyString(), any());
    doReturn(new ModelService.GeneratedQuestion("如何验证超时场景？", "验证方法")).when(model).question(any());
    doReturn(Map.of("mode", "live", "findings", List.of())).when(model).report(any());
    var state = service.run(f[0], f[1], Map.of());
    String turnId = str(list(state, "turns").get(0), "id");
    state = service.run(f[0], f[1], Map.of("turnId", turnId, "dialogue", true, "exchangeCount", 0, "answer", "不会"));
    var row = s.one("SELECT body FROM project_practice_rounds WHERE user_id=? AND round_id=?", f[0], state.get("roundId"));
    var saved = s.decode(row.get("body"));
    saved.put("pendingExchange", Map.of("turnId", turnId, "exchangeCount", 1, "answer", confirmation));
    s.db.update("UPDATE project_practice_rounds SET body=?,status='FAILED',lease_until=0 WHERE user_id=? AND round_id=?",
      s.encode(saved), f[0], state.get("roundId"));
    var recovered = service.run(f[0], f[1], Map.of());
    assertEquals(maxTurns == 1 ? "COMPLETED" : "ACTIVE", recovered.get("status"));
    assertFalse(recovered.containsKey("pendingExchange"));
    assertEquals(maxTurns, list(recovered, "turns").size());
    var turn = list(recovered, "turns").get(0);
    assertEquals(turnId, turn.get("id"));
    assertEquals("不会", turn.get("answer"));
    assertEquals(2, PracticeDialogue.count(turn));
    assertEquals(confirmation, list(turn, "exchanges").get(1).get("answer"));
    assertEquals(recovered, service.run(f[0], f[1], Map.of()));
    verify(model, times(1)).call(anyString(), any());
    verify(model, times(maxTurns == 1 ? 0 : 1)).question(any());
    verify(model, times(maxTurns == 1 ? 1 : 0)).report(any());
  }

  @ParameterizedTest
  @ValueSource(ints = {1, 2})
  void failedNextQuestionOrReportRetriesCheckpointWithoutRepeatingTeaching(int maxTurns) {
    for (boolean resubmit : List.of(false, true)) {
      var f = fixture();
      var model = dialogueModel();
      var service = new ProjectPractice(s, projects, model);
      service.maxTurns = maxTurns;
      service.journey = practice.journey;
      doReturn(new ModelService.GeneratedQuestion("重试如何避免重复写入？", "幂等")).when(model).firstDeepQuestion(any());
      String explanation = "假设同一请求带稳定幂等键，可查询之前结果；业务写入和去重记录应保持一致，跨服务副作用还需核对。";
      doReturn(Map.of("reply", explanation)).when(model).call(anyString(), any());
      if (maxTurns == 1) doThrow(new IllegalStateException("report failed"))
        .doReturn(Map.of("mode", "live", "findings", List.of())).when(model).report(any());
      else doThrow(new IllegalStateException("question failed"))
        .doReturn(new ModelService.GeneratedQuestion("如何验证超时场景？", "验证方法")).when(model).question(any());
      var state = service.run(f[0], f[1], Map.of());
      String turnId = str(list(state, "turns").get(0), "id");
      state = service.run(f[0], f[1], Map.of("turnId", turnId, "dialogue", true, "exchangeCount", 0, "answer", "不会"));
      assertEquals("ACTIVE", state.get("status"));
      assertEquals(1, list(state, "turns").size());
      verify(model, never()).question(any());
      verify(model, never()).report(any());
      assertThrows(ResponseStatusException.class, () -> service.run(f[0], f[1],
        Map.of("turnId", turnId, "dialogue", true, "exchangeCount", 1, "answer", "我学会了")));
      var failed = service.get(f[0], f[1]);
      assertEquals("FAILED", failed.get("status"));
      assertFalse(failed.containsKey("pendingExchange"));
      var saved = list(failed, "turns").get(0);
      assertEquals("不会", saved.get("answer"));
      assertEquals(explanation, saved.get("explanation"));
      assertEquals(2, PracticeDialogue.count(saved));
      var recovered = service.run(f[0], f[1], resubmit
        ? Map.of("turnId", turnId, "dialogue", true, "exchangeCount", 2, "answer", "我学会了") : Map.of());
      assertEquals(maxTurns == 1 ? "COMPLETED" : "ACTIVE", recovered.get("status"));
      assertEquals(maxTurns, list(recovered, "turns").size());
      assertEquals(saved, list(recovered, "turns").get(0));
      assertEquals(recovered, service.run(f[0], f[1], Map.of()));
      verify(model, times(1)).call(anyString(), any());
    }
  }

  @ParameterizedTest
  @ValueSource(booleans = {false, true})
  void exampleOpeningIgnoresPreviouslyAnsweredQuestions(boolean resume) {
    String user = fixture()[0];
    String projectId = ExampleQuestions.projectId(user, "booking");
    var project = projects.openExample(user, projectId, Map.of("name", "校园自习室预约系统",
      "implementation", "预约表记录座位、时段和状态，同一座位同一时段只允许一条有效预约。"));
    var example = Map.<String, Object>of("example", true, "exampleScenario", "booking");
    var repeated = ExampleQuestions.fallbackFor(example).get(1);
    var answered = Map.of("id", id(), "question", repeated.question(), "topic", repeated.topic(),
      "answer", repeated.referenceAnswer(), "answeredIndependently", true,
      "exchanges", List.of(Map.of("answer", repeated.referenceAnswer(), "reply", "下一题。")));
    String completedRoundId = id();
    s.db.update("INSERT INTO project_practice_rounds(user_id,project_id,round_id,round_number,started_at,status,body) VALUES (?,?,?,?,?,?,?)",
      user, projectId, completedRoundId, 1, now(), "COMPLETED", s.encode(Map.of("modelMode", "live", "turns", List.of(answered))));
    String failedRoundId = id();
    var history = PracticeRoundHistory.load(s, user, projectId, "live");
    assertEquals(PracticeRoundHistory.ANSWERED_INDEPENDENTLY, history.get(0).get("outcome"));
    if (resume) s.db.update("INSERT INTO project_practice_rounds(user_id,project_id,round_id,round_number,started_at,status,body) VALUES (?,?,?,?,?,?,?)",
      user, projectId, failedRoundId, 2, now(), "FAILED", s.encode(Map.of("modelMode", "live", "turns", List.of(),
        "project", project, "kind", "PRACTICE", "maxTurns", 5, "practiceHistory", history)));

    var model = dialogueModel();
    model.qualityReviewEnabled = true;
    doAnswer(call -> {
      assertFalse(((String) call.getArgument(0)).startsWith(ModelQuality.QUESTION_RULE));
      assertFalse(PracticeRetest.object(call.getArgument(1)).containsKey("practiceHistory"));
      return Map.of("question", repeated.question(), "topic", repeated.topic(),
        ExampleReference.FIELD, repeated.referenceAnswer());
    }).when(model).call(anyString(), any());
    var service = new ProjectPractice(s, projects, model);
    service.maxTurns = 5;
    service.journey = practice.journey;
    var state = service.run(user, projectId,
      resume ? Map.of() : Map.of("restart", true, "roundId", completedRoundId), true);

    assertEquals("ACTIVE", state.get("status"));
    assertEquals(2L, state.get("roundNumber"));
    if (resume) assertEquals(failedRoundId, state.get("roundId"));
    assertFalse(state.containsKey("practiceHistory"));
    var opener = list(state, "turns").get(0);
    assertEquals(repeated.question(), opener.get("question"));
    assertEquals(repeated.referenceAnswer(), opener.get(ExampleReference.FIELD));
    verify(model, times(1)).call(anyString(), any());
  }

  @ParameterizedTest
  @ValueSource(booleans = {true, false})
  void resumesFinalAnswerAfterMalformedDialogueDecisions(boolean repairIsValid) {
    var f = fixture();
    var model = dialogueModel();
    var service = new ProjectPractice(s, projects, model);
    service.maxTurns = 1;
    service.journey = practice.journey;
    doReturn(new ModelService.GeneratedQuestion("请说明任务重启后如何避免重复发送。", "任务恢复")).when(model).firstDeepQuestion(any());
    doReturn(Map.of("mode", "live", "findings", List.of())).when(model).report(any());
    var state = service.run(f[0], f[1], Map.of());
    var turn = list(state, "turns").get(0);
    String answer = "我会依赖通知服务的幂等键去重。若无此机制，则标记为未知并人工核对，绝不盲目重试以防重复发送。";
    String first = "我会记录未知结果，并将任务交给人工核对。";
    String second = "如果没有回调或结果日志，标记未知并暂停自动重试。";
    turn.put("exchanges", List.of(Map.of("answer", first, "reply", "怎么确认发送结果？"),
      Map.of("answer", second, "reply", "如何避免通知重复发送？")));
    state.put("pendingExchange", Map.of("turnId", turn.get("id"), "exchangeCount", 2, "answer", answer));
    s.db.update("UPDATE project_practice_rounds SET body=?,status='FAILED',lease_until=0 WHERE user_id=? AND round_id=?",
      s.encode(state), f[0], state.get("roundId"));
    doReturn(Map.of("reply", "我们继续。"))
      .doReturn(repairIsValid
        ? Map.of("decision", "ADVANCE", "reply", "我们开始复盘。", "evidence", "我会依赖通知服务的幂等键去重")
        : Map.of("decision", "EXPLAIN", "reply", "我来说明如何设计幂等。", "evidence", "请告诉我答案"))
      .when(model).call(anyString(), any());

    var resumed = service.run(f[0], f[1], Map.of());
    var completed = list(resumed, "turns").get(0);
    assertEquals("COMPLETED", resumed.get("status"));
    assertEquals(state.get("roundId"), resumed.get("roundId"));
    assertFalse(resumed.containsKey("pendingExchange"));
    assertEquals(3, PracticeDialogue.count(completed));
    assertEquals(String.join("\n", first, second, answer), completed.get("answer"));
    assertEquals(repairIsValid, completed.get("answeredIndependently"));
    assertFalse(completed.containsKey("explanation"));
    verify(model, times(2)).call(anyString(), any());
    verify(model).call(contains("上次进度判断未通过"), argThat(data ->
      data instanceof Map<?, ?> input && input.get("validationError") instanceof String reason && reason.contains("decision")));
    verify(model).report(any());
  }
}
