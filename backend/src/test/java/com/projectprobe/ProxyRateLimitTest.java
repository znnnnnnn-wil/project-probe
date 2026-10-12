package com.projectprobe;

import static org.junit.jupiter.api.Assertions.*;

import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class ProxyRateLimitTest {

  static final String ORIGIN = "https://app.test";

  int attempt(
    WebConfig filter,
    String peer,
    String path,
    String client,
    String xff
  ) throws Exception {
    var req = new MockHttpServletRequest("POST", path);
    req.setRemoteAddr(peer);
    req.addHeader("Origin", ORIGIN);
    if (client != null) req.addHeader("X-Probe-Client-IP", client);
    if (xff != null) {
      req.addHeader("X-Forwarded-For", xff);
      req.addHeader("Forwarded", "for=" + xff);
    }
    var res = new MockHttpServletResponse();
    filter.doFilter(req, res, (q, r) -> {});
    return res.getStatus();
  }

  @Test
  void trustedProxyClientsHaveIndependentBudgetsAndLogoutRemainsAvailable()
    throws Exception {
    var filter = new WebConfig(ORIGIN, "172.30.88.10");
    for (int i = 0; i < 20; i++) assertEquals(
      200,
      attempt(
        filter,
        "172.30.88.10",
        i % 2 == 0 ? "/api/auth/login" : "/api/auth/register",
        "198.51.100.1",
        null
      )
    );
    assertEquals(
      429,
      attempt(
        filter,
        "172.30.88.10",
        "/api/auth/login",
        "198.51.100.1",
        "203.0.113.2"
      )
    );
    assertEquals(
      200,
      attempt(filter, "172.30.88.10", "/api/auth/login", "198.51.100.2", null)
    );
    assertEquals(
      200,
      attempt(filter, "172.30.88.10", "/api/auth/logout", "198.51.100.1", null)
    );
  }

  @Test
  void directClientsCannotRotateHeadersToBypassLimit() throws Exception {
    var filter = new WebConfig(ORIGIN, "172.30.88.10");
    for (int i = 0; i < 20; i++) assertEquals(
      200,
      attempt(
        filter,
        "198.51.100.3",
        "/api/auth/login",
        "203.0.113." + i,
        "192.0.2." + i
      )
    );
    assertEquals(
      429,
      attempt(
        filter,
        "198.51.100.3",
        "/api/auth/login",
        "192.0.2.99",
        "192.0.2.99"
      )
    );
    assertEquals(
      200,
      attempt(filter, "198.51.100.4", "/api/auth/login", "192.0.2.99", null)
    );
    assertEquals(
      200,
      attempt(filter, "198.51.100.3", "/api/auth/logout", null, null)
    );
  }

  @Test
  void invalidOrMissingProxyAddressIsRejectedAndWindowResets()
    throws Exception {
    var filter = new WebConfig(ORIGIN, "172.30.88.10");
    for (String header : new String[] {
      null,
      "hostname.test",
      "198.51.100.1, 198.51.100.2",
      "999.1.1.1",
    })
      assertEquals(
        403,
        attempt(filter, "172.30.88.10", "/api/auth/login", header, null)
      );
    filter.attempts.put("198.51.100.5", new long[] {
      Store.now() - 61000,
      100,
    });
    assertEquals(
      200,
      attempt(filter, "198.51.100.5", "/api/auth/login", null, null)
    );
    assertEquals(
      ClientAddress.normalize("::1"),
      new ClientAddress("").resolve(ipv6Request())
    );
  }

  org.springframework.mock.web.MockHttpServletRequest ipv6Request() {
    var r = new MockHttpServletRequest();
    r.setRemoteAddr("::1");
    return r;
  }
}
