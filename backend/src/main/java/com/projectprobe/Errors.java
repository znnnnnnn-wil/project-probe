package com.projectprobe;

import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestControllerAdvice
public class Errors {

  @ExceptionHandler(org.springframework.web.multipart.MaxUploadSizeExceededException.class)
  ResponseEntity<?> uploadTooLarge() {
    return ResponseEntity.status(413).body(Map.of("message", "文件过大，请缩小后再上传"));
  }

  @ExceptionHandler(org.springframework.web.multipart.support.MissingServletRequestPartException.class)
  ResponseEntity<?> missingFile() {
    return ResponseEntity.badRequest().body(Map.of("message", "请选择要上传的文件"));
  }

  @ExceptionHandler(ResponseStatusException.class)
  ResponseEntity<?> expected(ResponseStatusException e) {
    return ResponseEntity.status(e.getStatusCode()).body(
      Map.of("message", e.getReason() == null ? "请求失败" : e.getReason())
    );
  }

  @ExceptionHandler(Exception.class)
  ResponseEntity<?> unexpected(Exception e) {
    return ResponseEntity.status(500).body(
      Map.of("message", "服务暂时不可用，请保留当前页面并重试")
    );
  }
}
