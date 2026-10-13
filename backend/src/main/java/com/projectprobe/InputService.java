package com.projectprobe;

import static com.projectprobe.Store.*;

import java.net.URI;
import java.net.http.*;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.Semaphore;
import java.util.function.Consumer;
import java.util.function.Supplier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

@Service
public class InputService {

  final Store s;
  final ModelService model;
  final ResumeParser parser = new ResumeParser();
  final Semaphore slots = new Semaphore(2);
  final HttpClient client = HttpClient.newBuilder()
    .connectTimeout(Duration.ofSeconds(8))
    .build();

  @Value("${app.speech-enabled:false}")
  boolean speechEnabled;

  @Value("${app.speech-paid-allowed:false}")
  boolean paidAllowed;

  @Value("${app.speech-free-quota-confirmed-model:}")
  String confirmedModel;

  @Value("${app.speech-model:qwen3-asr-flash}")
  String speechModel;

  @Value("${app.speech-url}")
  String speechUrl;

  @Value("${app.speech-key:}")
  String speechKey;

  @Value("${app.speech-daily-limit:20}")
  int speechDailyLimit;

  InputService(Store s, ModelService model) {
    this.s = s;
    this.model = model;
  }

  boolean speechReady() {
    String host;
    try {
      host = URI.create(speechUrl).getHost();
    } catch (Exception e) {
      return false;
    }
    return (
      speechEnabled &&
      (paidAllowed || speechModel.equals(confirmedModel)) &&
      "qwen3-asr-flash".equals(speechModel) &&
      speechUrl.startsWith("https://") &&
      ("dashscope.aliyuncs.com".equals(host) ||
        (host != null && host.endsWith(".cn-beijing.maas.aliyuncs.com"))) &&
      !(
        speechKey.isBlank()
          ? "DashScope".equalsIgnoreCase(model.provider)
            ? model.key
            : ""
          : speechKey
      ).isBlank()
    );
  }

  <T> T limited(String user, String kind, int limit, Supplier<T> operation) {
    return limited(user, kind, limit, () -> null, operation, result -> {});
  }

  <T> T limited(
    String user,
    String kind,
    int limit,
    Supplier<T> cached,
    Supplier<T> operation,
    Consumer<T> persist
  ) {
    T existing = cached.get();
    if (existing != null) return existing;
    if (!slots.tryAcquire()) throw error(429, "识别服务忙，请稍后再试");
    String token = id();
    try {
      T claimed = s.locked(user, () -> {
        // Recheck after the account lock: another instance may have just finished.
        T hit = cached.get();
        if (hit != null) return hit;
        var rows = s.db.queryForList(
          "SELECT * FROM input_limits WHERE user_id=? AND kind=?",
          user,
          kind
        );
        long time = now();
        if (rows.isEmpty()) {
          s.db.update(
            "INSERT INTO input_limits(user_id,kind,window_start) VALUES (?,?,?)",
            user,
            kind,
            time
          );
          rows = s.db.queryForList(
            "SELECT * FROM input_limits WHERE user_id=? AND kind=?",
            user,
            kind
          );
        }
        var row = rows.get(0);
        if (((Number) row.get("lease_until")).longValue() > time) throw error(
          409,
          "已有识别正在执行，请稍后再试"
        );
        long start = ((Number) row.get("window_start")).longValue();
        int attempts = ((Number) row.get("attempts")).intValue();
        if (time - start >= 86400000L) {
          start = time;
          attempts = 0;
        }
        if (attempts >= limit) throw error(
          429,
          "本账号当前24小时的识别次数已用完"
        );
        s.db.update(
          "UPDATE input_limits SET window_start=?,attempts=?,lease_until=?,lease_token=? WHERE user_id=? AND kind=?",
          start,
          attempts + 1,
          time + 90000,
          token,
          user,
          kind
        );
        return null;
      });
      if (claimed != null) return claimed;
      T result = operation.get();
      s.locked(user, () -> {
        var lease = s.one(
          "SELECT * FROM input_limits WHERE user_id=? AND kind=?",
          user,
          kind
        );
        if (
          !token.equals(lease.get("lease_token")) ||
          ((Number) lease.get("lease_until")).longValue() <= now()
        ) throw error(409, "识别已超时，请重新发起");
        persist.accept(result);
        s.db.update(
          "UPDATE input_limits SET lease_until=0,lease_token=NULL WHERE user_id=? AND kind=? AND lease_token=?",
          user,
          kind,
          token
        );
        return null;
      });
      return result;
    } finally {
      try {
        s.db.update(
          "UPDATE input_limits SET lease_until=0,lease_token=NULL WHERE user_id=? AND kind=? AND lease_token=?",
          user,
          kind,
          token
        );
      } finally {
        slots.release();
      }
    }
  }

