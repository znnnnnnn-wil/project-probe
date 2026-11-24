package com.projectprobe;

import static com.projectprobe.Store.*;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

@Service
class OrderExpiryService {

  final PaymentService pay;
  final PaymentOperations operations;

  OrderExpiryService(PaymentService pay, PaymentOperations operations) {
    this.pay = pay;
    this.operations = operations;
  }

  @Scheduled(fixedDelayString = "${app.payment-expiry-delay:60000}")
  void sweep() {
    pay.expireDue();
    if (
      !pay.settings.isExpirySyncEnabled() ||
      pay.mode.equals("mock") ||
      !pay.configured()
    ) return;
    // NOT_CREATED 仅代表查询时不存在交易。已发出表单的订单每小时重查，
    // 防止迟到提交或通知丢失永久遗漏；未发出表单的订单无需重复查询。
    for (var o : pay.s.db.queryForList(
      "SELECT id,user_id FROM purchase_orders WHERE mode=? AND account_scope=? AND status='EXPIRED' AND last_query_at<? AND query_lease_until<? AND (query_status<>'NOT_CREATED' OR (checkout_requested=TRUE AND last_query_at<?)) ORDER BY last_query_at LIMIT 10",
      pay.mode,
      pay.scope(),
      now() - 60000,
      now(),
      now() - 3600000
    )) {
      try {
        operations.closeExpired(str(o, "user_id"), str(o, "id"));
      } catch (Exception ignored) {
        /* 查询/关单失败保留待确认，禁止伪造平台 CLOSED。 */
      }
    }
  }
}
