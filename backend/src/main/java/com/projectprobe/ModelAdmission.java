package com.projectprobe;
import static com.projectprobe.Store.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

final class ModelAdmission {
  static Permit enter(Semaphore slots, AtomicInteger waiting, int maxQueued, int waitMillis, long deadline) {
    try {
      if (slots.tryAcquire(0, TimeUnit.MILLISECONDS)) return new Permit(slots);
      if (maxQueued == 0 || waitMillis == 0) throw error(429, "训练人数较多，请稍后重试；已提交回答仍保留");
      for (;;) {
        int count = waiting.get();
        if (count >= maxQueued) throw error(429, "训练等候人数已满，请稍后重试；已提交回答仍保留");
        if (waiting.compareAndSet(count, count + 1)) break;
      }
      try {
        long budget = Math.min(waitMillis, Math.max(0, deadline - now() - 1000));
        if (budget == 0 || !slots.tryAcquire(budget, TimeUnit.MILLISECONDS))
          throw error(429, "训练等候超时，请稍后重试");
        return new Permit(slots);
      } finally { waiting.decrementAndGet(); }
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw error(503, "等候已中断，已有回答保留，可稍后恢复");
    }
  }
  static final class Permit implements AutoCloseable {
    private final Semaphore slots;
    private final AtomicBoolean closed = new AtomicBoolean();
    Permit(Semaphore slots) { this.slots = slots; }
    public void close() { if (closed.compareAndSet(false, true)) slots.release(); }
  }
}
