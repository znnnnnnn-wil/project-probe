package com.projectprobe;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import java.util.function.Supplier;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

@Component
public class Store {

  final JdbcTemplate db;
  final TransactionTemplate tx;
  final ObjectMapper json;

  Store(JdbcTemplate db, TransactionTemplate tx, ObjectMapper json) {
    this.db = db;
    this.tx = tx;
    this.json = json;
  }

  static String id() {
    return UUID.randomUUID().toString();
  }

  static long now() {
    return System.currentTimeMillis();
  }

  static ResponseStatusException error(int code, String message) {
    return new ResponseStatusException(HttpStatus.valueOf(code), message);
  }

  String encode(Object value) {
    try {
      return json.writeValueAsString(value);
    } catch (Exception e) {
      throw new IllegalStateException("序列化失败");
    }
  }

  Map<String, Object> decode(Object value) {
    try {
      return json.readValue(
        value.toString(),
        new TypeReference<LinkedHashMap<String, Object>>() {}
      );
    } catch (Exception e) {
      throw new IllegalStateException("数据读取失败");
    }
  }

  // 模型 JSON 不允许 null 根对象、重复键、尾随内容或非对象根节点。
  Map<String, Object> decodeModel(String value) {
    try {
      Map<String, Object> result = json
        .readerFor(new TypeReference<LinkedHashMap<String, Object>>() {})
        .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
        .with(JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
        .readValue(value);
      if (result == null) throw new IllegalArgumentException();
      return result;
    } catch (Exception e) {
      throw error(503, "模型输出无法解析为合法 JSON 对象，请重试");
    }
  }

  Map<String, Object> one(String sql, Object... args) {
    var rows = db.queryForList(sql, args);
    if (rows.isEmpty()) throw error(404, "记录不存在或无权访问");
    return rows.get(0);
  }

  <T> T locked(String user, Supplier<T> work) {
    return tx.execute(s -> {
      one("SELECT id FROM app_users WHERE id=? FOR UPDATE", user);
      return work.get();
    });
  }

  static String str(Map<String, ?> m, String key) {
    return Objects.toString(m.get(key), "");
  }

  static String required(Map<String, ?> m, String key, int max) {
    String v = str(m, key).strip();
    if (v.isEmpty() || v.length() > max) throw error(
      400,
      "字段 " + key + " 不能为空且长度不能超过 " + max
    );
    return v;
  }

  @SuppressWarnings("unchecked")
  static List<Map<String, Object>> list(Map<String, Object> m, String key) {
    return (List<Map<String, Object>>) m.computeIfAbsent(key, k ->
      new ArrayList<Map<String, Object>>()
    );
  }

  // 只用于外部模型输出；不得补字段或把错误类型强制转换为成功结果。
  static List<Map<String, Object>> modelObjects(
    Map<String, Object> m,
    String key,
    int max
  ) {
    if (
      m == null ||
      !m.containsKey(key) ||
      !(m.get(key) instanceof List<?> values) ||
      values.size() > max
    ) throw error(503, "模型输出数组字段不正确：" + key);
    var result = new ArrayList<Map<String, Object>>();
    for (Object value : values) {
      if (
        !(value instanceof Map<?, ?> entry) ||
        entry
          .keySet()
          .stream()
          .anyMatch(k -> !(k instanceof String))
      ) throw error(503, "模型输出数组条目不正确：" + key);
      var copy = new LinkedHashMap<String, Object>();
      entry.forEach((k, v) -> copy.put((String) k, v));
      result.add(copy);
    }
    return result;
  }

  static String modelText(Map<String, Object> m, String key, int max) {
    if (
      m == null ||
      !(m.get(key) instanceof String value) ||
      value.isBlank() ||
      value.length() > max
    ) throw error(503, "模型输出文本字段不正确：" + key);
    return ((String) m.get(key)).strip();
  }
}
