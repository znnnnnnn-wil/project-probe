package com.projectprobe;

import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestControllerAdvice
public class Errors {

  private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(
    Errors.class
  );

  @ExceptionHandler({
    org.springframework.http.converter.HttpMessageNotReadableException.class,
    org.springframework.web.method.annotation.MethodArgumentTypeMismatchException.class,
    org.springframework.web.bind.MissingServletRequestParameterException.class,
  })
  ResponseEntity<?> invalidRequest(Exception error) {
    for (Throwable cause = error; cause != null; cause = cause.getCause()) if (
      cause instanceof LimitedRequest.TooLarge
    ) return ResponseEntity.status(413).body(Map.of("message", "请求内容过大"));
    return ResponseEntity.badRequest().body(
      Map.of("message", "请求参数格式不正确")
    );
  }

  @ExceptionHandler(
    org.springframework.web.multipart.MaxUploadSizeExceededException.class
  )
  ResponseEntity<?> uploadTooLarge() {
    return ResponseEntity.status(413).body(
      Map.of("message", "文件过大，请缩小后再上传")
    );
  }

  @ExceptionHandler(
    org.springframework.web.multipart.support.MissingServletRequestPartException.class
  )
  ResponseEntity<?> missingFile() {
    return ResponseEntity.badRequest().body(
      Map.of("message", "请选择要上传的文件")
    );
  }

  @ExceptionHandler(ResponseStatusException.class)
  ResponseEntity<?> expected(ResponseStatusException e) {
    return ResponseEntity.status(e.getStatusCode()).body(
      Map.of("message", e.getReason() == null ? "请求失败" : e.getReason())
    );
  }

  @ExceptionHandler(Exception.class)
  ResponseEntity<?> unexpected(
    Exception e,
    jakarta.servlet.http.HttpServletRequest request
  ) {
    if (e instanceof LimitedRequest.TooLarge) return ResponseEntity.status(
      413
    ).body(Map.of("message", "请求内容过大"));
    String requestId = java.util.Objects.toString(
      request.getAttribute("requestId"),
      java.util.UUID.randomUUID().toString()
    );
    // Only code locations, never exception messages, request bodies or third-party responses.
    log.error(
      "request_failed requestId={} exceptionType={} locations={}",
      requestId,
      e.getClass().getName(),
      java.util.Arrays.stream(e.getStackTrace()).limit(16).toList()
    );
    return ResponseEntity.status(500).body(
      Map.of(
        "message",
        "服务暂时不可用，请保留当前页面并重试",
        "requestId",
        requestId
      )
    );
  }
}
