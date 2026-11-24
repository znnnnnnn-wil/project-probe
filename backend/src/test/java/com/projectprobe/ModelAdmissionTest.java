package com.projectprobe;
import static org.junit.jupiter.api.Assertions.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import org.junit.jupiter.api.Test;

class ModelAdmissionTest {
  @Test void shortBurstWaitsForAReleasedSlotAndNeverLeaksPermits() throws Exception {
    var slots = new Semaphore(1, true); var waiting = new AtomicInteger();
    var occupied = ModelAdmission.enter(slots, waiting, 2, 1000, Long.MAX_VALUE);
    var executor = Executors.newSingleThreadExecutor();
    try {
      var next = executor.submit(() -> { try (var permit = ModelAdmission.enter(slots, waiting, 2, 1000, Long.MAX_VALUE)) { return slots.availablePermits(); } });
      for (int i = 0; i < 100 && waiting.get() == 0; i++) Thread.sleep(2);
      assertEquals(1, waiting.get()); occupied.close(); occupied.close();
      assertEquals(0, next.get(2, TimeUnit.SECONDS));
      assertEquals(1, slots.availablePermits()); assertEquals(0, waiting.get());
    } finally { occupied.close(); executor.shutdownNow(); }
  }
  @Test void queueIsBoundedAndExpiredGenerationDoesNotWait() {
    var slots = new Semaphore(0); var waiting = new AtomicInteger(2);
    assertEquals(429, assertThrows(org.springframework.web.server.ResponseStatusException.class,
      () -> ModelAdmission.enter(slots, waiting, 2, 1000, Long.MAX_VALUE)).getStatusCode().value());
    assertEquals(2, waiting.get()); waiting.set(0);
    assertThrows(org.springframework.web.server.ResponseStatusException.class,
      () -> ModelAdmission.enter(slots, waiting, 2, 1000, System.currentTimeMillis()));
    assertEquals(0, waiting.get()); assertEquals(0, slots.availablePermits());
  }
  @Test void timeoutAndInterruptionClearQueueMembership() throws Exception {
    var slots = new Semaphore(0); var waiting = new AtomicInteger();
    assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> ModelAdmission.enter(slots, waiting, 1, 10, Long.MAX_VALUE));
    assertEquals(0, waiting.get());
    Thread.currentThread().interrupt();
    try { assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> ModelAdmission.enter(slots, waiting, 1, 1000, Long.MAX_VALUE)); }
    finally { assertTrue(Thread.interrupted()); }
    assertEquals(0, waiting.get());
  }
}
