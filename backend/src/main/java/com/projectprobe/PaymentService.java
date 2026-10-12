package com.projectprobe;

import static com.projectprobe.Store.*;

import com.alipay.api.*;
import com.alipay.api.internal.util.AlipaySignature;
import com.alipay.api.request.*;
import java.math.BigDecimal;
import java.net.URI;
import java.util.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

@Service
public class PaymentService {

  final Store s;
  final PaymentSettings settings;
  final String mode;

  @Autowired
  PaymentService(Store s, PaymentSettings settings) {
    this.s = s;
    this.settings = settings;
    this.mode = settings.getMode();
    if (settings.getOrderTtlMinutes() < 1 || settings.getOrderTtlMinutes() > 1440)
      throw new IllegalArgumentException("订单有效期须为 1–1440 分钟");
    if (
      !Set.of("mock", "sandbox", "production").contains(mode)
    ) throw new IllegalArgumentException(
      "PAYMENT_MODE 只能为 mock、sandbox、production"
    );
    if (
      settings.getPriceCents() < 1 || settings.getPriceCents() > 100000000
    ) throw new IllegalArgumentException("训练包价格须为 1–100000000 分");
    if (
      !settings.getSandbox().getAppId().isBlank() &&
      settings
        .getSandbox()
        .getAppId()
        .equals(settings.getProduction().getAppId())
    ) throw new IllegalArgumentException("沙箱和正式应用不能使用同一 APP_ID");
  }

  // 保留合成测试构造方式，不读取任何运行账户配置。
  PaymentService(
    Store s,
    String mode,
    String appId,
    String privateKey,
    String publicKey,
    String sellerId,
    String notifyUrl,
    String returnUrl
  ) {
    this(
      s,
      testSettings(
        mode,
        appId,
        privateKey,
        publicKey,
        sellerId,
        notifyUrl,
        returnUrl
      )
    );
  }

  static PaymentSettings testSettings(
    String mode,
    String appId,
    String privateKey,
    String publicKey,
    String sellerId,
    String notifyUrl,
    String returnUrl
  ) {
    var cfg = new PaymentSettings();
    cfg.setMode(mode);
    var a = cfg.active();
    a.setAppId(appId);
    a.setPrivateKey(privateKey);
    a.setPublicKey(publicKey);
    a.setSellerId(sellerId);
    a.setNotifyUrl(notifyUrl);
    a.setReturnUrl(returnUrl);
    a.setMerchantConfirmed(true);
    return cfg;
  }

  boolean configured() {
    return mode.equals("mock") || settings.issues().isEmpty();
  }

  void requireConfigured() {
    if (!configured()) throw error(
      503,
      "支付宝配置未完成，不能发起支付或查询；不会回退模拟支付"
    );
  }

  String scope() {
    return settings.scope();
  }

  boolean ownsScope(Map<String, Object> order) {
    return (
      mode.equals(order.get("mode")) &&
      (scope().equals(order.get("account_scope")) ||
        (mode.equals("mock") && "legacy".equals(order.get("account_scope"))))
    );
  }

  void requireScope(Map<String, Object> order) {
    if (!ownsScope(order)) throw error(
      409,
      "订单属于其他支付环境或应用账号，不能操作"
    );
  }

  Map<String, Object> create(String user, Map<String, Object> input) {
    return s.locked(user, () -> {
      String key = required(input, "requestKey", 100);
      var rows = s.db.queryForList(
        "SELECT * FROM purchase_orders WHERE user_id=? AND request_key=?",
        user,
        key
      );
      if (!rows.isEmpty()) {
        requireScope(rows.get(0));
        return order(user, str(rows.get(0), "id"));
      }
      String id = id(),
        merchantNo = mode.toUpperCase(Locale.ROOT) + "_" + id.replace("-", "");
      var a = settings.active();
      s.db.update(
        "INSERT INTO purchase_orders(id,user_id,request_key,amount_cents,mode,status,created_at,app_id,seller_id,account_scope,merchant_order_no,expires_at) VALUES (?,?,?,?,?,'PENDING',?,?,?,?,?,?)",
        id,
        user,
        key,
        settings.getPriceCents(),
        mode,
        now(),
        mode.equals("mock") ? "" : a.getAppId(),
        mode.equals("mock") ? "" : a.getSellerId(),
        scope(),
        merchantNo,
        now() + settings.getOrderTtlMinutes() * 60000L
      );
      return order(user, id);
    });
  }

