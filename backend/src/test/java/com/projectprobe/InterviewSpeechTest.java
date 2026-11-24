package com.projectprobe;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.server.ResponseStatusException;

class InterviewSpeechTest {
  @Test void explanationTicketOnlyAuthorizesItsIssuedSentenceAndProject() {
    var speech = spy(new InterviewSpeech(null, null, null));
    doNothing().when(speech).synthesize(anyString(), any());
    speech.enabled = true;
    speech.paidAllowed = true;
    speech.ttsKey = "synthetic-test-key";
    speech.ttsUrl = "wss://dashscope.aliyuncs.com/api-ws/v1/inference";
    var response = new MockHttpServletResponse();
    var sentence = "用唯一约束挡住并发写入。";
    var ticket = speech.sentenceTicket("user-a", "project-a", sentence);

    assertEquals(403, assertThrows(ResponseStatusException.class,
      () -> speech.speakSentence("user-a", "project-a", "另一句", ticket, response)).getStatusCode().value());
    assertEquals(403, assertThrows(ResponseStatusException.class,
      () -> speech.speakSentence("user-a", "project-b", sentence, ticket, response)).getStatusCode().value());
    assertEquals(403, assertThrows(ResponseStatusException.class,
      () -> speech.speakSentence("user-b", "project-a", sentence, ticket, response)).getStatusCode().value());
    verify(speech, never()).synthesize(anyString(), any());

    speech.speakSentence("user-a", "project-a", sentence, ticket, response);
    verify(speech).synthesize(sentence, response);
  }
}
