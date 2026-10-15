package com.projectprobe;

import static com.projectprobe.Store.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.io.*;
import java.nio.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import org.apache.pdfbox.pdmodel.*;
import org.apache.pdfbox.pdmodel.font.*;
import org.apache.poi.xwpf.usermodel.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.server.ResponseStatusException;

@SpringBootTest(
  properties = {
    "spring.datasource.url=jdbc:h2:mem:input-tests;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
    "app.model-mode=demo",
    "app.payment.mode=mock",
    "app.speech-enabled=false",
  }
)
@AutoConfigureMockMvc
class InputRegressionTest {

  @Autowired
  Store s;

  @Autowired
  InputService inputs;

  @Autowired
  MockMvc mvc;

  @Autowired
  Auth auth;

  @Autowired
  ProjectService projects;

  @Autowired
  PaymentService payments;

  @Autowired
  TrainingService trainings;

  String user() {
    String id = id();
    s.db.update(
      "INSERT INTO app_users VALUES (?,?,?,?)",
      id,
      "input-" + id,
      "unused",
      now()
    );
    return id;
  }

  MockMultipartFile file(String name, byte[] bytes) {
    return new MockMultipartFile(
      "file",
      name,
      "application/octet-stream",
      bytes
    );
  }

  byte[] wav(int rate, int seconds) {
    var buffer = ByteBuffer.allocate(44 + rate * 2 * seconds).order(
      ByteOrder.LITTLE_ENDIAN
    );
    buffer
      .putInt(0x46464952)
      .putInt(buffer.capacity() - 8)
      .putInt(0x45564157)
      .putInt(0x20746d66)
      .putInt(16)
      .putShort((short) 1)
      .putShort((short) 1);
    buffer
      .putInt(rate)
      .putInt(rate * 2)
      .putShort((short) 2)
      .putShort((short) 16)
      .putInt(0x61746164)
      .putInt(rate * 2 * seconds);
    return buffer.array();
  }

  @Test
  void readsTextAndRedactsContacts() {
    String text =
      "合成测试简历\n项目：预约系统，我负责接口。\n手机13812345678，邮箱person@example.com";
    String result = inputs.parser.read(
      file("resume.txt", text.getBytes(StandardCharsets.UTF_8))
    );
    assertTrue(result.contains("预约系统"));
    assertFalse(result.contains("13812345678"));
    assertFalse(result.contains("person@example.com"));
  }

  @Test
  void exhaustedParsingQuotaRejectsBeforeReadingDocument() throws Exception {
    String user = user();
    var upload = spy(
      file(
        "resume.txt",
        "合成项目简历，我负责接口和测试，尚未执行压测。".getBytes(
          StandardCharsets.UTF_8
        )
      )
    );
    s.db.update(
      "INSERT INTO input_limits(user_id,kind,window_start,attempts) VALUES (?,'RESUME_PARSE',?,60)",
      user,
      now()
    );
    assertEquals(
      429,
      assertThrows(ResponseStatusException.class, () ->
        inputs.resume(user, upload)
      )
        .getStatusCode()
        .value()
    );
    verify(upload, never()).getBytes();
  }

  @Test
  void readsDocxParagraphAndTable() throws Exception {
    try (
      var document = new XWPFDocument();
      var output = new ByteArrayOutputStream()
    ) {
      document
        .createParagraph()
        .createRun()
        .setText("Synthetic project resume: reservation service");
      document
        .createTable(1, 1)
        .getRow(0)
        .getCell(0)
        .setText("Owned API and concurrency tests");
      document.write(output);
      assertTrue(
        inputs.parser
          .read(file("resume.docx", output.toByteArray()))
          .contains("concurrency tests")
      );
    }
  }

