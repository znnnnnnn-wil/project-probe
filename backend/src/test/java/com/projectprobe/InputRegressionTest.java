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
      ("仅用于功能验收的合成测试简历\n预约系统，我负责接口\n" + suffix).getBytes(
        StandardCharsets.UTF_8
      )
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
    invented.put("verification", "编造压测结果");
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











}
