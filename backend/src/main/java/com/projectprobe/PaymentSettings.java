package com.projectprobe;

import java.net.URI;
import java.nio.file.*;
import java.security.*;
import java.security.spec.*;
import java.util.*;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "app.payment")
public class PaymentSettings {

  public static final String SANDBOX_GATEWAY =
    "https://openapi-sandbox.dl.alipaydev.com/gateway.do";
  public static final String PRODUCTION_GATEWAY =
    "https://openapi.alipay.com/gateway.do";
  private String mode = "mock";
  private int priceCents = 990;
  private Account sandbox = new Account(),
    production = new Account();
  private boolean reconcileEnabled;
  private boolean operationsEnabled;
  private int orderTtlMinutes = 30;
  private boolean expirySyncEnabled;
  public int getOrderTtlMinutes() { return orderTtlMinutes; }
  public void setOrderTtlMinutes(int value) { orderTtlMinutes = value; }
  public boolean isExpirySyncEnabled() { return expirySyncEnabled; }
  public void setExpirySyncEnabled(boolean value) { expirySyncEnabled = value; }

  public boolean isOperationsEnabled() {
    return operationsEnabled;
  }

  public void setOperationsEnabled(boolean value) {
    operationsEnabled = value;
  }

  public String getMode() {
    return mode;
  }

  public void setMode(String value) {
    mode = value;
  }

  public int getPriceCents() {
    return priceCents;
  }

  public void setPriceCents(int value) {
    priceCents = value;
  }

  public Account getSandbox() {
    return sandbox;
  }

  public void setSandbox(Account value) {
    sandbox = value;
  }

  public Account getProduction() {
    return production;
  }

  public void setProduction(Account value) {
    production = value;
  }

  public boolean isReconcileEnabled() {
    return reconcileEnabled;
  }

  public void setReconcileEnabled(boolean value) {
    reconcileEnabled = value;
  }

  public Account active() {
    return mode.equals("production") ? production : sandbox;
  }

  public String gateway() {
    return mode.equals("production") ? PRODUCTION_GATEWAY : SANDBOX_GATEWAY;
  }

  public String scope() {
    return mode.equals("mock")
      ? "mock"
      : mode + ":" + active().appId + ":" + active().sellerId;
  }

  public List<String> issues() {
    var issues = new ArrayList<String>();
    if (mode.equals("mock")) return issues;
    var a = active();
    if (a.appId.isBlank()) issues.add("APP_ID 未填写");
    if (a.sellerId.isBlank()) issues.add("SELLER_ID 未填写");
    if (!validKey(a.privateKey, a.privateKeyFile, true)) issues.add(
      "应用私钥缺失或不是有效的 RSA PKCS8 密钥"
    );
    if (!validKey(a.publicKey, a.publicKeyFile, false)) issues.add(
      "支付宝公钥缺失或不是有效的 RSA 公钥"
    );
    if (sameKey(a)) issues.add(
      "支付宝公钥不能填写成应用公钥，请从对应环境的官方平台获取"
    );
    if (
      !validUrl(a.notifyUrl, true) ||
      !a.notifyUrl.endsWith("/api/payments/notify")
    ) issues.add("NOTIFY_URL 须为公网 HTTPS 地址，路径 /api/payments/notify");
    if (!validUrl(a.returnUrl, mode.equals("production"))) issues.add(
      "RETURN_URL 无效，正式模式须 HTTPS"
    );
    if (!a.merchantConfirmed) issues.add(
      "尚未确认此应用属于配置的卖家账号（MERCHANT_CONFIRMED）"
    );
    return issues;
  }

  static boolean validUrl(String value, boolean https) {
    try {
      var u = URI.create(value);
      return (
        u.getHost() != null &&
        u.getUserInfo() == null &&
        u.getFragment() == null &&
        ("https".equals(u.getScheme()) ||
          (!https && "http".equals(u.getScheme())))
      );
    } catch (Exception e) {
      return false;
    }
  }

  static String key(String inline, String file) {
    try {
      String raw = file.isBlank() ? inline : Files.readString(Path.of(file));
      return raw.replaceAll("-----[^-]+-----", "").replaceAll("\\s", "");
    } catch (Exception e) {
      throw Store.error(503, "本机支付密钥文件不可读取，请检查服务端配置");
    }
  }

  static boolean validKey(String inline, String file, boolean privateKey) {
    try {
      var bytes = Base64.getDecoder().decode(key(inline, file));
      var factory = KeyFactory.getInstance("RSA");
      Key parsed = privateKey
        ? factory.generatePrivate(new PKCS8EncodedKeySpec(bytes))
        : factory.generatePublic(new X509EncodedKeySpec(bytes));
      return (
        ((java.security.interfaces.RSAKey) parsed).getModulus().bitLength() >=
        2048
      );
    } catch (Exception e) {
      return false;
    }
  }

  static boolean sameKey(Account a) {
    try {
      var factory = KeyFactory.getInstance("RSA");
      var privateKey =
        (java.security.interfaces.RSAKey) factory.generatePrivate(
          new PKCS8EncodedKeySpec(
            Base64.getDecoder().decode(key(a.privateKey, a.privateKeyFile))
          )
        );
      var publicKey = (java.security.interfaces.RSAKey) factory.generatePublic(
        new X509EncodedKeySpec(
          Base64.getDecoder().decode(key(a.publicKey, a.publicKeyFile))
        )
      );
      return privateKey.getModulus().equals(publicKey.getModulus());
    } catch (Exception e) {
      return false;
    }
  }

  public static class Account {

    private String appId = "",
      sellerId = "",
      privateKey = "",
      publicKey = "",
      privateKeyFile = "",
      publicKeyFile = "",
      notifyUrl = "",
      returnUrl = "";
    private boolean merchantConfirmed;

    public String getAppId() {
      return appId;
    }

    public void setAppId(String v) {
      appId = v;
    }

    public String getSellerId() {
      return sellerId;
    }

    public void setSellerId(String v) {
      sellerId = v;
    }

    public String getPrivateKey() {
      return privateKey;
    }

    public void setPrivateKey(String v) {
      privateKey = v;
    }

    public String getPublicKey() {
      return publicKey;
    }

    public void setPublicKey(String v) {
      publicKey = v;
    }

    public String getPrivateKeyFile() {
      return privateKeyFile;
    }

    public void setPrivateKeyFile(String v) {
      privateKeyFile = v;
    }

    public String getPublicKeyFile() {
      return publicKeyFile;
    }

    public void setPublicKeyFile(String v) {
      publicKeyFile = v;
    }

    public String getNotifyUrl() {
      return notifyUrl;
    }

    public void setNotifyUrl(String v) {
      notifyUrl = v;
    }

    public String getReturnUrl() {
      return returnUrl;
    }

    public void setReturnUrl(String v) {
      returnUrl = v;
    }

    public boolean isMerchantConfirmed() {
      return merchantConfirmed;
    }

    public void setMerchantConfirmed(boolean v) {
      merchantConfirmed = v;
    }
  }
}