  Map<String, Object> order(String user, String id) {
    var o = s.one(
      "SELECT * FROM purchase_orders WHERE user_id=? AND id=?",
      user,
      id
    );
    if (ownsScope(o) && "PENDING".equals(o.get("status")) && ((Number)o.get("expires_at")).longValue() <= now()) {
      expireOrder(id);
      o = s.one("SELECT * FROM purchase_orders WHERE user_id=? AND id=?", user, id);
    }
    o.put("can_operate", ownsScope(o));
    o.put("can_pay", ownsScope(o) && "PENDING".equals(o.get("status")) && ((Number)o.get("expires_at")).longValue() > now());
    return o;
  }

  void expireOrder(String id) {
    s.db.update("UPDATE purchase_orders SET status='EXPIRED' WHERE id=? AND status='PENDING' AND expires_at<=? AND mode=? AND account_scope=?", id, now(), mode, scope());
  }

  void expireDue() {
    for (var o : s.db.queryForList("SELECT id FROM purchase_orders WHERE mode=? AND account_scope=? AND status='PENDING' AND expires_at<=? ORDER BY expires_at LIMIT 100", mode, scope(), now()))
      expireOrder(str(o, "id"));
  }

  List<Map<String, Object>> packages(String user) {
    return s.db.queryForList(
      "SELECT p.* FROM training_packages p JOIN purchase_orders o ON o.id=p.order_id WHERE p.user_id=? AND o.mode=? AND o.status='PAID' AND (o.account_scope=? OR (o.mode='mock' AND o.account_scope='legacy'))",
      user,
      mode,
      scope()
    );
  }

  Map<String, Object> shop(String user) {
    var orders = s.db.queryForList(
      "SELECT * FROM purchase_orders WHERE user_id=? ORDER BY created_at DESC",
      user
    );
    for (int i=0; i<orders.size(); i++) orders.set(i, order(user, str(orders.get(i), "id")));
    return Map.of(
      "product",
      Map.of(
        "name",
        "项目深挖训练包",
        "amountCents",
        settings.getPriceCents(),
        "description",
        "一次完整深挖 + 一次关联专项复测"
      ),
      "mode",
      mode,
      "configured",
      configured(),
      "configurationIssues",
      settings.issues(),
      "orders",
      orders,
      "packages",
      packages(user)
    );
  }

  static int cents(String amount) {
    try {
      if (
        amount == null || !amount.matches("[0-9]{1,9}(\\.[0-9]{1,2})?")
      ) throw new IllegalArgumentException();
      int value = new BigDecimal(amount).movePointRight(2).intValueExact();
      if (value < 1) throw new IllegalArgumentException();
      return value;
    } catch (Exception e) {
      throw error(400, "支付金额格式不正确");
    }
  }

  static String yuan(Map<String, Object> order) {
    return BigDecimal.valueOf(
      ((Number) order.get("amount_cents")).longValue(),
      2
    ).toPlainString();
  }

  void validateTrade(
    Map<String, Object> order,
    String transactionId,
    int amount
  ) {
    requireScope(order);
    if (amount != ((Number) order.get("amount_cents")).intValue()) throw error(
      400,
      "订单金额不匹配"
    );
    if (
      transactionId == null ||
      transactionId.isBlank() ||
      transactionId.length() > 100
    ) throw error(400, "交易号不合法");
    if (
      order.get("trade_no") != null &&
      !transactionId.equals(order.get("trade_no"))
    ) throw error(400, "交易号不匹配");
  }

  void settle(
    String orderId,
    String transactionId,
    String expectedMode,
    int amount
  ) {
    var initial = s.one("SELECT * FROM purchase_orders WHERE id=?", orderId);
    s.locked(str(initial, "user_id"), () -> {
      var order = s.one(
        "SELECT * FROM purchase_orders WHERE id=? FOR UPDATE",
        orderId
      );
      if (!mode.equals(expectedMode)) throw error(400, "支付环境不匹配");
      validateTrade(order, transactionId, amount);
      if ("PAID".equals(order.get("status"))) return null;
      if (
        Set.of("REFUNDING", "CASH_REFUNDED", "REVIEW_REQUIRED").contains(
          str(order, "status")
        ) &&
        s.db.queryForObject(
          "SELECT COUNT(*) FROM training_packages WHERE order_id=?",
          Integer.class,
          orderId
        ) == 1
      ) return null;
      if (!Set.of("PENDING", "EXPIRED").contains(str(order, "status"))) throw error(
        409,
        "订单状态不允许发放权益"
      );
      s.db.update(
        "UPDATE purchase_orders SET status='PAID',trade_no=?,query_status='PAID',query_error='' WHERE id=?",
        transactionId,
        orderId
      );
      String packageId = id();
      s.db.update(
        "INSERT INTO training_packages(id,user_id,order_id) VALUES (?,?,?)",
        packageId,
        order.get("user_id"),
        orderId
      );
      s.db.update(
        "INSERT INTO entitlement_events VALUES (?,?,?,?,?)",
        id(),
        packageId,
        null,
        "GRANTED",
        now()
      );
      return null;
    });
  }

