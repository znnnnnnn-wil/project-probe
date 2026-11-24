package com.projectprobe;

import static com.projectprobe.Store.*;

import jakarta.servlet.http.HttpServletResponse;
import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.http.*;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class InterviewSpeech {
  private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(InterviewSpeech.class);
  private static final long FIRST_AUDIO_MS = 8000;
  private static final long TICKET_LIFETIME_MS = 180_000;

  final Store s;
  final ModelService model;
  final ProjectPractice practice;
  final HttpClient client = HttpClient.newBuilder()
    .connectTimeout(Duration.ofSeconds(8))
    .build();

  @Value("${app.tts-enabled:false}")
  boolean enabled;

  @Value("${app.tts-paid-allowed:false}")
  boolean paidAllowed;

  @Value("${app.tts-free-quota-confirmed-model:}")
  String confirmedModel;

  @Value("${app.tts-model:cosyvoice-v2}")
  String ttsModel;

  @Value("${app.tts-voice:longcheng_v2}")
  String voice;

  @Value("${app.tts-url:wss://dashscope.aliyuncs.com/api-ws/v1/inference}")
  String ttsUrl;

  @Value("${app.tts-key:}")
  String ttsKey;

  InterviewSpeech(Store s, ModelService model, ProjectPractice practice) {
    this.s = s;
    this.model = model;
    this.practice = practice;
  }

  String key() {
    return ttsKey.isBlank()
      ? "DashScope".equalsIgnoreCase(model.provider) ? model.key : ""
      : ttsKey;
  }

  boolean ttsReady() {
    String host;
    try {
      host = URI.create(ttsUrl).getHost();
    } catch (Exception e) {
      return false;
    }
    return (
      enabled &&
      (paidAllowed || ttsModel.equals(confirmedModel)) &&
      ttsUrl.startsWith("wss://") &&
      ("dashscope.aliyuncs.com".equals(host) ||
        (host != null && host.endsWith(".cn-beijing.maas.aliyuncs.com"))) &&
      !key().isBlank()
    );
  }

  void speak(String user, String projectId, String turnId, Object exchangeCount, HttpServletResponse response) {
    if (!ttsReady()) throw error(503, "面试官语音暂未配置，将使用浏览器播报");
    speakText(practice.speechPrompt(user, projectId, turnId, exchangeCount), response);
  }

  String sentenceTicket(String user, String projectId, String sentence) {
    if (!ttsReady()) return "";
    long expires = now() + TICKET_LIFETIME_MS;
    return expires + "." + HexFormat.of().formatHex(signature(user, projectId, sentence, expires));
  }

  void speakSentence(String user, String projectId, String sentence, String ticket, HttpServletResponse response) {
    if (!ttsReady()) throw error(503, "面试官语音暂未配置，将使用浏览器播报");
    if (!validSentenceTicket(user, projectId, sentence, ticket)) throw error(403, "本句讲解的播报凭证无效或已过期");
    speakText(sentence, response);
  }

  private boolean validSentenceTicket(String user, String projectId, String sentence, String ticket) {
    if (sentence.isBlank() || sentence.length() > 300 || ticket.length() > 90) return false;
    String[] parts = ticket.split("\\.", 2);
    if (parts.length != 2) return false;
    try {
      long expires = Long.parseLong(parts[0]);
      long time = now();
      return expires >= time && expires <= time + TICKET_LIFETIME_MS && MessageDigest.isEqual(
        HexFormat.of().parseHex(parts[1]), signature(user, projectId, sentence, expires));
    } catch (IllegalArgumentException e) {
      return false;
    }
  }

  private byte[] signature(String user, String projectId, String sentence, long expires) {
    try {
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(key().getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
      return mac.doFinal(("practice-explanation\n" + user + "\n" + projectId + "\n" + expires + "\n" + sentence)
        .getBytes(StandardCharsets.UTF_8));
    } catch (GeneralSecurityException e) {
      throw new IllegalStateException("Speech ticket signing is unavailable", e);
    }
  }

  private void speakText(String text, HttpServletResponse response) {
    if (text.isBlank() || text.length() > 650) throw error(409, "当前问题不支持语音播报");
    synthesize(text, response);
  }

  void synthesize(String text, HttpServletResponse response) {
    String taskId = UUID.randomUUID().toString();
    var audio = new LinkedBlockingQueue<byte[]>();
    var failure = new AtomicReference<String>();
    var finished = new CountDownLatch(1);
    String runTask = s.encode(Map.of(
      "header", Map.of("action", "run-task", "task_id", taskId, "streaming", "duplex"),
      "payload", Map.of(
        "task_group", "audio", "task", "tts", "function", "SpeechSynthesizer",
        "model", ttsModel,
        "parameters", Map.of(
          "text_type", "PlainText", "voice", voice, "format", "mp3",
          "sample_rate", 22050, "volume", 50, "rate", 1.0, "pitch", 1.0
        ),
        "input", Map.of()
      )
    ));
    String continueTask = s.encode(Map.of(
      "header", Map.of("action", "continue-task", "task_id", taskId),
      "payload", Map.of("input", Map.of("text", text))
    ));
    String finishTask = s.encode(Map.of(
      "header", Map.of("action", "finish-task", "task_id", taskId),
      "payload", Map.of("input", Map.of())
    ));
    WebSocket.Listener listener = new WebSocket.Listener() {
      final StringBuilder textBuffer = new StringBuilder();
      final ByteArrayOutputStream partial = new ByteArrayOutputStream();

      @Override
      public void onOpen(WebSocket ws) {
        ws.sendText(runTask, true);
        ws.request(1);
      }

      @Override
      public CompletionStage<?> onText(WebSocket ws, CharSequence data, boolean last) {
        textBuffer.append(data);
        if (last) {
          String message = textBuffer.toString();
          textBuffer.setLength(0);
          try {
            var header = s.json.readTree(message).path("header");
            String event = header.path("event").asText("");
            if (event.equals("task-started")) {
              ws.sendText(continueTask, true).thenCompose(ignored -> ws.sendText(finishTask, true));
            } else if (event.equals("task-failed")) {
              failure.compareAndSet(null, header.path("error_message").asText("语音合成失败"));
              finished.countDown();
            } else if (event.equals("task-finished")) {
              finished.countDown();
            }
          } catch (Exception e) {
            failure.compareAndSet(null, "语音服务响应异常");
            finished.countDown();
          }
        }
        ws.request(1);
        return null;
      }

      @Override
      public CompletionStage<?> onBinary(WebSocket ws, ByteBuffer data, boolean last) {
        byte[] bytes = new byte[data.remaining()];
        data.get(bytes);
        partial.writeBytes(bytes);
        if (last) {
          audio.add(partial.toByteArray());
          partial.reset();
        }
        ws.request(1);
        return null;
      }

      @Override
      public CompletionStage<?> onClose(WebSocket ws, int statusCode, String reason) {
        finished.countDown();
        return null;
      }

      @Override
      public void onError(WebSocket ws, Throwable error) {
        failure.compareAndSet(null, "语音连接异常");
        finished.countDown();
      }
    };
    WebSocket ws = null;
    try {
      long deadline = now() + FIRST_AUDIO_MS;
      ws = client.newWebSocketBuilder()
        .header("Authorization", "Bearer " + key())
        .connectTimeout(Duration.ofSeconds(5))
        .buildAsync(URI.create(ttsUrl), listener)
        .join();
      byte[] first = null;
      while (first == null) {
        if (failure.get() != null) {
          log.warn("interview_tts_failed reason=provider_before_audio");
          throw error(503, "面试官语音暂不可用，将使用浏览器播报");
        }
        long remaining = deadline - now();
        if (remaining <= 0) {
          log.warn("interview_tts_failed reason=first_audio_timeout");
          throw error(503, "面试官语音响应超时，将使用浏览器播报");
        }
        first = audio.poll(Math.min(remaining, 200), TimeUnit.MILLISECONDS);
        if (first == null && finished.getCount() == 0 && audio.isEmpty()) {
          log.warn("interview_tts_failed reason=empty_audio");
          throw error(503, "面试官语音暂不可用，将使用浏览器播报");
        }
      }
      response.setContentType("audio/mpeg");
      response.setHeader("Cache-Control", "no-store");
      var out = response.getOutputStream();
      out.write(first);
      out.flush();
      long end = now() + 60000;
      while (failure.get() == null) {
        byte[] chunk = audio.poll(1000, TimeUnit.MILLISECONDS);
        if (chunk != null) {
          out.write(chunk);
          out.flush();
        } else if (finished.getCount() == 0 || now() >= end) break;
      }
      if (failure.get() != null) log.warn("interview_tts_failed reason=provider_after_audio");
    } catch (org.springframework.web.server.ResponseStatusException e) {
      throw e;
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      if (response.isCommitted()) return;
      throw error(503, "语音合成已中断，将使用浏览器播报");
    } catch (java.io.IOException e) {
      // Playback can be canceled while the servlet is writing audio.
      if (response.isCommitted()) return;
      response.resetBuffer();
      response.setContentType("application/json");
      throw error(503, "面试官语音暂不可用，将使用浏览器播报");
    } catch (Exception e) {
      log.warn("interview_tts_failed reason=connection_or_response type={}", e.getClass().getSimpleName());
      if (response.isCommitted()) return;
      throw error(503, "面试官语音暂不可用，将使用浏览器播报");
    } finally {
      if (ws != null) ws.abort();
    }
  }
}
