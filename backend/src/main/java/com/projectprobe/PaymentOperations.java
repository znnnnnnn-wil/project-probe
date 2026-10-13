package com.projectprobe;

import static com.projectprobe.Store.*;

import com.alipay.api.request.*;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.*;
import org.springframework.stereotype.Service;

/** Cash operations require explicit enablement; expired unpaid closure has a separate switch. */
@Service
public class PaymentOperations {

  final PaymentService pay;
  final Store s;

  PaymentOperations(PaymentService pay) {
    this.pay = pay;
    this.s = pay.s;
  }

  Map<String, Object> eligible(String user, String id) {
    var o = pay.order(user, id);
    pay.requireScope(o);
    if (
      pay.mode.equals("mock") || !pay.settings.isOperationsEnabled()
    ) throw error(409, "关单与现金退款接口未启用；训练次数返还不是现金退款");
    pay.requireConfigured();
    return o;
  }

  void acquire(String id) {
    if (
      s.db.update(
        "UPDATE purchase_orders SET query_lease_until=? WHERE id=? AND query_lease_until<?",
        now() + 25000,
        id,
        now()
      ) != 1
    ) throw error(409, "订单正在处理，请稍后查询");
  }

  void release(String id) {
    s.db.update(
      "UPDATE purchase_orders SET query_lease_until=0 WHERE id=?",
      id
    );
  }

  JsonNode body(String raw, String name, Map<String, Object> o)
    throws Exception {
    var node = s.json.readTree(raw).path(name);
    if (
      !node.isObject() ||
      !str(o, "merchant_order_no").equals(node.path("out_trade_no").asText()) ||
      !str(o, "trade_no").equals(node.path("trade_no").asText())
    ) throw error(503, "交易响应与订单不匹配");
    for (String field : List.of("app_id", "seller_id", "seller_user_id"))
      if (
        node.has(field) &&
        !(
          field.equals("app_id") ? str(o, "app_id") : str(o, "seller_id")
        ).equals(node.path(field).asText())
      ) throw error(503, "交易归属不匹配");
    return node;
  }

  Map<String, Object> close(String user, String id) {
    var o = eligible(user, id);
    return closeVerified(user, id, o);
  }

  Map<String, Object> closeExpired(String user, String id) {
    var o = pay.order(user, id);
    pay.requireScope(o);
    if (!pay.settings.isExpirySyncEnabled() || !"EXPIRED".equals(o.get("status"))) throw error(409, "未启用过期关单或订单未过期");
    pay.requireConfigured();
    return closeVerified(user, id, o);
  }

  Map<String, Object> closeVerified(String user, String id, Map<String,Object> o) {
    if ("CLOSED".equals(o.get("status"))) return o;
    if (!Set.of("PENDING", "EXPIRED").contains(str(o, "status"))) throw error(
      409,
      "只能关闭未付款订单"
    );
    // Query first: a lost successful-payment notification must not be treated as unpaid.
    pay.sync(user, id);
    o = pay.order(user, id);
    if ("EXPIRED".equals(o.get("status")) && "NOT_CREATED".equals(o.get("query_status"))) return o;
    if ("PAID".equals(o.get("status"))) throw error(409, "订单已付款，不能关闭");
    if ("CLOSED".equals(o.get("status"))) return o;
    if (
      !Set.of("PENDING", "EXPIRED").contains(str(o, "status")) ||
      !"WAIT_BUYER_PAY".equals(o.get("query_status"))
    ) throw error(409, "尚未确认待付款交易，不能关闭；请查询状态");
    acquire(id);
    try {
      var request = new AlipayTradeCloseRequest();
      request.setBizContent(
        s.encode(Map.of("out_trade_no", o.get("merchant_order_no")))
      );
      var response = pay.client().execute(request);
      if (!response.isSuccess()) throw error(
        503,
        "支付宝关单未能确认，请先查询状态"
      );
      var node = s.json
        .readTree(response.getBody())
        .path("alipay_trade_close_response");
      if (
        !node.isObject() ||
        !str(o, "merchant_order_no").equals(node.path("out_trade_no").asText())
      ) throw error(503, "关单响应订单不匹配");
      for (String field : List.of("app_id", "seller_id", "seller_user_id"))
        if (
          node.has(field) &&
          !(
            field.equals("app_id") ? str(o, "app_id") : str(o, "seller_id")
          ).equals(node.path(field).asText())
        ) throw error(503, "关单归属不匹配");
      pay.applyStatus(
        o,
        response.getTradeNo(),
        "TRADE_CLOSED",
        ((Number) o.get("amount_cents")).intValue()
      );
      return pay.order(user, id);
    } catch (Exception e) {
      pay.recordQuery(id, "QUERY_FAILED", "关单结果未确认，请查询订单状态");
      throw error(
        503,
        "关单结果未确认，请查询订单状态；不会根据失败请求关闭订单"
      );
    } finally {
      release(id);
    }
  }