  Map<String, Object> mock(String user, String id) {
    if (!mode.equals("mock")) throw error(404, "模拟支付未启用");
    var o = order(user, id);
    requireScope(o);
    if ("PAID".equals(o.get("status"))) return o;
    if (!Boolean.TRUE.equals(o.get("can_pay"))) throw error(409, "订单已过期或不可付款，请创建新订单；已有付款请查询确认");
    settle(
      id,
      "MOCK-" + id,
      "mock",
      ((Number) o.get("amount_cents")).intValue()
    );
    return order(user, id);
  }

  AlipayClient client() throws AlipayApiException {
    var a = settings.active();
    var c = new AlipayConfig();
    c.setServerUrl(settings.gateway());
    c.setAppId(a.getAppId());
    c.setPrivateKey(
      PaymentSettings.key(a.getPrivateKey(), a.getPrivateKeyFile())
    );
    c.setAlipayPublicKey(
      PaymentSettings.key(a.getPublicKey(), a.getPublicKeyFile())
    );
    c.setFormat("json");
    c.setCharset("UTF-8");
    c.setSignType("RSA2");
    c.setConnectTimeout(5000);
    c.setReadTimeout(10000);
    return new DefaultAlipayClient(c);
  }

  String returnAddress(String id) {
    String base = settings.active().getReturnUrl();
    return base + (base.contains("?") ? "&" : "?") + "probe_order=" + id;
  }

  String checkout(String user, String id) {
    return s.locked(user, () -> {
      s.one("SELECT id FROM purchase_orders WHERE user_id=? AND id=? FOR UPDATE", user, id);
      return checkoutLocked(user, id);
    });
  }

  String checkoutLocked(String user, String id) {
    var o = order(user, id);
    requireScope(o);
    if (mode.equals("mock")) throw error(409, "当前是模拟支付环境");
    requireConfigured();
    if (!Boolean.TRUE.equals(o.get("can_pay"))) throw error(409, "订单已过期或不可付款，请创建新订单；已有付款请查询确认");
    if (!"PENDING".equals(o.get("status"))) throw error(
      409,
      "此订单不能发起支付"
    );
    try {
      var r = new AlipayTradePagePayRequest();
      r.setNotifyUrl(settings.active().getNotifyUrl());
      r.setReturnUrl(returnAddress(id));
      r.setBizContent(
        s.encode(
          Map.of(
            "out_trade_no",
            o.get("merchant_order_no"),
            "total_amount",
            yuan(o),
            "subject",
            "项目追问官训练包",
            "product_code",
            "FAST_INSTANT_TRADE_PAY",
            "timeout_express",
            Math.max(1, (((Number)o.get("expires_at")).longValue()-now()+59999)/60000) + "m"
          )
        )
      );
      var response = client().pageExecute(r, "POST");
      if (!response.isSuccess()) throw error(503, "支付宝支付请求生成失败");
      var matcher = java.util.regex.Pattern.compile(
        "action=\"([^\"]+)\""
      ).matcher(response.getBody());
      if (!matcher.find()) throw error(503, "支付宝支付表单缺少地址");
      var url = URI.create(matcher.group(1).replace("&amp;", "&"));
      var gateway = URI.create(settings.gateway());
      if (
        !"https".equals(url.getScheme()) ||
        !gateway.getHost().equals(url.getHost()) ||
        !"/gateway.do".equals(url.getPath()) ||
        url.getFragment() != null ||
        url.getUserInfo() != null ||
        (url.getPort() != -1 && url.getPort() != 443)
      ) throw error(503, "支付宝支付地址不符合当前环境");
      s.db.update(
        "UPDATE purchase_orders SET checkout_requested=TRUE WHERE id=?",
        id
      );
      return response.getBody();
    } catch (AlipayApiException | IllegalArgumentException e) {
      throw error(503, "支付宝请求失败，请检查服务端配置");
    }
  }

