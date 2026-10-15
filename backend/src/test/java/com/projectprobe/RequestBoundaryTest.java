package com.projectprobe;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(
  properties = {
    "spring.datasource.url=jdbc:h2:mem:request-boundary;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
    "app.model-mode=demo",
    "app.payment.mode=mock",
    "app.payment.reconcile-enabled=false",
  }
)
@AutoConfigureMockMvc
class RequestBoundaryTest {

  @Autowired
  MockMvc mvc;

  @Test
  void requestIdIsGeneratedByServerAndMalformedJsonIsClientError()
    throws Exception {
    var response = mvc
      .perform(
        post("/api/auth/register")
          .header("Origin", "http://localhost:5173")
          .header("X-Request-ID", "untrusted-request-id")
          .contentType("application/json")
          .content("{broken")
      )
      .andExpect(status().isBadRequest())
      .andReturn()
      .getResponse();
    assertNotEquals("untrusted-request-id", response.getHeader("X-Request-ID"));
    assertDoesNotThrow(() ->
      java.util.UUID.fromString(response.getHeader("X-Request-ID"))
    );
  }

  @Test
  void oversizedJsonIsRejectedBeforeBinding() throws Exception {
    mvc
      .perform(
        post("/api/auth/register")
          .header("Origin", "http://localhost:5173")
          .contentType("application/json")
          .content(" ".repeat(200001))
      )
      .andExpect(status().isPayloadTooLarge());
  }
}