  Map<String, Object> refund(String user, String id) {
    var initial = eligible(user, id);
    if ("CASH_REFUNDED".equals(initial.get("status"))) return initial;
    acquire(id);
    try {
      var r = s.locked(user, () -> {
        var o = pay.order(user, id);
        var rows = s.db.queryForList(
          "SELECT * FROM payment_refunds WHERE order_id=?",
          id
        );
        if (!rows.isEmpty()) return rows.get(0);
        if (!"PAID".equals(o.get("status"))) throw error(
          409,
          "只能为已付款且完全未使用的训练包申请全额退款"
        );
        var pack = s.one(
          "SELECT * FROM training_packages WHERE order_id=? FOR UPDATE",
          id
        );
        if (
          Boolean.TRUE.equals(pack.get("deep_used")) ||
          Boolean.TRUE.equals(pack.get("retest_used")) ||
          ((Number) pack.get("training_used")).longValue() > 0
        ) throw error(409, "训练包已使用，需要人工处理退款");
        String requestNo = "REFUND_" + id.replace("-", "");
        s.db.update(
          "INSERT INTO payment_refunds(order_id,request_no,amount_cents,status,updated_at) VALUES (?,?,?,'PROCESSING',?)",
          id,
          requestNo,
          o.get("amount_cents"),
          now()
        );
        s.db.update(
          "UPDATE purchase_orders SET status='REFUNDING',query_error='' WHERE id=?",
          id
        );
        return s.one("SELECT * FROM payment_refunds WHERE order_id=?", id);
      });
      if (
        ((Number) r.get("attempted_at")).longValue() > 0 &&
        now() - ((Number) r.get("attempted_at")).longValue() < 10000
      ) return pay.order(user, id); // Throttle retries; always reuse original identifier, amount and reason.
      s.db.update(
        "UPDATE payment_refunds SET attempted_at=?,updated_at=? WHERE order_id=?",
        now(),
        now(),
        id
      );
      var request = new AlipayTradeRefundRequest();
      request.setBizContent(
        s.encode(
          Map.of(
            "out_trade_no",
            initial.get("merchant_order_no"),
            "out_request_no",
            r.get("request_no"),
            "refund_amount",
            PaymentService.yuan(initial),
            "refund_reason",
            "未使用训练包全额退款"
          )
        )
      );
      var response = pay.client().execute(request);
      if (!response.isSuccess()) throw error(
        503,
        "退款请求结果未确认，请查询退款状态"
      );
      var node = body(
        response.getBody(),
        "alipay_trade_refund_response",
        initial
      );
      if (
        PaymentService.cents(node.path("refund_fee").asText()) !=
        ((Number) r.get("amount_cents")).intValue()
      ) throw error(503, "退款金额不匹配");
      // code=10000 or fund_change=N is not final proof. Confirm through refund query.
      return pay.order(user, id);
    } catch (org.springframework.web.server.ResponseStatusException e) {
      if (e.getStatusCode().value() != 409) unknown(id);
      throw e;
    } catch (Exception e) {
      unknown(id);
      throw error(503, "退款结果未确认，保留原请求号，请查询退款状态");
    } finally {
      release(id);
    }
  }

  void unknown(String id) {
    s.db.update(
      "UPDATE payment_refunds SET status='UNKNOWN',updated_at=? WHERE order_id=? AND status<>'SUCCEEDED'",
      now(),
      id
    );
    s.db.update(
      "UPDATE purchase_orders SET query_error='退款结果未确认，请查询退款状态' WHERE id=? AND status='REFUNDING'",
      id
    );
  }

  Map<String, Object> refundQuery(String user, String id) {
    var o = eligible(user, id);
    var r = s.one("SELECT * FROM payment_refunds WHERE order_id=?", id);
    if ("SUCCEEDED".equals(r.get("status"))) return o;
    if (
      now() - ((Number) r.get("attempted_at")).longValue() < 10000
    ) throw error(409, "退款查询请至少等待 10 秒，不要重复申请");
    acquire(id);
    try {
      var request = new AlipayTradeFastpayRefundQueryRequest();
      request.setBizContent(
        s.encode(
          Map.of(
            "out_trade_no",
            o.get("merchant_order_no"),
            "out_request_no",
            r.get("request_no")
          )
        )
      );
      var response = pay.client().execute(request);
      if (!response.isSuccess()) throw error(
        503,
        "退款查询未能确认，请稍后重试"
      );
      var node = body(
        response.getBody(),
        "alipay_trade_fastpay_refund_query_response",
        o
      );
      if (
        !str(r, "request_no").equals(node.path("out_request_no").asText()) ||
        PaymentService.cents(node.path("total_amount").asText()) !=
          ((Number) o.get("amount_cents")).intValue() ||
        PaymentService.cents(node.path("refund_amount").asText()) !=
          ((Number) r.get("amount_cents")).intValue()
      ) throw error(503, "退款查询金额或请求号不匹配");
      String state = node.path("refund_status").asText();
      if ("REFUND_SUCCESS".equals(state)) s.locked(user, () -> {
        s.db.update(
          "UPDATE payment_refunds SET status='SUCCEEDED',updated_at=? WHERE order_id=?",
          now(),
          id
        );
        s.db.update(
          "UPDATE purchase_orders SET status='CASH_REFUNDED',query_error='' WHERE id=?",
          id
        );
        return null;
      });
      else if (!"REFUND_PROCESSING".equals(state)) throw error(
        503,
        "退款状态未知，不能认定退款完成"
      );
      return pay.order(user, id);
    } catch (Exception e) {
      unknown(id);
      throw error(503, "退款查询未能确认，未更改为退款成功，请稍后重试");
    } finally {
      release(id);
    }
  }
}