  Map<String, Object> sync(String user, String id) {
    var o = order(user, id);
    requireScope(o);
    if (mode.equals("mock")) throw error(409, "模拟订单不能查询支付宝");
    requireConfigured();
    if (
      s.db.update(
        "UPDATE purchase_orders SET query_lease_until=? WHERE id=? AND query_lease_until<?",
        now() + 25000,
        id,
        now()
      ) != 1
    ) throw error(409, "订单正在查询，请稍后刷新");
    try {
      var r = new AlipayTradeQueryRequest();
      r.setBizContent(
        s.encode(Map.of("out_trade_no", o.get("merchant_order_no")))
      );
      // execute 对同步响应验签；pageExecute 只生成跳转地址，不能用于查询确认。
      var response = client().execute(r);
      if (!response.isSuccess()) {
        if ("ACQ.TRADE_NOT_EXIST".equals(response.getSubCode())) {
          recordQuery(id, "NOT_CREATED", "");
          return order(user, id);
        }
        throw error(503, "支付宝查询失败，请稍后重试");
      }
      if (
        !o.get("merchant_order_no").equals(response.getOutTradeNo())
      ) throw error(503, "查询返回的商户订单号不匹配");
      // 查询协议不保证回传 app_id/seller_id；用当前签名账号和订单账号快照绑定。
      // 如响应额外提供归属字段，必须匹配，不能忽略错误归属。
      var root = s.json
        .readTree(response.getBody())
        .path("alipay_trade_query_response");
      if (!root.isObject()) throw error(503, "查询响应结构不合法");
      for (String field : List.of("app_id", "seller_id", "seller_user_id"))
        if (
          root.has(field) &&
          !(
            field.equals("app_id")
              ? settings.active().getAppId()
              : settings.active().getSellerId()
          ).equals(root.path(field).asText())
        ) throw error(503, "查询交易归属不匹配");
      validateTrade(o, response.getTradeNo(), cents(response.getTotalAmount()));
      applyStatus(
        o,
        response.getTradeNo(),
        response.getTradeStatus(),
        cents(response.getTotalAmount())
      );
      return order(user, id);
    } catch (Exception e) {
      recordQuery(
        id,
        "QUERY_FAILED",
        "支付宝查询未能确认付款；请重试或联系服务方"
      );
      throw error(
        503,
        "支付宝查询未能确认付款；订单与权益未按失败查询变更，请重试"
      );
    } finally {
      s.db.update(
        "UPDATE purchase_orders SET query_lease_until=0 WHERE id=?",
        id
      );
    }
  }

  void recordQuery(String id, String status, String message) {
    s.db.update(
      "UPDATE purchase_orders SET last_query_at=?,query_status=?,query_error=? WHERE id=?",
      now(),
      status,
      message,
      id
    );
  }

  void applyStatus(
    Map<String, Object> initial,
    String trade,
    String status,
    int amount
  ) {
    if (Set.of("TRADE_SUCCESS", "TRADE_FINISHED").contains(status)) {
      settle(str(initial, "id"), trade, mode, amount);
      recordQuery(str(initial, "id"), "PAID", "");
      return;
    }
    if (!Set.of("WAIT_BUYER_PAY", "TRADE_CLOSED").contains(status)) throw error(
      400,
      "未知支付宝交易状态"
    );
    s.locked(str(initial, "user_id"), () -> {
      var o = s.one(
        "SELECT * FROM purchase_orders WHERE id=? FOR UPDATE",
        initial.get("id")
      );
      validateTrade(o, trade, amount);
      if (status.equals("TRADE_CLOSED")) {
        if (
          Set.of("REFUNDING", "CASH_REFUNDED").contains(str(o, "status"))
        ) return null;
        String next = Set.of("PAID", "REVIEW_REQUIRED").contains(
          str(o, "status")
        )
          ? "REVIEW_REQUIRED"
          : "CLOSED";
        s.db.update(
          "UPDATE purchase_orders SET status=?,trade_no=?,query_status=?,query_error='',last_query_at=? WHERE id=?",
          next,
          trade,
          next,
          now(),
          o.get("id")
        );
      } else if (Set.of("PENDING", "EXPIRED").contains(str(o, "status"))) {
        s.db.update(
          "UPDATE purchase_orders SET trade_no=? WHERE id=? AND trade_no IS NULL",
          trade,
          o.get("id")
        );
        recordQuery(str(o, "id"), "WAIT_BUYER_PAY", "");
      }
      return null;
    });
  }

