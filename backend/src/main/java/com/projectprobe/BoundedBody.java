package com.projectprobe;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.Flow;

/** Enforces a byte limit while receiving, including chunked responses. */
final class BoundedBody implements HttpResponse.BodySubscriber<String> {

  final int limit;
  final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
  final CompletableFuture<String> result = new CompletableFuture<>();
  Flow.Subscription subscription;

  BoundedBody(int limit) {
    this.limit = limit;
  }

  static HttpResponse.BodyHandler<String> handler(int limit) {
    return info -> new BoundedBody(limit);
  }

  public CompletionStage<String> getBody() {
    return result;
  }

  public void onSubscribe(Flow.Subscription subscription) {
    if (this.subscription != null) {
      subscription.cancel();
      return;
    }
    this.subscription = subscription;
    subscription.request(1);
  }

  public void onNext(List<ByteBuffer> buffers) {
    if (result.isDone()) return;
    for (var buffer : buffers) {
      if (buffer.remaining() > limit - bytes.size()) {
        subscription.cancel();
        result.completeExceptionally(
          new IOException("response_limit_exceeded")
        );
        return;
      }
      byte[] chunk = new byte[buffer.remaining()];
      buffer.get(chunk);
      bytes.writeBytes(chunk);
    }
    subscription.request(1);
  }

  public void onError(Throwable error) {
    result.completeExceptionally(error);
  }

  public void onComplete() {
    result.complete(bytes.toString(StandardCharsets.UTF_8));
  }
}
