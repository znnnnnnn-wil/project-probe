package com.projectprobe;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class WebConfig extends OncePerRequestFilter {

  final String origin;
  final Map<String, long[]> attempts = new ConcurrentHashMap<>();
  final ClientAddress clientAddress;

  WebConfig(
    @Value("${app.origin}") String origin,
    @Value("${app.trusted-proxy-addresses:}") String trustedProxies
  ) {
    this.origin = origin;
    this.clientAddress = new ClientAddress(trustedProxies);
  }

  protected void doFilterInternal(
    HttpServletRequest req,
    HttpServletResponse res,
    FilterChain chain
  ) throws ServletException, IOException {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (req.getRequestURI().startsWith("/api/")) res.setHeader(
      "Cache-Control",
      "no-store"
    );
    boolean upload = req.getMethod().equals("POST") && (
      req.getRequestURI().equals("/api/resume/import") ||
      req.getRequestURI().matches("/api/trainings/[a-f0-9-]{36}/transcribe")
    ) && Objects.toString(req.getContentType(), "").startsWith("multipart/form-data");
    if (req.getContentLengthLong() > (upload ? 7 * 1024 * 1024 : 200000)) {
      res.sendError(413);
      return;
    }
    boolean mutation = !Set.of("GET", "HEAD", "OPTIONS").contains(
      req.getMethod()
    );
    if (
      mutation &&
      !req.getRequestURI().equals("/api/payments/notify") &&
      !origin.equals(req.getHeader("Origin"))
    ) {
      res.sendError(403, "来源校验失败");
      return;
    }
    if (
      mutation &&
      Set.of("/api/auth/login", "/api/auth/register").contains(
        req.getRequestURI()
      )
    ) {
      String client;
      try {
        client = clientAddress.resolve(req);
      } catch (IllegalArgumentException e) {
        res.sendError(403, "代理来源配置不正确");
        return;
      }
      long now = Store.now();
      if (attempts.size() > 10000) attempts
        .entrySet()
        .removeIf(e -> now - e.getValue()[0] > 60000);
      var counter = attempts.computeIfAbsent(client, k -> new long[] {
        now,
        0,
      });
      synchronized (counter) {
        if (now - counter[0] > 60000) {
          counter[0] = now;
          counter[1] = 0;
        }
        if (++counter[1] > 20) {
          res.setHeader(
            "Retry-After",
            Long.toString(
              Math.max(1, (60000 - (now - counter[0]) + 999) / 1000)
            )
          );
          res.sendError(429);
          return;
        }
      }
    }
    chain.doFilter(req, res);
  }
}
