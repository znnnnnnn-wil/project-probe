package com.projectprobe;

import static com.projectprobe.Store.*;

import java.util.function.Supplier;

final class PaymentLease {

  final Store s;

  PaymentLease(Store s) {
    this.s = s;
  }

  String acquire(String order) {
    String token = id();
    long time = now();
    if (
      s.db.update(
        "UPDATE purchase_orders SET query_lease_until=?,query_lease_token=? WHERE id=? AND query_lease_until<=?",
        time + 25000,
        token,
        order,
        time
      ) != 1
    ) throw error(409, "订单正在处理，请稍后查询");
    return token;
  }

  <T> T guarded(String user, String order, String token, Supplier<T> work) {
    // Keep the same user -> order lock order as settlement and entitlement consumption.
    return s.locked(user, () -> {
      var row = s.one(
        "SELECT query_lease_token,query_lease_until FROM purchase_orders WHERE id=? AND user_id=? FOR UPDATE",
        order,
        user
      );
      if (
        !token.equals(row.get("query_lease_token")) ||
        ((Number) row.get("query_lease_until")).longValue() <= now()
      ) throw error(409, "订单处理已超时，请重新查询");
      return work.get();
    });
  }

  void release(String order, String token) {
    s.db.update(
      "UPDATE purchase_orders SET query_lease_until=0,query_lease_token=NULL WHERE id=? AND query_lease_token=?",
      order,
      token
    );
  }
}
