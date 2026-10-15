package com.projectprobe;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

class LimitedRequestTest {

  @Test
  void enforcesActualReadSizeAndKeepsTheSameStream() throws Exception {
    var source = new MockHttpServletRequest();
    source.setContent(new byte[11]);
    var request = new LimitedRequest(source, 10);
    assertEquals(10, request.getInputStream().readNBytes(10).length);
    assertSame(request.getInputStream(), request.getInputStream());
    assertThrows(LimitedRequest.TooLarge.class, () ->
      request.getInputStream().read()
    );
  }

  @Test
  void acceptsExactlyTheLimit() throws Exception {
    var source = new MockHttpServletRequest();
    source.setContent(new byte[10]);
    assertEquals(
      10,
      new LimitedRequest(source, 10).getInputStream().readAllBytes().length
    );
  }
}
