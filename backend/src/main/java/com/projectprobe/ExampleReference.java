package com.projectprobe;

import java.util.Map;

final class ExampleReference {
  static final String FIELD = "referenceAnswer";
  static final int MAX_LENGTH = 300;
  static final String INSTRUCTIONS =
    "referenceAnswer 必须直接回答刚生成的具体问题，并补充候选人尚未回答的要点。口语题建议 30–40 字。"
    + "题目明确要求 SQL、代码或其他具体示例时，给出可读的完整最小示例，假设的名称或字段要标明。最多 "
    + MAX_LENGTH + " 个字符（含英文和标点）。无法给出贴题回答时省略该字段。"
    + "结合预填项目材料回答当前问题，未验证的细节用‘我会’或‘假设’说明，不编造结果、数据或职责。"
    + "参考回答独立返回，不写进题干或面试官的发言。";

  static boolean enabled(Map<String, Object> practice) {
    return Boolean.TRUE.equals(practice.get("example"));
  }

  static String read(Object value) {
    if (!(value instanceof String text)) return "";
    String answer = text.strip();
    return answer.length() <= MAX_LENGTH ? answer : "";
  }
}
