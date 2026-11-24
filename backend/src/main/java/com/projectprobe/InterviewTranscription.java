package com.projectprobe;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.websocket.*;
import jakarta.websocket.server.ServerContainer;
import jakarta.websocket.server.ServerEndpointConfig;
import java.io.IOException;
import java.net.URI;
import java.net.http.WebSocket;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/** Relays only a detected utterance to the authorized DashScope speech endpoint. */
@Service
final class InterviewTranscription {
  private static final String MODEL = "qwen3-asr-flash-realtime";
  private static final int MAX_CHUNK = 16384, MAX_AUDIO_BYTES = 16000 * 2 * 180;
  private final Store store;
  private final InputService inputs;
  private final String origin;

  InterviewTranscription(Store store, InputService inputs, @Value("${app.origin}") String origin) {
    this.store = store;
    this.inputs = inputs;
    this.origin = origin;
  }

  void open(HttpServletRequest request, HttpServletResponse response, Runnable validateTurn)
      throws IOException, DeploymentException {
    if (!origin.equals(request.getHeader("Origin"))) throw Store.error(403, "请求来源校验失败");
    if (!inputs.realtimeSpeechReady()) throw Store.error(503, "实时语音识别暂不可用");
    if (!(request.getServletContext().getAttribute(ServerContainer.class.getName()) instanceof ServerContainer container))
      throw Store.error(503, "实时语音连接暂不可用");
    validateTurn.run();
    var endpoint = new BrowserEndpoint(validateTurn);
    var config = ServerEndpointConfig.Builder.create(BrowserEndpoint.class, request.getRequestURI())
      .configurator(new ServerEndpointConfig.Configurator() {
        @Override public <T> T getEndpointInstance(Class<T> type) { return type.cast(endpoint); }
      }).build();
    container.upgradeHttpToWebSocket(request, response, config, Map.of());
  }

  private final class BrowserEndpoint extends Endpoint {
    private final Runnable validateTurn;
    private final Map<String, String> portions = new LinkedHashMap<>();
    private Session browser;
    private WebSocket upstream;
    private boolean closed, ready, finishing;
    private int bytes;
    private long event;

    BrowserEndpoint(Runnable validateTurn) { this.validateTurn = validateTurn; }

    @Override public synchronized void onOpen(Session session, EndpointConfig config) {
      browser = session;
      session.setMaxIdleTimeout(15000);
      session.setMaxBinaryMessageBufferSize(MAX_CHUNK);
      session.setMaxTextMessageBufferSize(32);
      session.addMessageHandler(ByteBuffer.class, this::audio);
      session.addMessageHandler(String.class, this::finish);
      String host = URI.create(inputs.speechUrl).getHost();
      String credentials = inputs.speechKey.isBlank() ? inputs.model.key : inputs.speechKey;
      inputs.client.newWebSocketBuilder().connectTimeout(Duration.ofSeconds(4))
        .header("Authorization", "Bearer " + credentials)
        .header("OpenAI-Beta", "realtime=v1")
        .buildAsync(URI.create("wss://" + host + "/api-ws/v1/realtime?model=" + MODEL), new ProviderListener())
        .exceptionally(failure -> { close(); return null; });
      CompletableFuture.delayedExecutor(190, TimeUnit.SECONDS).execute(this::close);
    }

    private synchronized void audio(ByteBuffer data) {
      if (closed) return;
      int size = data.remaining();
      if (!ready || finishing || size == 0 || size % 2 != 0 || size > MAX_CHUNK || bytes + size > MAX_AUDIO_BYTES) {
        close();
        return;
      }
      bytes += size;
      byte[] pcm = new byte[size];
      data.get(pcm);
      send("input_audio_buffer.append", "audio", Base64.getEncoder().encodeToString(pcm));
    }

    private synchronized void finish(String message) {
      if (closed) return;
      if (!ready || finishing || !message.equals("finish") || bytes == 0) { close(); return; }
      finishing = true;
      send("session.finish", null, null);
    }

    private void send(String type, String key, Object value) {
      var payload = new LinkedHashMap<String, Object>(Map.of("type", type, "event_id", "event_" + ++event));
      if (key != null) payload.put(key, value);
      try {
        upstream.sendText(store.encode(payload), true).get(3, TimeUnit.SECONDS);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        close();
      } catch (Exception e) { close(); }
    }

    @Override public void onClose(Session session, CloseReason reason) { close(); }
    @Override public void onError(Session session, Throwable failure) { close(); }

    private synchronized void close() {
      if (closed) return;
      closed = true;
      if (upstream != null) upstream.abort();
      try { if (browser.isOpen()) browser.close(); } catch (IOException ignored) {}
    }

    private void result() {
      if (!finishing || portions.isEmpty() || portions.containsValue(null)) { close(); return; }
      String text = String.join(" ", portions.values()).strip();
      if (text.isBlank() || text.length() > 6000) { close(); return; }
      validateTurn.run();
      browser.getAsyncRemote().sendText(store.encode(Map.of("text", text)), sent -> close());
    }

    private final class ProviderListener implements WebSocket.Listener {
      private final StringBuilder message = new StringBuilder();

      @Override public void onOpen(WebSocket socket) {
        synchronized (BrowserEndpoint.this) {
          if (closed) { socket.abort(); return; }
          upstream = socket;
          send("session.update", "session", Map.of("modalities", List.of("text"), "input_audio_format", "pcm", "sample_rate", 16000,
            "turn_detection", Map.of("type", "server_vad", "silence_duration_ms", 800)));
        }
        socket.request(1);
      }

      @Override public CompletionStage<?> onText(WebSocket socket, CharSequence data, boolean last) {
        synchronized (BrowserEndpoint.this) {
          if (closed) return null;
          if (message.length() + data.length() > 64000) { close(); return null; }
          message.append(data);
          if (last) {
            try {
              var received = store.json.readTree(message.toString());
              String item = received.path("item_id").asText();
              switch (received.path("type").asText()) {
                case "session.updated" -> {
                  ready = true;
                  browser.getAsyncRemote().sendText("{\"ready\":true}", sent -> { if (!sent.isOK()) close(); });
                }
                case "input_audio_buffer.speech_started" -> portions.putIfAbsent(item, null);
                case "conversation.item.input_audio_transcription.completed" -> portions.put(item, received.path("transcript").asText().strip());
                case "session.finished" -> result();
                case "error", "conversation.item.input_audio_transcription.failed" -> close();
                default -> { }
              }
              if (portions.size() > 180) close();
            } catch (Exception e) { close(); }
            message.setLength(0);
          }
        }
        socket.request(1);
        return null;
      }

      @Override public CompletionStage<?> onClose(WebSocket socket, int statusCode, String reason) { close(); return null; }
      @Override public void onError(WebSocket socket, Throwable failure) { close(); }
    }
  }
}
