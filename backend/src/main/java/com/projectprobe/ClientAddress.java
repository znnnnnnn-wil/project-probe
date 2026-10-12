package com.projectprobe;

import jakarta.servlet.http.HttpServletRequest;
import java.net.InetAddress;
import java.util.*;

/** 只信任直接连接的已配置代理，以及代理覆盖写入的单值地址。 */
final class ClientAddress {

  private final Set<String> trusted;

  ClientAddress(String addresses) {
    trusted = new HashSet<>();
    for (String address : addresses.split(",")) {
      if (!address.isBlank()) trusted.add(normalize(address.strip()));
    }
  }

  static String normalize(String address) {
    if (
      address == null ||
      address.length() > 64 ||
      !address.matches("[0-9a-fA-F:.]+") ||
      (!address.contains(":") &&
        !address.matches("(?:[0-9]{1,3}\\.){3}[0-9]{1,3}"))
    ) throw new IllegalArgumentException("需要合法的 IP 字面量");
    if (!address.contains(":")) for (String segment : address.split("\\.")) {
      if (Integer.parseInt(segment) > 255) throw new IllegalArgumentException(
        "IPv4 不合法"
      );
    }
    try {
      return InetAddress.getByName(address).getHostAddress();
    } catch (Exception e) {
      throw new IllegalArgumentException("IP 地址不合法");
    }
  }

  String resolve(HttpServletRequest request) {
    String peer = normalize(request.getRemoteAddr());
    if (!trusted.contains(peer)) return peer;
    var headers = Collections.list(request.getHeaders("X-Probe-Client-IP"));
    if (headers.size() != 1) throw new IllegalArgumentException(
      "可信代理必须提供单个客户端地址"
    );
    return normalize(headers.get(0));
  }
}
