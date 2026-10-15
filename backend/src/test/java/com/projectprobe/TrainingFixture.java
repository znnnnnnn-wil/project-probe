package com.projectprobe;

import static com.projectprobe.Store.*;
import java.util.*;

final class TrainingFixture {
  record Fixture(String user, String project, Map<String, Object> training) {}
  static Fixture create(Store s, ProjectService projects, PaymentService payments, TrainingService trainings) {
    String user = id();
    s.db.update("INSERT INTO app_users VALUES (?,?,?,?)", user, user, "unused", now());
    var project = projects.save(user, null, Map.of("name", "合成项目", "responsibility", "接口和测试"));
    String projectId = str(project, "id");
    project = projects.extract(user, projectId); projects.confirm(user, projectId, project);
    var order = payments.create(user, Map.of("requestKey", id())); payments.mock(user, str(order, "id"));
    return new Fixture(user, projectId, trainings.start(user, Map.of("projectId", projectId, "requestKey", id())));
  }
}
