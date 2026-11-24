package com.projectprobe;

import com.fasterxml.jackson.databind.JsonNode;
import java.net.URI;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

@Component
class WatchaPayment {

  private static final String BASE_URL = "https://pay.watcha.cn";
  private final boolean enabled;
  private final String environment;
  private final String entitlementId;
  private final boolean credentialsPresent;
  private final RestClient client;

  @Autowired
  WatchaPayment(
    @Value("${app.payment.mode:disabled}") String mode,
    @Value("${app.watcha.environment:sandbox}") String environment,
    @Value("${app.watcha.api-key:}") String key,
    @Value("${app.watcha.entitlement-id:}") String entitlementId
  ) {
    this(mode, environment, key, entitlementId, clientBuilder());
  }

  WatchaPayment(String mode, String environment, String key, String entitlementId, RestClient.Builder builder) {
    this.enabled = "watcha".equals(mode);
    this.environment = environment.strip();
    this.entitlementId = entitlementId.strip();
    this.credentialsPresent = ("sandbox".equals(this.environment) || "live".equals(this.environment)) &&
      !key.isBlank() && this.entitlementId.startsWith("ent_");
    this.client = builder.baseUrl(BASE_URL)
      .defaultHeaders(headers -> {
        if (!key.isBlank()) headers.setBearerAuth(key.strip());
      })
      .build();
  }

  private static RestClient.Builder clientBuilder() {
    var http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
    var factory = new JdkClientHttpRequestFactory(http);
    factory.setReadTimeout(Duration.ofSeconds(6));
    return RestClient.builder().requestFactory(factory);
  }

  boolean enabled() {
    return enabled;
  }

  boolean configured() {
    return enabled && credentialsPresent;
  }

  String scope() {
    if (!configured()) throw unavailable();
    return "watcha:" + environment + ":" + entitlementId;
  }

  record Balance(int remaining, String purchaseUrl) {}

  Balance balance(String user) {
    var body = post("access", Map.of("entitlement_id", entitlementId, "user_id", user));
    String state = body.path("access").asText();
    boolean suspended = "unavailable".equals(state) &&
      "purchasing_suspended".equals(body.path("reason").path("code").asText());
    if (!suspended && !"granted".equals(state) && !"purchase_required".equals(state)) {
      throw unavailable();
    }
    var remaining = body.path("entitlement").path("remaining");
    // Before the first purchase the provider may omit an entitlement snapshot.
    if (remaining.isMissingNode() && "purchase_required".equals(state)) {
      return new Balance(0, purchaseUrl(body));
    }
    if (!remaining.isIntegralNumber() || !remaining.canConvertToInt() || remaining.intValue() < 0) {
      throw unavailable();
    }
    return new Balance(remaining.intValue(), suspended ? null : purchaseUrl(body));
  }

  void consume(String user, String idempotencyKey) {
    var body = post("consume", Map.of(
      "entitlement_id", entitlementId,
      "user_id", user,
      "amount", 1,
      "idempotency_key", idempotencyKey
    ));
    if (!body.path("consumed").isIntegralNumber() || body.path("consumed").asLong() != 1) {
      throw unavailable();
    }
  }

  private JsonNode post(String action, Map<String, Object> payload) {
    if (!configured()) throw unavailable();
    try {
      var body = client.post().uri("/v1/entitlements/{action}", action)
        .contentType(MediaType.APPLICATION_JSON).body(payload).retrieve().body(JsonNode.class);
      if (body == null || !body.isObject()) throw unavailable();
      return body;
    } catch (RestClientResponseException error) {
      if ("consume".equals(action) && error.getStatusCode().value() == 409 && insufficient(error)) {
        throw Store.error(402, "训练次数不足，请购买训练包后重试");
      }
      throw unavailable();
    } catch (RestClientException error) {
      throw unavailable();
    }
  }

  private static boolean insufficient(RestClientResponseException error) {
    try {
      var body = error.getResponseBodyAs(JsonNode.class);
      return body != null && "insufficient_quota".equals(body.path("error").path("code").asText());
    } catch (RuntimeException invalidResponse) {
      return false;
    }
  }

  private static String purchaseUrl(JsonNode body) {
    String value = body.path("purchase").path("url").asText();
    if (value.isBlank()) return null;
    try {
      URI uri = URI.create(value);
      if (uri.getUserInfo() != null) throw unavailable();
      if ("https".equalsIgnoreCase(uri.getScheme()) && uri.getHost() != null) return value;
      if ("alipays".equalsIgnoreCase(uri.getScheme()) && "platformapi".equalsIgnoreCase(uri.getHost()) &&
        "/startapp".equals(uri.getPath())) return value;
    } catch (IllegalArgumentException invalidUrl) {
      throw unavailable();
    }
    throw unavailable();
  }

  private static org.springframework.web.server.ResponseStatusException unavailable() {
    return Store.error(503, "训练包服务暂不可用，请稍后重试");
  }
}