  Map<String, Object> resume(String user, MultipartFile file) {
    String text = parser.read(file);
    String fingerprint = resumeFingerprint(text);
    return limited(
      user,
      "RESUME",
      10,
      () -> cachedResume(user, fingerprint),
      () -> {
        if (!model.mode.equals("live")) throw error(
          503,
          "简历自动识别需配置文字模型，仍可手动填写材料"
        );
        var output = model.call(
          "这是简历识别任务。只提取项目经历，不提取姓名、电话、邮箱、住址、学校或身份信息。返回 {projects:[{name:string,stack:string,targetRole:string,background:string,responsibility:string,resume:string,architecture:string,implementation:string,problems:string,verification:string}]}，最多4个项目。每个非空字段必须逐字复制输入中的一段连续原文，不可总结、推断、补全或拼接。name只能复制项目名称；resume复制包含项目名称的完整项目经历原文，不包含其他项目。除targetRole可来自全局求职意向外，其余字段都必须在本项目resume原文内找到。未提及的字段返回空字符串，无法识别项目时返回空数组。职责只能摘取明确的个人工作，不把项目介绍改成个人成果。",
          Map.of("resumeText", text)
        );
        var result = new LinkedHashMap<>(validateResume(output, text));
        result.put("duplicate", false);
        result.put("recognizedAt", now());
        return result;
      },
      result -> {
        s.db.update(
          "DELETE FROM resume_import_cache WHERE user_id=? AND fingerprint=?",
          user,
          fingerprint
        );
        s.db.update(
          "INSERT INTO resume_import_cache(user_id,fingerprint,body,expires_at) VALUES (?,?,?,?)",
          user,
          fingerprint,
          s.encode(result),
          now() + 30L * 86400000
        );
      }
    );
  }

  String resumeFingerprint(String text) {
    try {
      // Include extraction/schema version and model identity, never credentials.
      String identity = s.encode(
        List.of(
          "resume-v1",
          model.mode,
          model.provider,
          model.url,
          model.model,
          text
        )
      );
      return HexFormat.of().formatHex(
        MessageDigest.getInstance("SHA-256").digest(
          identity.getBytes(StandardCharsets.UTF_8)
        )
      );
    } catch (java.security.NoSuchAlgorithmException e) {
      throw new IllegalStateException("SHA-256 unavailable", e);
    }
  }

  Map<String, Object> cachedResume(String user, String fingerprint) {
    var rows = s.db.queryForList(
      "SELECT body FROM resume_import_cache WHERE user_id=? AND fingerprint=? AND expires_at>?",
      user,
      fingerprint,
      now()
    );
    if (rows.isEmpty()) return null;
    var result = s.decode(rows.get(0).get("body"));
    result.put("duplicate", true);
    return result;
  }

  @org.springframework.scheduling.annotation.Scheduled(
    fixedDelay = 3600000,
    initialDelay = 60000
  )
  void purgeExpiredResumes() {
    s.db.update("DELETE FROM resume_import_cache WHERE expires_at<=?", now());
  }