  String notify(Map<String, String> params) {
    if (mode.equals("mock") || !configured()) return "failure";
    try {
      var a = settings.active();
      if (
        !"RSA2".equals(params.get("sign_type")) ||
        !AlipaySignature.rsaCheckV1(
          new HashMap<>(params),
          PaymentSettings.key(a.getPublicKey(), a.getPublicKeyFile()),
          "UTF-8",
          "RSA2"
        )
      ) return "failure";
      if (
        !a.getAppId().equals(params.get("app_id")) ||
        !a.getSellerId().equals(params.get("seller_id"))
      ) return "failure";
      var o = s.one(
        "SELECT * FROM purchase_orders WHERE merchant_order_no=?",
        params.get("out_trade_no")
      );
      requireScope(o);
      if (
        !a.getAppId().equals(o.get("app_id")) ||
        !a.getSellerId().equals(o.get("seller_id"))
      ) return "failure";
      return s.locked(str(o, "user_id"), () -> {
        if (
          !Set.of(
            "TRADE_SUCCESS",
            "TRADE_FINISHED",
            "WAIT_BUYER_PAY",
            "TRADE_CLOSED"
          ).contains(params.get("trade_status"))
        ) throw error(400, "未知交易状态");
        validateTrade(
          s.one(
            "SELECT * FROM purchase_orders WHERE id=? FOR UPDATE",
            o.get("id")
          ),
          params.get("trade_no"),
          cents(params.get("total_amount"))
        );
        boolean otherEvent = List.of("out_biz_no", "gmt_refund", "refund_fee")
          .stream()
          .anyMatch(
            field -> params.get(field) != null && !params.get(field).isBlank()
          );
        String eventKey;
        try {
          eventKey = java.util.HexFormat.of().formatHex(
            java.security.MessageDigest.getInstance("SHA-256").digest(
              (
                scope() +
                "|" +
                params.getOrDefault("notify_id", "") +
                "|" +
                o.get("id") +
                "|" +
                params.get("trade_no") +
                "|" +
                params.get("trade_status") +
                "|" +
                params.getOrDefault("out_biz_no", "") +
                "|" +
                params.getOrDefault("gmt_refund", "") +
                "|" +
                params.getOrDefault("refund_fee", "")
              ).getBytes(java.nio.charset.StandardCharsets.UTF_8)
            )
          );
        } catch (Exception e) {
          throw new IllegalStateException("通知事件标识生成失败");
        }
        if (
          s.db.queryForObject(
            "SELECT COUNT(*) FROM payment_notification_events WHERE event_key=?",
            Integer.class,
            eventKey
          ) > 0
        ) return "success";
        if (otherEvent) {
          s.locked(str(o, "user_id"), () -> {
            var current = s.one(
              "SELECT * FROM purchase_orders WHERE id=? FOR UPDATE",
              o.get("id")
            );
            validateTrade(
              current,
              params.get("trade_no"),
              cents(params.get("total_amount"))
            );
            if (
              Set.of("PAID", "PENDING").contains(str(current, "status"))
            ) s.db.update(
              "UPDATE purchase_orders SET status='REVIEW_REQUIRED',trade_no=? WHERE id=?",
              params.get("trade_no"),
              o.get("id")
            );
            return null;
          });
        } else {
          applyStatus(
            o,
            params.get("trade_no"),
            params.get("trade_status"),
            cents(params.get("total_amount"))
          );
        }
        s.db.update(
          "INSERT INTO payment_notification_events VALUES (?,?,?,?,?)",
          eventKey,
          o.get("id"),
          otherEvent ? "OTHER" : "PAYMENT",
          params.get("trade_status"),
          now()
        );
        return "success";
      });
    } catch (Exception e) {
      return "failure";
    }
  }

  @Scheduled(fixedDelayString = "${app.payment-reconcile-delay:60000}")
  void reconcile() {
    if (
      !settings.isReconcileEnabled() || mode.equals("mock") || !configured()
    ) return;
    var orders = s.db.queryForList(
      "SELECT id,user_id FROM purchase_orders WHERE mode=? AND account_scope=? AND status='PENDING' AND checkout_requested=TRUE AND created_at>? AND last_query_at<? AND query_lease_until<? ORDER BY last_query_at LIMIT 10",
      mode,
      scope(),
      now() - 86400000,
      now() - 60000,
      now()
    );
    for (var o : orders)
      try {
        sync(str(o, "user_id"), str(o, "id"));
      } catch (Exception ignored) {
        /* 保存脱敏查询错误，不记录密钥或通知全文。 */
      }
  }
}
