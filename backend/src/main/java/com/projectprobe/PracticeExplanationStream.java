package com.projectprobe;

import java.util.concurrent.Flow;
import java.util.function.Consumer;

final class PracticeExplanationStream implements Flow.Subscriber<String> {
  private final Store store;
  private final Consumer<String> sentences;
  private final StringBuilder text = new StringBuilder();
  private Flow.Subscription subscription;
  private int emitted;
  private int received;
  private boolean done;
  private boolean stopped;
  private long inputTokens = -1, outputTokens = -1;

  PracticeExplanationStream(Store store, Consumer<String> sentences) {
    this.store = store;
    this.sentences = sentences;
  }

  @Override public synchronized void onSubscribe(Flow.Subscription subscription) {
    this.subscription = subscription;
    if (stopped) subscription.cancel();
    else subscription.request(Long.MAX_VALUE);
  }

  @Override public synchronized void onNext(String line) {
    if (stopped) return;
    received += line.length() + 1;
    if (received > 200_000) throw Store.error(503, "模型响应过大");
    if (!line.startsWith("data:")) return;
    String data = line.substring(5).strip();
    if (data.equals("[DONE]")) {
      done = true;
      return;
    }
    try {
      var event = store.json.readTree(data);
      if (event.has("error")) throw Store.error(503, "讲解流暂不可用");
      if (event.hasNonNull("usage")) {
        inputTokens = event.path("usage").path("prompt_tokens").asLong(-1);
        outputTokens = event.path("usage").path("completion_tokens").asLong(-1);
      }
      String delta = event.path("choices").path(0).path("delta").path("content").asText();
      for (int i = 0; i < delta.length() && text.length() < 300; i++) {
        char c = delta.charAt(i);
        text.append(c);
        if ("。！？!?\n".indexOf(c) >= 0) emitSentence();
      }
    } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
      throw Store.error(503, "模型讲解流格式不正确");
    }
  }

  private void emitSentence() {
    String sentence = text.substring(emitted).strip();
    emitted = text.length();
    if (!sentence.isBlank()) sentences.accept(sentence);
  }

  @Override public void onError(Throwable error) {}
  @Override public void onComplete() {}

  synchronized String result() {
    if (!done || text.toString().isBlank()) throw Store.error(503, "模型讲解未完整返回");
    emitSentence();
    return text.toString().strip();
  }

  synchronized void stop() {
    stopped = true;
    if (subscription != null) subscription.cancel();
  }

  synchronized boolean started() { return emitted > 0; }
  long inputTokens() { return inputTokens; }
  long outputTokens() { return outputTokens; }
}
