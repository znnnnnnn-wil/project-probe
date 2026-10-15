package com.projectprobe;

import static org.junit.jupiter.api.Assertions.*;
import java.util.*;
import org.junit.jupiter.api.Test;

class QuestionCoverageTest {
  @Test void selfReportedGapsAreKeptWithoutClaimingMastery() {
    var result = QuestionCoverage.summarize(new LinkedHashMap<>(Map.of("turns", List.of(
      Map.of("topic", "验证", "question", "如何验证", "answer", "尚未验证"),
      Map.of("topic", "职责", "question", "谁负责", "answer", "我负责接口")))));
    assertEquals("自报待补充", result.get(0).get("state"));
    assertTrue(result.get(1).get("state").toString().contains("未独立验证"));
  }
  @Test void nearDuplicateDoesNotRejectChangedNumbers() {
    String original = "请说明同一接口的两个并发请求，如何保证数据库仅写入一条记录？";
    assertTrue(QuestionCoverage.nearDuplicate(original, original.replace("请说明", "说明")));
    assertFalse(QuestionCoverage.nearDuplicate("请求在1.5秒后超时时如何观察和验证最终状态？", "请求在15秒后超时时如何观察和验证最终状态？"));
    assertFalse(QuestionCoverage.nearDuplicate(original, "如果下游已经成功但响应丢失，重试将如何处理？"));
  }
}
