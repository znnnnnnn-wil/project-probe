package com.projectprobe;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.Flow;
import org.junit.jupiter.api.Test;

class BoundedBodyTest {

  @Test
  void decodesUtf8AcrossChunksAtExactByteLimit() {
    var data = "合成测试".getBytes(StandardCharsets.UTF_8);
    var body = new BoundedBody(data.length);
    body.onSubscribe(mock(Flow.Subscription.class));
    body.onNext(List.of(ByteBuffer.wrap(data, 0, 1)));
    body.onNext(List.of(ByteBuffer.wrap(data, 1, data.length - 1)));
    body.onComplete();
    assertEquals("合成测试", body.getBody().toCompletableFuture().join());
  }

  @Test
  void cancelsOversizeChunkWithoutBufferingIt() {
    var subscription = mock(Flow.Subscription.class);
    var body = new BoundedBody(5);
    body.onSubscribe(subscription);
    body.onNext(List.of(ByteBuffer.wrap(new byte[3])));
    body.onNext(List.of(ByteBuffer.wrap(new byte[3])));
    assertTrue(body.getBody().toCompletableFuture().isCompletedExceptionally());
    assertEquals(3, body.bytes.size());
    verify(subscription).cancel();
    body.onComplete();
    assertTrue(body.getBody().toCompletableFuture().isCompletedExceptionally());
  }
}