  @Test
  void readsPdf() throws Exception {
    try (
      var document = new PDDocument();
      var output = new ByteArrayOutputStream()
    ) {
      var page = new PDPage();
      document.addPage(page);
      try (var stream = new PDPageContentStream(document, page)) {
        stream.beginText();
        stream.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA), 12);
        stream.newLineAtOffset(40, 700);
        stream.showText("Synthetic resume - I implemented reservation API");
        stream.endText();
      }
      document.save(output);
      assertTrue(
        inputs.parser
          .read(file("resume.pdf", output.toByteArray()))
          .contains("reservation API")
      );
    }
  }

  @Test
  void rejectsUnsupportedAndSpoofedFile() {
    assertThrows(ResponseStatusException.class, () ->
      inputs.parser.read(file("x.exe", new byte[30]))
    );
    assertThrows(ResponseStatusException.class, () ->
      inputs.parser.read(
        file(
          "x.pdf",
          "This is not a pdf document".getBytes(StandardCharsets.UTF_8)
        )
      )
    );
    assertThrows(ResponseStatusException.class, () ->
      inputs.parser.read(file("x.docx", new byte[30]))
    );
  }

  @Test
  void rejectsOversizeAndEmptyText() {
    assertThrows(ResponseStatusException.class, () ->
      inputs.parser.read(file("x.txt", new byte[5 * 1024 * 1024 + 1]))
    );
    assertThrows(ResponseStatusException.class, () ->
      inputs.parser.read(file("x.txt", "short".getBytes()))
    );
    assertThrows(ResponseStatusException.class, () ->
      inputs.parser.read(file("x.txt", "a".repeat(24001).getBytes()))
    );
  }

  @Test
  void rejectsZipBomb() throws Exception {
    try (var output = new ByteArrayOutputStream()) {
      try (var zip = new java.util.zip.ZipOutputStream(output)) {
        zip.putNextEntry(new java.util.zip.ZipEntry("word/document.xml"));
        zip.write(new byte[21 * 1024 * 1024]);
        zip.closeEntry();
      }
      assertThrows(ResponseStatusException.class, () ->
        inputs.parser.read(file("x.docx", output.toByteArray()))
      );
    }
  }

  Map<String, Object> candidate() {
    var p = new LinkedHashMap<String, Object>();
    for (String field : List.of(
      "name",
      "stack",
      "targetRole",
      "background",
      "responsibility",
      "resume",
      "architecture",
      "implementation",
      "problems",
      "verification"
    ))
      p.put(field, "");
    p.put("name", "预约系统");
    p.put("responsibility", "我负责接口");
    p.put("resume", "预约系统，我负责接口");
    p.put("startLine", 2);
    p.put("endLine", 2);
    p.put("fields", Map.of("responsibility", List.of(2)));
    return p;
  }

  ModelService resumeModel(String name) {
    return spy(
      new ModelService(
        s,
        "live",
        "https://model.example/v1",
        "synthetic-key",
        name,
        "test"
      )
    );
  }

  MockMultipartFile resumeFile(String name, String suffix) {
    return file(
      name,
      (
        "仅用于功能验收的合成测试简历\n预约系统，我负责接口\n" + suffix
      ).getBytes(StandardCharsets.UTF_8)
    );
  }

  @Test
  void repeatedResumeAcrossInstancesAndRenamingDoesNotConsumeQuota() {
    String user = user();
    var model = resumeModel("model-a");
    doReturn(Map.of("projects", List.of(candidate())))
      .when(model)
      .call(anyString(), any());
    var service = new InputService(s, model);
    var first = service.resume(user, resumeFile("first.txt", ""));
    assertEquals(false, first.get("duplicate"));
    s.db.update(
      "UPDATE input_limits SET attempts=10 WHERE user_id=? AND kind='RESUME'",
      user
    );
    var second = new InputService(s, model).resume(
      user,
      file(
        "renamed.txt",
        "\uFEFF仅用于功能验收的合成测试简历\r\n预约系统，我负责接口\r\n".getBytes(
          StandardCharsets.UTF_8
        )
      )
    );
    assertEquals(true, second.get("duplicate"));
    assertEquals(first.get("projects"), second.get("projects"));
    assertEquals(first.get("recognizedAt"), second.get("recognizedAt"));
    verify(model, times(1)).call(anyString(), any());
    assertEquals(
      10,
      s.db.queryForObject(
        "SELECT attempts FROM input_limits WHERE user_id=? AND kind='RESUME'",
        Integer.class,
        user
      )
    );
  }

  @Test
  void changedTextAndModelUseFreshRecognition() {
    String user = user();
    var model = resumeModel("model-a");
    doReturn(Map.of("projects", List.of(candidate())))
      .when(model)
      .call(anyString(), any());
    var service = new InputService(s, model);
    service.resume(user, resumeFile("first.txt", ""));
    assertEquals(
      false,
      service
        .resume(user, resumeFile("first.txt", "新增实际经历"))
        .get("duplicate")
    );
    var another = resumeModel("model-b");
    doReturn(Map.of("projects", List.of(candidate())))
      .when(another)
      .call(anyString(), any());
    assertEquals(
      false,
      new InputService(s, another)
        .resume(user, resumeFile("first.txt", ""))
        .get("duplicate")
    );
    verify(model, times(2)).call(anyString(), any());
    verify(another, times(1)).call(anyString(), any());
  }

  @Test
  void identicalResumeDoesNotShareResultsAcrossAccounts() {
    var model = resumeModel("model-a");
    doReturn(Map.of("projects", List.of(candidate())))
      .when(model)
      .call(anyString(), any());
    var service = new InputService(s, model);
    service.resume(user(), resumeFile("first.txt", ""));
    assertEquals(
      false,
      service.resume(user(), resumeFile("first.txt", "")).get("duplicate")
    );
    verify(model, times(2)).call(anyString(), any());
  }

  @Test
  void invalidResultIsNotCachedAndRetryCanSucceed() {
    String user = user();
    var model = resumeModel("model-a");
    var invented = candidate();
    invented.put("startLine", 0);
    doReturn(
      Map.of("projects", List.of(invented)),
      Map.of("projects", List.of(candidate()))
    )
      .when(model)
      .call(anyString(), any());
    var service = new InputService(s, model);
    assertThrows(ResponseStatusException.class, () ->
      service.resume(user, resumeFile("first.txt", ""))
    );
    assertEquals(
      0,
      s.db.queryForObject(
        "SELECT COUNT(*) FROM resume_import_cache WHERE user_id=?",
        Integer.class,
        user
      )
    );
    assertEquals(
      false,
      service.resume(user, resumeFile("first.txt", "")).get("duplicate")
    );
    verify(model, times(2)).call(anyString(), any());
  }

  @Test
  void emptySuccessfulRecognitionIsCached() {
    String user = user();
    var model = resumeModel("model-a");
    doReturn(Map.of("projects", List.of()))
      .when(model)
      .call(anyString(), any());
    var service = new InputService(s, model);
    service.resume(user, resumeFile("first.txt", ""));
    assertEquals(
      true,
      service.resume(user, resumeFile("first.txt", "")).get("duplicate")
    );
    verify(model, times(1)).call(anyString(), any());
  }

  @Test
  void concurrentResumeAcrossInstancesCallsModelOnce() throws Exception {
    String user = user();
    var model = resumeModel("model-a");
    var entered = new CountDownLatch(1);
    var exit = new CountDownLatch(1);
    doAnswer(invocation -> {
      entered.countDown();
      assertTrue(exit.await(5, TimeUnit.SECONDS));
      return Map.of("projects", List.of(candidate()));
    })
      .when(model)
      .call(anyString(), any());
    var pool = Executors.newSingleThreadExecutor();
    try {
      var first = pool.submit(() ->
        new InputService(s, model).resume(user, resumeFile("first.txt", ""))
      );
      assertTrue(entered.await(5, TimeUnit.SECONDS));
      assertEquals(
        409,
        assertThrows(ResponseStatusException.class, () ->
          new InputService(s, model).resume(user, resumeFile("second.txt", ""))
        )
          .getStatusCode()
          .value()
      );
      exit.countDown();
      assertEquals(false, first.get(5, TimeUnit.SECONDS).get("duplicate"));
      assertEquals(
        true,
        new InputService(s, model)
          .resume(user, resumeFile("third.txt", ""))
          .get("duplicate")
      );
      verify(model, times(1)).call(anyString(), any());
      assertEquals(
        1,
        s.db.queryForObject(
          "SELECT attempts FROM input_limits WHERE user_id=? AND kind='RESUME'",
          Integer.class,
          user
        )
      );
    } finally {
      exit.countDown();
      pool.shutdownNow();
    }
  }

  @Test
  void supersededOrExpiredResumeLeaseCannotPopulateCache() {
    for (boolean superseded : List.of(false, true)) {
      String user = user();
      String newToken = id();
      var model = resumeModel("model-a");
      doAnswer(invocation -> {
        if (superseded) s.db.update(
          "UPDATE input_limits SET lease_token=? WHERE user_id=? AND kind='RESUME'",
          newToken,
          user
        );
        else s.db.update(
          "UPDATE input_limits SET lease_until=0 WHERE user_id=? AND kind='RESUME'",
          user
        );
        return Map.of("projects", List.of(candidate()));
      })
        .when(model)
        .call(anyString(), any());
      assertThrows(ResponseStatusException.class, () ->
        new InputService(s, model).resume(user, resumeFile("first.txt", ""))
      );
      assertEquals(
        0,
        s.db.queryForObject(
          "SELECT COUNT(*) FROM resume_import_cache WHERE user_id=?",
          Integer.class,
          user
        )
      );
      if (superseded) assertEquals(
        newToken,
        s
          .one(
            "SELECT lease_token FROM input_limits WHERE user_id=? AND kind='RESUME'",
            user
          )
          .get("lease_token")
      );
    }
  }

  @Test
  void expiredCacheIsIgnoredAndPurged() {
    String user = user();
    var model = resumeModel("model-a");
    doReturn(Map.of("projects", List.of(candidate())))
      .when(model)
      .call(anyString(), any());
    var service = new InputService(s, model);
    service.resume(user, resumeFile("first.txt", ""));
    s.db.update(
      "UPDATE resume_import_cache SET expires_at=0 WHERE user_id=?",
      user
    );
    assertEquals(
      false,
      service.resume(user, resumeFile("first.txt", "")).get("duplicate")
    );
    verify(model, times(2)).call(anyString(), any());
    s.db.update(
      "UPDATE resume_import_cache SET expires_at=0 WHERE user_id=?",
      user
    );
    service.purgeExpiredResumes();
    assertEquals(
      0,
      s.db.queryForObject(
        "SELECT COUNT(*) FROM resume_import_cache WHERE user_id=?",
        Integer.class,
        user
      )
    );
  }

  @Test
  void cacheAppearingDuringClaimSkipsOperationAndQuota() {
    String user = user();
    var reads = new java.util.concurrent.atomic.AtomicInteger();
    assertEquals(
      "cached",
      inputs.limited(
        user,
        "TEST",
        1,
        () -> reads.incrementAndGet() == 1 ? null : "cached",
        () -> {
          fail("must not call model");
          return "unused";
        },
        result -> fail("must not overwrite cache")
      )
    );
    assertEquals(
      0,
      s.db.queryForObject(
        "SELECT COUNT(*) FROM input_limits WHERE user_id=?",
        Integer.class,
        user
      )
    );
  }

  @Test
  void validatesGroundedResumeAndLeavesUnknownEmpty() {
    var result = InputService.validateResume(
      Map.of("projects", List.of(candidate())),
      "合成简历\n预约系统，我负责接口"
    );
    assertEquals(
      "",
      modelObjects(result, "projects", 4).get(0).get("verification")
    );
  }

  @Test
  void clearsUnreliableOptionalFieldsWithoutLosingProject() {
    var p = candidate();
    p.put("stack", "原文没有的框架");
    p.put(
      "fields",
      Map.of("responsibility", List.of(2), "verification", List.of(3))
    );
    var result = InputService.validateResume(
      Map.of("projects", List.of(p)),
      "合成简历\n预约系统，我负责接口\n其他项目压测十万请求"
    );
    var project = modelObjects(result, "projects", 4).get(0);
    assertEquals("", project.get("verification"));
    assertEquals("", project.get("stack"));
    assertEquals("预约系统，我负责接口", project.get("responsibility"));
    assertFalse(((List<?>) result.get("warnings")).isEmpty());
  }

  @Test
  void extractsOriginalLinesDespiteDocxWhitespaceAndModelReformatting()
    throws Exception {
    try (
      var document = new XWPFDocument();
      var output = new ByteArrayOutputStream()
    ) {
      document
        .createParagraph()
        .createRun()
        .setText("合成测试简历，所有数据仅用于功能验证。");
      var title = document.createParagraph().createRun();
      title.setText("Synthetic Memory");
      title.addTab();
      title.setText("Platform | Spring Boot · RabbitMQ · Redis | GitHub SDK");
      document
        .createParagraph()
        .createRun()
        .setText(
          "分布式任务处理：我负责实现异步任务、消费端幂等、手动 ACK 与有限重试。"
        );
      document
        .createParagraph()
        .createRun()
        .setText("关联查询：使用固定数据集测试查询，验证结果待补充。");
      document
        .createParagraph()
        .createRun()
        .setText(
          "Synthetic Tool Router | Java 21 · Lucene · Embedding | GitHub"
        );
      document
        .createParagraph()
        .createRun()
        .setText(
          "工具检索：我负责BM25与向量检索融合，以及工具更新后的向量复用。"
        );
      document
        .createParagraph()
        .createRun()
        .setText("评测方式：自建合成查询集，尚未记录实际指标。");
      document.write(output);
      String text = inputs.parser.read(
        file("synthetic.docx", output.toByteArray())
      );
      var fixtures = java.nio.file.Path.of("target", "test-fixtures");
      java.nio.file.Files.createDirectories(fixtures);
      java.nio.file.Files.write(
        fixtures.resolve("synthetic-resume.docx"),
        output.toByteArray()
      );
      java.nio.file.Files.writeString(
        fixtures.resolve("synthetic-resume.txt"),
        text,
        StandardCharsets.UTF_8
      );
      var modelOutput = Map.<String, Object>of(
        "projects",
        List.of(
          Map.of(
            "name",
            "Synthetic Memory Platform",
            "startLine",
            2,
            "endLine",
            4,
            "stack",
            "Spring Boot·RabbitMQ·Redis",
            "fields",
            Map.of(
              "responsibility",
              List.of(3),
              "implementation",
              List.of(3),
              "verification",
              List.of(4)
            )
          )
        )
      );
      var project = modelObjects(
        InputService.validateResume(modelOutput, text),
        "projects",
        4
      ).get(0);
      for (Object value : project.values())
        assertTrue(
          value.toString().isEmpty() || text.contains(value.toString())
        );
      assertTrue(project.get("name").toString().contains("\t"));
      assertTrue(project.get("responsibility").toString().contains("有限重试"));
      assertEquals("Spring Boot · RabbitMQ · Redis", project.get("stack"));
    }
  }

  @Test
  void validatesLineReferencesAndSortsDeduplicatedFields() {
    var p = candidate();
    p.put("endLine", 4);
    p.put(
      "fields",
      Map.of("responsibility", List.of(4, 3, 3), "verification", List.of(2.5))
    );
    var result = InputService.validateResume(
      Map.of("projects", List.of(p)),
      "合成简历\n预约系统\n实现接口\n执行测试"
    );
    var project = modelObjects(result, "projects", 4).get(0);
    assertEquals("实现接口\n执行测试", project.get("responsibility"));
    assertEquals("", project.get("verification"));
    assertFalse(((List<?>) result.get("warnings")).isEmpty());
  }

  @Test
  void rejectsOverlappingProjectsAndInvalidTitlesWithoutSaving() {
    var first = candidate();
    var second = candidate();
    second.put("endLine", 3);
    assertThrows(ResponseStatusException.class, () ->
      InputService.validateResume(
        Map.of("projects", List.of(first, second)),
        "合成简历\n预约系统\n另一个项目"
      )
    );
    first.put("name", "凭空编造的项目");
    assertThrows(ResponseStatusException.class, () ->
      InputService.validateResume(
        Map.of("projects", List.of(first)),
        "合成简历\n预约系统"
      )
    );
    first.put("startLine", "2");
    assertThrows(ResponseStatusException.class, () ->
      InputService.validateResume(
        Map.of("projects", List.of(first)),
        "合成简历\n预约系统"
      )
    );
  }

  @Test
  void validProjectSurvivesAnotherInvalidProjectAndWarns() {
    var invalid = candidate();
    invalid.put("startLine", 1000);
    var result = InputService.validateResume(
      Map.of("projects", List.of(candidate(), invalid)),
      "合成简历\n预约系统，我负责接口"
    );
    assertEquals(1, modelObjects(result, "projects", 4).size());
    assertFalse(((List<?>) result.get("warnings")).isEmpty());
  }

  @Test
  void whitespaceMatchingDoesNotAcceptRewrittenFacts() {
    assertEquals(
      "Spring\u00A0Boot",
      ResumeExtraction.quote("Spring\u00A0Boot", "Spring Boot", 100)
    );
    assertEquals("", ResumeExtraction.quote("延迟 420ms", "延迟 180ms", 100));
    assertEquals(
      "",
      ResumeExtraction.quote("负责接口", "独立负责全部接口", 100)
    );
    assertEquals(
      "",
      ResumeExtraction.quote("a\n" + " ".repeat(1000) + "b", "ab", 100)
    );
  }

  @Test
  void numberedLinesKeepOriginalIndicesAndBoundModelPayload() {
    var lines = ResumeExtraction.lines("合成简历\n\n预约系统\n");
    assertEquals(
      List.of(1, 3),
      lines
        .stream()
        .map(line -> line.get("line"))
        .toList()
    );
    assertThrows(ResponseStatusException.class, () ->
      ResumeExtraction.lines("a\n".repeat(1001))
    );
  }

  @Test
  @org.junit.jupiter.api.condition.EnabledIfSystemProperty(
    named = "resume.fixture",
    matches = ".+"
  )
  void suppliedDocxIsReadLocallyAndFieldsStayGrounded() throws Exception {
    var path = java.nio.file.Path.of(System.getProperty("resume.fixture"));
    String text = inputs.parser.read(
      file("provided.docx", java.nio.file.Files.readAllBytes(path))
    );
    String[] lines = text.split("\n", -1);
    var titles = new ArrayList<Integer>();
    for (int i = 0; i < lines.length; i++) {
      if (
        lines[i].contains("GitHub") &&
        (lines[i].contains("|") || lines[i].contains("｜"))
      ) titles.add(i + 1);
    }
    assertFalse(titles.isEmpty());
    var output = new ArrayList<Map<String, Object>>();
    for (int i = 0; i < titles.size(); i++) {
      int start = titles.get(i),
        end = i + 1 < titles.size() ? titles.get(i + 1) - 1 : lines.length;
      String name = lines[start - 1].split("[|｜]", 2)[0].strip();
      output.add(
        Map.of(
          "name",
          name.replaceAll("\\s+", ""),
          "startLine",
          start,
          "endLine",
          end,
          "fields",
          Map.of("responsibility", List.of(Math.min(start + 1, end)))
        )
      );
    }
    var result = InputService.validateResume(Map.of("projects", output), text);
    assertEquals(titles.size(), modelObjects(result, "projects", 4).size());
    for (var project : modelObjects(result, "projects", 4))
      for (Object value : project.values())
        assertTrue(
          value.toString().isEmpty() || text.contains(value.toString())
        );
  }

  @Test
  void acceptsBoundedWavAndRejectsDurationOrHeaders() {
    InputService.validateWav(wav(16000, 1));
    InputService.validateWav(wav(16000, 180));
    assertThrows(ResponseStatusException.class, () ->
      InputService.validateWav(wav(16000, 181))
    );
    assertThrows(ResponseStatusException.class, () ->
      InputService.validateWav(new byte[50])
    );
    var bad = wav(16000, 1);
    bad[40] = 0;
    bad[41] = 0;
    assertThrows(ResponseStatusException.class, () ->
      InputService.validateWav(bad)
    );
  }

  @Test
  void disabledSpeechDoesNotCallProvider() {
    assertFalse(inputs.speechReady());
    assertThrows(ResponseStatusException.class, () ->
      inputs.transcribe(user(), file("x.wav", wav(16000, 1)))
    );
  }

  @Test
  void limitsCallsAndReleasesFailedLease() {
    String user = user();
    assertThrows(IllegalStateException.class, () ->
      inputs.limited(user, "TEST", 2, () -> {
        throw new IllegalStateException();
      })
    );
    assertEquals("ok", inputs.limited(user, "TEST", 2, () -> "ok"));
    assertEquals(
      429,
      assertThrows(ResponseStatusException.class, () ->
        inputs.limited(user, "TEST", 2, () -> "no")
      )
        .getStatusCode()
        .value()
    );
    assertEquals(
      0L,
      (
        (Number) s
          .one(
            "SELECT lease_until FROM input_limits WHERE user_id=? AND kind='TEST'",
            user
          )
          .get("lease_until")
      ).longValue()
    );
  }

  @Test
  void concurrentSameUserCannotObtainTwoLeases() throws Exception {
    String user = user();
    var entered = new CountDownLatch(1);
    var exit = new CountDownLatch(1);
    var pool = Executors.newSingleThreadExecutor();
    try {
      var first = pool.submit(() ->
        inputs.limited(user, "TEST", 10, () -> {
          entered.countDown();
          try {
            exit.await(5, TimeUnit.SECONDS);
          } catch (Exception e) {
            throw new RuntimeException(e);
          }
          return "ok";
        })
      );
      assertTrue(entered.await(5, TimeUnit.SECONDS));
      assertEquals(
        409,
        assertThrows(ResponseStatusException.class, () ->
          inputs.limited(user, "TEST", 10, () -> "no")
        )
          .getStatusCode()
          .value()
      );
      exit.countDown();
      assertEquals("ok", first.get(5, TimeUnit.SECONDS));
    } finally {
      exit.countDown();
      pool.shutdownNow();
    }
  }

  @Test
  void staleLeaseCannotReturnOrClearNewOwner() {
    String user = user();
    String newToken = id();
    assertThrows(ResponseStatusException.class, () ->
      inputs.limited(user, "TEST", 10, () -> {
        s.db.update(
          "UPDATE input_limits SET lease_token=? WHERE user_id=? AND kind='TEST'",
          newToken,
          user
        );
        return "stale";
      })
    );
    assertEquals(
      newToken,
      s
        .one(
          "SELECT lease_token FROM input_limits WHERE user_id=? AND kind='TEST'",
          user
        )
        .get("lease_token")
    );
  }

  @Test
  void uploadRequiresSessionAndOrigin() throws Exception {
    mvc
      .perform(
        multipart("/api/resume/import")
          .file(file("x.txt", "Synthetic resume with project text".getBytes()))
          .header("Origin", "http://localhost:5173")
      )
      .andExpect(status().isUnauthorized());
    mvc
      .perform(
        multipart("/api/resume/import")
          .file(file("x.txt", new byte[30]))
          .header("Origin", "https://evil.example")
      )
      .andExpect(status().isForbidden());
  }

  @Test
  void speechEndpointRejectsOtherUserAndStaleTurn() throws Exception {
    var response = new org.springframework.mock.web.MockHttpServletResponse();
    String owner = str(
      auth.login(
        Map.of(
          "username",
          "input-api-" + id(),
          "password",
          "synthetic-input-password"
        ),
        true,
        response
      ),
      "id"
    );
    var cookie = response.getCookie("probe_session");
    assertNotNull(cookie);
    var project = projects.save(
      owner,
      null,
      Map.of("name", "合成项目", "responsibility", "我负责接口")
    );
    project = projects.extract(owner, str(project, "id"));
    project = projects.confirm(
      owner,
      str(project, "id"),
      new HashMap<>(
        Map.of("version", project.get("version"), "facts", project.get("facts"))
      )
    );
    var order = payments.create(owner, Map.of("requestKey", id()));
    payments.mock(owner, str(order, "id"));
    var training = trainings.start(
      owner,
      Map.of("projectId", project.get("id"), "requestKey", id())
    );
    String trainingId = str(training, "id"),
      turnId = str(list(training, "turns").get(0), "id");
    mvc
      .perform(
        multipart("/api/trainings/" + trainingId + "/transcribe")
          .file(file("x.wav", wav(16000, 1)))
          .param("turnId", id())
          .cookie(cookie)
          .header("Origin", "http://localhost:5173")
      )
      .andExpect(status().isConflict());
    mvc
      .perform(
        multipart("/api/trainings/" + trainingId + "/transcribe")
          .file(file("x.wav", wav(16000, 1)))
          .param("turnId", turnId)
          .cookie(cookie)
          .header("Origin", "http://localhost:5173")
      )
      .andExpect(status().isServiceUnavailable());
    var other = new org.springframework.mock.web.MockHttpServletResponse();
    auth.login(
      Map.of(
        "username",
        "input-other-" + id(),
        "password",
        "synthetic-input-password"
      ),
      true,
      other
    );
    mvc
      .perform(
        multipart("/api/trainings/" + trainingId + "/transcribe")
          .file(file("x.wav", wav(16000, 1)))
          .param("turnId", turnId)
          .cookie(other.getCookie("probe_session"))
          .header("Origin", "http://localhost:5173")
      )
      .andExpect(status().isNotFound());
  }
}
