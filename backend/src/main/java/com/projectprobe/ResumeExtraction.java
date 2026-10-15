package com.projectprobe;

import static com.projectprobe.Store.*;

import java.util.*;

final class ResumeExtraction {

  static final Map<String, String> FIELDS = new LinkedHashMap<>(
    Map.of(
      "background",
      "项目背景",
      "responsibility",
      "个人职责",
      "architecture",
      "架构说明",
      "implementation",
      "关键实现",
      "problems",
      "遇到的问题",
      "verification",
      "验证方式"
    )
  );

  static List<Map<String, Object>> lines(String text) {
    String[] lines = text.split("\n", -1);
    var result = new ArrayList<Map<String, Object>>();
    for (int i = 0; i < lines.length; i++) {
      if (!lines[i].isBlank()) result.add(
        Map.of("line", i + 1, "text", lines[i])
      );
      if (result.size() > 1000) throw error(
        400,
        "简历段落过多，请仅保留相关项目经历"
      );
    }
    return result;
  }

  static int lineNumber(Object value, int count) {
    if (!(value instanceof Number number)) return -1;
    double n = number.doubleValue();
    return Double.isFinite(n) && n == Math.rint(n) && n >= 1 && n <= count
      ? (int) n
      : -1;
  }

  static Map<String, Object> validate(Map<String, Object> output, String text) {
    var items = modelObjects(output, "projects", 4);
    var source = text.split("\n", -1);
    var projects = new ArrayList<Map<String, Object>>();
    var warnings = new ArrayList<String>();
    for (int i = 0; i < items.size(); i++) {
      var item = items.get(i);
      int start = lineNumber(item.get("startLine"), source.length);
      int end = lineNumber(item.get("endLine"), source.length);
      boolean overlap = false;
      for (int j = 0; j < items.size(); j++) {
        if (i == j) continue;
        int otherStart = lineNumber(
          items.get(j).get("startLine"),
          source.length
        );
        int otherEnd = lineNumber(items.get(j).get("endLine"), source.length);
        if (
          otherStart > 0 &&
          otherEnd >= otherStart &&
          start <= otherEnd &&
          otherStart <= end
        ) overlap = true;
      }
      if (start < 1 || end < start || overlap) {
        warnings.add("项目 " + (i + 1) + " 的原文范围不明确，未自动导入。");
        continue;
      }
      String resume = String.join(
        "\n",
        Arrays.copyOfRange(source, start - 1, end)
      ).strip();
      // The title must be grounded in the first project line, not somewhere in another project.
      String name = quote(source[start - 1], item.get("name"), 100);
      if (name.isBlank() || resume.length() > 12000) {
        warnings.add("项目 " + (i + 1) + " 的名称或原文无法定位，未自动导入。");
        continue;
      }
      var candidate = new LinkedHashMap<String, Object>();
      candidate.put("name", name);
      candidate.put("resume", resume);
      var uncertain = new ArrayList<String>();
      for (String key : List.of("stack", "targetRole")) {
        Object raw = item.get(key);
        String value = quote(
          key.equals("targetRole") ? text : resume,
          raw,
          1000
        );
        if (raw != null && !"".equals(raw) && value.isEmpty()) uncertain.add(
          key.equals("stack") ? "技术栈" : "求职方向"
        );
        candidate.put(key, value);
      }
      Map<?, ?> fields =
        item.get("fields") instanceof Map<?, ?> m ? m : Map.of();
      int total = candidate
        .values()
        .stream()
        .mapToInt(v -> v.toString().length())
        .sum();
      for (var field : FIELDS.entrySet()) {
        Object raw = fields.get(field.getKey());
        String value = selectedLines(raw, source, start, end);
        if (total + value.length() > 40000) value = "";
        if (
          raw != null &&
          !(raw instanceof List<?> l && l.isEmpty()) &&
          value.isEmpty()
        ) uncertain.add(field.getValue());
        candidate.put(field.getKey(), value);
        total += value.length();
      }
      if (!uncertain.isEmpty()) warnings.add(
        "项目 " +
          (i + 1) +
          " 的" +
          String.join("、", uncertain) +
          "缺少可靠原文定位，已留空，请核对补充。"
      );
      projects.add(candidate);
    }
    if (!items.isEmpty() && projects.isEmpty()) throw error(
      503,
      "AI未能定位项目原文，请重试或手动填写；未保存识别结果"
    );
    return Map.of("projects", projects, "warnings", warnings);
  }

  static String selectedLines(Object raw, String[] source, int start, int end) {
    if (raw == null) return "";
    if (!(raw instanceof List<?> refs) || refs.size() > 24) return "";
    var selected = new TreeSet<Integer>();
    for (Object ref : refs) {
      int line = lineNumber(ref, source.length);
      if (line < start || line > end) return "";
      selected.add(line);
    }
    String value = String.join(
      "\n",
      selected
        .stream()
        .map(n -> source[n - 1])
        .toList()
    ).strip();
    return value.length() <= 12000 ? value : "";
  }

  static String quote(String source, Object raw, int max) {
    if (!(raw instanceof String value) || value.length() > max) return "";
    value = value.strip();
    if (value.isEmpty()) return "";
    if (source.contains(value)) return value;
    var compact = new StringBuilder();
    var offsets = new ArrayList<Integer>();
    for (int i = 0; i < source.length(); i++) {
      if (!layout(source.charAt(i))) {
        compact.append(source.charAt(i));
        offsets.add(i);
      }
    }
    var expected = new StringBuilder();
    for (int i = 0; i < value.length(); i++) if (
      !layout(value.charAt(i))
    ) expected.append(value.charAt(i));
    if (expected.isEmpty()) return "";
    int index = compact.indexOf(expected.toString());
    if (index < 0) return "";
    String original = source.substring(
      offsets.get(index),
      offsets.get(index + expected.length() - 1) + 1
    );
    return original.length() <= max ? original : "";
  }

  static boolean layout(char c) {
    return (
      Character.isWhitespace(c) ||
      Character.isSpaceChar(c) ||
      c == '\u200B' ||
      c == '\uFEFF'
    );
  }
}
