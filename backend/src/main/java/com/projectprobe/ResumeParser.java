package com.projectprobe;

import static com.projectprobe.Store.*;

import java.io.*;
import java.nio.*;
import java.nio.charset.*;
import java.util.Locale;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.poi.xwpf.extractor.XWPFWordExtractor;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.springframework.web.multipart.MultipartFile;

class ResumeParser {

  String read(MultipartFile file) {
    if (file.isEmpty() || file.getSize() > 5 * 1024 * 1024) throw error(
      400,
      "简历须为5MB以内的PDF、DOCX或UTF-8 TXT"
    );
    String name =
      file.getOriginalFilename() == null
        ? ""
        : file.getOriginalFilename().toLowerCase(Locale.ROOT);
    String text;
    try {
      byte[] bytes = file.getBytes();
      if (name.endsWith(".pdf")) {
        if (
          bytes.length < 5 ||
          !new String(bytes, 0, 5, StandardCharsets.US_ASCII).equals("%PDF-")
        ) throw error(400, "文件内容不是PDF");
        try (var pdf = Loader.loadPDF(bytes)) {
          if (pdf.getNumberOfPages() > 12) throw error(400, "简历最多12页");
          if (
            !pdf.getCurrentAccessPermission().canExtractContent()
          ) throw error(400, "该PDF不允许提取文字");
          var stripper = new PDFTextStripper();
          stripper.setSortByPosition(true);
          text = stripper.getText(pdf);
        }
      } else if (name.endsWith(".docx")) {
        validateZip(bytes);
        try (
          var document = new XWPFDocument(new ByteArrayInputStream(bytes));
          var extractor = new XWPFWordExtractor(document)
        ) {
          text = extractor.getText();
        }
      } else if (name.endsWith(".txt")) {
        text = StandardCharsets.UTF_8.newDecoder()
          .onMalformedInput(CodingErrorAction.REPORT)
          .onUnmappableCharacter(CodingErrorAction.REPORT)
          .decode(ByteBuffer.wrap(bytes))
          .toString();
      } else throw error(
        400,
        "仅支持PDF、DOCX和UTF-8 TXT；旧版DOC请先另存为DOCX"
      );
    } catch (org.springframework.web.server.ResponseStatusException e) {
      throw e;
    } catch (Exception e) {
      throw error(400, "简历无法读取，请确认文件未加密、未损坏且含可选中文字");
    }
    text = text.replace("\uFEFF", "").replace("\r\n", "\n").strip();
    if (text.length() < 20 || text.indexOf('\0') >= 0) throw error(
      422,
      "未读取到足够文字；扫描版PDF请先转为文字版"
    );
    if (text.length() > 24000) throw error(
      400,
      "简历文字超过24000字，请仅上传相关经历"
    );
    return redact(text);
  }

  static String redact(String text) {
    return text
      .replaceAll("(?i)[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}", "[邮箱已隐藏]")
      .replaceAll(
        "(?<!\\d)(?:\\+?86[- ]?)?1[3-9]\\d{9}(?!\\d)",
        "[手机号已隐藏]"
      )
      .replaceAll("(?<!\\d)\\d{17}[\\dXx](?!\\d)", "[身份证号已隐藏]");
  }

  static void validateZip(byte[] bytes) throws IOException {
    int entries = 0;
    long total = 0;
    boolean content = false;
    try (
      var zip = new java.util.zip.ZipInputStream(
        new ByteArrayInputStream(bytes)
      )
    ) {
      java.util.zip.ZipEntry entry;
      byte[] buffer = new byte[8192];
      while ((entry = zip.getNextEntry()) != null) {
        if (++entries > 500) throw error(400, "DOCX条目过多");
        if (entry.getName().equals("word/document.xml")) content = true;
        int n;
        while ((n = zip.read(buffer)) != -1) {
          total += n;
          if (total > 20 * 1024 * 1024) throw error(400, "DOCX解压内容过大");
        }
      }
    }
    if (!content) throw error(400, "文件内容不是DOCX");
  }
}
