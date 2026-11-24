package com.projectprobe;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockMultipartHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class PracticeTranscriptionTest {
  private final Auth auth = mock(Auth.class);
  private final ProjectPractice practice = mock(ProjectPractice.class);
  private final InputService inputs = mock(InputService.class);
  private final InterviewTranscription realtime = mock(InterviewTranscription.class);
  private final MockMvc mvc = MockMvcBuilders.standaloneSetup(
    new PracticeApi(auth, practice, null, null, inputs, null, realtime)
  ).setControllerAdvice(new Errors()).build();

  private MockMultipartHttpServletRequestBuilder transcribe() {
    when(auth.user(any())).thenReturn("user");
    var request = multipart("/api/projects/project/practice/transcribe")
      .file(new MockMultipartFile("file", "answer.wav", "audio/wav", new byte[] { 1 }));
    request.param("turnId", "turn").param("exchangeCount", "0");
    return request;
  }

  @Test
  void providerFailureUsesRetryableStatus() throws Exception {
    String message = "语音识别服务暂不可用，请稍后再试";
    when(inputs.transcribe(any())).thenThrow(Store.error(503, message));

    mvc.perform(transcribe())
      .andExpect(status().isServiceUnavailable())
      .andExpect(header().string("Retry-After", "3"))
      .andExpect(jsonPath("$.message").value(message));
  }

  @Test
  void staleQuestionIsRejectedBeforeTranscription() throws Exception {
    when(practice.requireUnansweredTurn("user", "project", "turn", 0))
      .thenThrow(Store.error(409, "本题已结束，请重新加载当前问题"));

    mvc.perform(transcribe()).andExpect(status().isConflict());
    verifyNoInteractions(inputs);
  }

  @Test
  void questionChangedDuringTranscriptionStillReturnsConflict() throws Exception {
    when(inputs.transcribe(any())).thenReturn(Map.of("text", "合成回答"));
    when(practice.requireUnansweredTurn("user", "project", "turn", 0))
      .thenReturn(Map.of("id", "turn"))
      .thenThrow(Store.error(409, "本题已结束，请重新加载当前问题"));

    mvc.perform(transcribe())
      .andExpect(status().isConflict())
      .andExpect(jsonPath("$.text").doesNotExist());
  }

  @Test
  void realtimeConnectionUsesTheAuthenticatedProjectAndCurrentExchange() throws Exception {
    when(auth.user(any())).thenReturn("user");
    org.mockito.Mockito.doAnswer(invocation -> {
      invocation.<Runnable>getArgument(2).run();
      return null;
    }).when(realtime).open(any(), any(), any());
    when(practice.requireUnansweredTurn("user", "project", "turn", 1))
      .thenThrow(Store.error(409, "本题已结束，请重新加载当前问题"));

    mvc.perform(get("/api/projects/project/practice/transcribe-stream").param("turnId", "turn").param("exchangeCount", "1"))
      .andExpect(status().isConflict());
    verify(practice).requireUnansweredTurn("user", "project", "turn", 1);
  }

  @Test
  void realtimeRejectsCrossOriginBeforeCheckingProviderOrReadingTheTurn() {
    var relay = new InterviewTranscription(null, inputs, "http://localhost:5173");
    var request = new org.springframework.mock.web.MockHttpServletRequest();
    request.addHeader("Origin", "https://other.example");
    var response = new org.springframework.mock.web.MockHttpServletResponse();
    Runnable checkTurn = mock(Runnable.class);
    var error = org.junit.jupiter.api.Assertions.assertThrows(org.springframework.web.server.ResponseStatusException.class,
      () -> relay.open(request, response, checkTurn));
    org.junit.jupiter.api.Assertions.assertEquals(403, error.getStatusCode().value());
    verifyNoInteractions(inputs, checkTurn);
  }
}
