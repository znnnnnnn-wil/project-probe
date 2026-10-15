package com.projectprobe;

import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import java.io.*;
import java.nio.charset.StandardCharsets;

/** Limits actual bytes read even when Content-Length is absent. */
final class LimitedRequest extends HttpServletRequestWrapper {

  static final class TooLarge extends IOException {}

  final long limit;
  ServletInputStream stream;

  LimitedRequest(HttpServletRequest request, long limit) {
    super(request);
    this.limit = limit;
  }

  public ServletInputStream getInputStream() throws IOException {
    if (stream != null) return stream;
    var source = super.getInputStream();
    stream = new ServletInputStream() {
      long received;

      void counted(int amount) throws TooLarge {
        if (amount > 0 && (received += amount) > limit) throw new TooLarge();
      }

      public int read() throws IOException {
        int value = source.read();
        if (value != -1) counted(1);
        return value;
      }

      public int read(byte[] bytes, int offset, int length) throws IOException {
        int allowed = (int) Math.min(length, Math.max(1, limit - received + 1));
        int count = source.read(bytes, offset, allowed);
        counted(count);
        return count;
      }

      public boolean isFinished() {
        return source.isFinished();
      }

      public boolean isReady() {
        return source.isReady();
      }

      public void setReadListener(ReadListener listener) {
        source.setReadListener(listener);
      }

      public void close() throws IOException {
        source.close();
      }
    };
    return stream;
  }

  public BufferedReader getReader() throws IOException {
    return new BufferedReader(
      new InputStreamReader(
        getInputStream(),
        getCharacterEncoding() == null
          ? StandardCharsets.UTF_8
          : java.nio.charset.Charset.forName(getCharacterEncoding())
      )
    );
  }
}