  static Map<String, Object> validateResume(
    Map<String, Object> output,
    String text
  ) {
    var candidates = new ArrayList<Map<String, Object>>();
    for (var item : modelObjects(output, "projects", 4)) {
      var candidate = new LinkedHashMap<String, Object>();
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
      )) {
        Object raw = item.get(field);
        if (
          !(raw instanceof String) ||
          ((String) raw).length() > (field.equals("name") ? 100 : 12000)
        ) throw error(503, "简历识别结果格式不正确，请重试");
        String value = ((String) raw).strip();
        if (!value.isEmpty() && !text.contains(value)) throw error(
          503,
          "简历识别结果缺少原文依据，请重试"
        );
        candidate.put(field, value);
      }
      if (
        str(candidate, "name").isBlank() || str(candidate, "resume").isBlank()
      ) throw error(503, "识别出的项目缺少名称或原文，请重试");
      for (var field : candidate.entrySet()) {
        String value = field.getValue().toString();
        if (
          !field.getKey().equals("targetRole") &&
          !value.isEmpty() &&
          !str(candidate, "resume").contains(value)
        ) throw error(503, "识别结果混入其他项目，请重试");
      }
      candidates.add(candidate);
    }
    return Map.of("projects", candidates);
  }

  Map<String, Object> transcribe(String user, MultipartFile file) {
    if (!speechReady()) throw error(503, "语音识别暂未配置，仍可使用文字回答");
    byte[] audio;
    try {
      audio = file.getBytes();
    } catch (Exception e) {
      throw error(400, "录音读取失败，请重新录制");
    }
    validateWav(audio);
    final byte[] data = audio;
    return limited(
      user,
      "SPEECH",
      Math.max(1, Math.min(speechDailyLimit, 100)),
      () -> {
        var body = Map.of(
          "model",
          speechModel,
          "stream",
          false,
          "asr_options",
          Map.of("enable_itn", false),
          "messages",
          List.of(
            Map.of(
              "role",
              "user",
              "content",
              List.of(
                Map.of(
                  "type",
                  "input_audio",
                  "input_audio",
                  Map.of(
                    "data",
                    "data:audio/wav;base64," +
                      Base64.getEncoder().encodeToString(data)
                  )
                )
              )
            )
          )
        );
        try {
          var request = HttpRequest.newBuilder(
            URI.create(speechUrl.replaceAll("/$", "") + "/chat/completions")
          )
            .timeout(Duration.ofSeconds(60))
            .header("Content-Type", "application/json")
            .header(
              "Authorization",
              "Bearer " + (speechKey.isBlank() ? model.key : speechKey)
            )
            .POST(HttpRequest.BodyPublishers.ofString(s.encode(body)))
            .build();
          var response = client.send(
            request,
            HttpResponse.BodyHandlers.ofString()
          );
          if (response.statusCode() != 200) throw error(
            503,
            response.statusCode() == 403
              ? "语音模型额度或权限不可用，请使用文字回答"
              : "语音识别服务暂不可用，请稍后再试"
          );
          if (response.body().length() > 100000) throw error(
            503,
            "语音识别响应过大"
          );
          var root = s.json.readTree(response.body());
          String result = root
            .path("choices")
            .path(0)
            .path("message")
            .path("content")
            .asText("")
            .strip();
          if (result.isBlank()) throw error(
            422,
            "没有识别到语音，请检查麦克风后重试"
          );
          if (result.length() > 6000) throw error(
            422,
            "转写超过6000字，请分段录音"
          );
          return Map.of("text", result);
        } catch (org.springframework.web.server.ResponseStatusException e) {
          throw e;
        } catch (InterruptedException e) {
          Thread.currentThread().interrupt();
          throw error(503, "语音识别已中断，请重试");
        } catch (Exception e) {
          throw error(503, "语音识别超时或响应异常，录音未提交为回答，可重试");
        }
      }
    );
  }

  static void validateWav(byte[] bytes) {
    if (bytes.length < 46 || bytes.length > 6 * 1024 * 1024) throw error(
      400,
      "录音文件为空或过大"
    );
    var b = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
    if (
      b.getInt(0) != 0x46464952 ||
      b.getInt(8) != 0x45564157 ||
      b.getInt(12) != 0x20746d66 ||
      b.getInt(16) != 16 ||
      b.getShort(20) != 1 ||
      b.getShort(22) != 1 ||
      b.getShort(34) != 16 ||
      b.getInt(36) != 0x61746164
    ) throw error(400, "录音须为单声道16位PCM WAV格式，请使用页面录音");
    int rate = b.getInt(24),
      length = b.getInt(40);
    if (
      rate < 8000 ||
      rate > 48000 ||
      length != bytes.length - 44 ||
      length % 2 != 0 ||
      b.getInt(4) != bytes.length - 8 ||
      b.getShort(32) != 2 ||
      b.getInt(28) != rate * 2 ||
      length < rate ||
      (long) length > (long) rate * 2 * 180
    ) throw error(400, "单段录音须为0.5至180秒，请分段录制");
  }
}
