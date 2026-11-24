package com.projectprobe;

import static com.projectprobe.Store.*;
import static org.junit.jupiter.api.Assertions.*;

import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.web.server.ResponseStatusException;

@SpringBootTest(
  properties = {
    "spring.datasource.url=${PROBE_TEST_DB_URL:jdbc:h2:mem:extraction-regression;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1}",
    "spring.datasource.username=${PROBE_TEST_DB_USER:sa}",
    "spring.datasource.password=${PROBE_TEST_DB_PASSWORD:}",
    "app.model-mode=demo",
  }
)
class ExtractionRegressionTest {

  @Autowired
  Store s;

  @Autowired
  ModelService demoModel;

  @Autowired
  ProjectService projects;

  String user() {
    String u = id();
    s.db.update(
      "INSERT INTO app_users VALUES (?,?,?,?)",
      u,
      "extract-" + u,
      "unused",
      now()
    );
    return u;
  }

  Map<String, Object> project(String user) {
    return projects.save(
      user,
      null,
      Map.of("name", "合成提取测试", "responsibility", "我实现预约接口")
    );
  }

  ModelService counted(AtomicInteger calls) {
    return new ModelService(
      s,
      "demo",
      "https://example.test/v1",
      "",
      "",
      "test"
    ) {
      @Override
      List<Map<String, Object>> extract(Map<String, Object> p) {
        calls.incrementAndGet();
        return demoModel.extract(p);
      }
    };
  }

  @Test
  void repeatedExtractionPreservesConfirmedFactsAndUsesCachedResult() {
    var u = user();
    var p = project(u);
    var calls = new AtomicInteger();
    var service = new ProjectService(s, counted(calls));
    var pid = str(p, "id");
    p = service.extract(u, pid);
    list(p, "facts").get(0).put("text", "经本人核对后的接口职责");
    p = service.confirm(u, pid, p);
    var version = p.get("version");
    assertEquals(version, service.save(u, pid, p).get("version"));
    for (int i = 0; i < 25; i++) {
      var result = service.extract(u, pid);
      assertEquals(version, result.get("version"));
      assertEquals(true, result.get("factsConfirmed"));
      assertEquals(
        "经本人核对后的接口职责",
        list(result, "facts").get(0).get("text")
      );
    }
    assertEquals(1, calls.get());
    p.put("implementation", "增加唯一约束");
    service.save(u, pid, p);
    service.extract(u, pid);
    assertEquals(2, calls.get());
  }

  @Test
  void oldExtractionLimitDoesNotBlockNewProjectMaterials() {
    var u = user();
    s.db.update("INSERT INTO extraction_limits(user_id,window_start,attempts,lease_until) VALUES (?,?,20,?)",
      u, now(), now() + 90_000);
    var calls = new AtomicInteger();
    var service = new ProjectService(s, counted(calls));
    for (int i = 0; i < 21; i++) {
      String projectId = str(project(u), "id");
      assertFalse(list(service.extract(u, projectId), "facts").isEmpty());
    }
    assertEquals(21, calls.get());
  }

  @Test
  void failedExtractionCanBeRetriedImmediately() {
    var u = user();
    String projectId = str(project(u), "id");
    var calls = new AtomicInteger();
    var model = new ModelService(s, "demo", "https://example.test/v1", "", "", "test") {
      @Override List<Map<String, Object>> extract(Map<String, Object> p) {
        if (calls.incrementAndGet() == 1) throw error(503, "合成失败");
        return demoModel.extract(p);
      }
    };
    var service = new ProjectService(s, model);
    assertEquals(503, assertThrows(ResponseStatusException.class, () ->
      service.extract(u, projectId)).getStatusCode().value());
    assertFalse(list(service.extract(u, projectId), "facts").isEmpty());
    assertEquals(2, calls.get());
  }

  @Test
  void concurrentInstancesOnlyMakeOneCallAndRejectStaleMaterial()
    throws Exception {
    var u = user();
    var p = project(u);
    var pid = str(p, "id");
    var otherProject = str(project(u), "id");
    var entered = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    var calls = new AtomicInteger();
    var blocked = new ModelService(
      s,
      "demo",
      "https://example.test/v1",
      "",
      "",
      "test"
    ) {
      @Override
      List<Map<String, Object>> extract(Map<String, Object> p) {
        calls.incrementAndGet();
        if (otherProject.equals(p.get("id"))) return demoModel.extract(p);
        entered.countDown();
        try {
          if (
            !release.await(10, TimeUnit.SECONDS)
          ) throw new IllegalStateException("测试超时");
        } catch (InterruptedException e) {
          Thread.currentThread().interrupt();
          throw new IllegalStateException(e);
        }
        return demoModel.extract(p);
      }
    };
    var first = new ProjectService(s, blocked);
    var second = new ProjectService(s, blocked);
    var pool = Executors.newSingleThreadExecutor();
    try {
      var future = pool.submit(() -> first.extract(u, pid));
      assertTrue(entered.await(5, TimeUnit.SECONDS));
      assertEquals(
        409,
        assertThrows(ResponseStatusException.class, () ->
          second.extract(u, pid)
        )
          .getStatusCode()
          .value()
      );
      assertFalse(list(second.extract(u, otherProject), "facts").isEmpty());
      p.put("implementation", "调用期间修改的材料");
      projects.save(u, pid, p);
      release.countDown();
      var failure = assertThrows(ExecutionException.class, () ->
        future.get(5, TimeUnit.SECONDS)
      );
      assertEquals(
        409,
        ((ResponseStatusException) failure.getCause()).getStatusCode().value()
      );
      assertTrue(list(projects.get(u, pid), "facts").isEmpty());
      assertEquals(2, calls.get());
      assertEquals(
        0,
        s.db.queryForObject("SELECT COUNT(*) FROM material_jobs WHERE user_id=?", Integer.class, u)
      );
    } finally {
      release.countDown();
      pool.shutdownNow();
    }
  }

  @Test
  void replacedLeaseIsNotOverwrittenOrReleasedByOldTask() {
    var u = user();
    var p = project(u);
    var replacement = id();
    var expired = new ModelService(
      s,
      "demo",
      "https://example.test/v1",
      "",
      "",
      "test"
    ) {
      @Override
      List<Map<String, Object>> extract(Map<String, Object> p) {
        s.db.update(
          "UPDATE material_jobs SET token=?,expires_at=? WHERE user_id=? AND kind='EXTRACTION'",
          replacement,
          now() + 90000,
          u
        );
        return demoModel.extract(p);
      }
    };
    var service = new ProjectService(s, expired);
    assertEquals(
      409,
      assertThrows(ResponseStatusException.class, () ->
        service.extract(u, str(p, "id"))
      )
        .getStatusCode()
        .value()
    );
    assertEquals(
      replacement,
      s
        .one("SELECT token FROM material_jobs WHERE user_id=? AND kind='EXTRACTION'", u)
        .get("token")
    );
    assertTrue(list(projects.get(u, str(p, "id")), "facts").isEmpty());
  }
}
