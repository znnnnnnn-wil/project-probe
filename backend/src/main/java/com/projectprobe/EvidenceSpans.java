package com.projectprobe;

import static com.projectprobe.Store.*;
import java.util.*;

/** Local validation of spans returned by the existing report generation request. */
final class EvidenceSpans {
  static List<Map<String, Object>> validate(Map<String, Object> finding,
      Map<String, String> turnRefs, Map<String, String> factRefs,
      List<Map<String, Object>> turns, List<Map<String, Object>> facts) {
    var result = new ArrayList<Map<String, Object>>();
    boolean hasAnswer = false;
    for (var span : modelObjects(finding, "supportingQuotes", 4)) {
      String ref = modelText(span, "sourceId", 36), quote = modelText(span, "quote", 240);
      String turnId = turnRefs.getOrDefault(ref, ref), factId = factRefs.getOrDefault(ref, ref);
      var source = turns.stream().filter(t -> turnId.equals(t.get("id")) &&
        ((List<?>) finding.get("turnIds")).contains(turnId)).findFirst();
      if (source.isPresent()) {
        if (!str(source.get(), "answer").contains(quote)) throw error(503, "报告原文片段不是所引回答的连续原文");
        hasAnswer = true;
        result.add(Map.of("sourceId", ref, "quote", quote));
      } else {
        var fact = facts.stream().filter(f -> factId.equals(f.get("id")) &&
          ((List<?>) finding.get("factIds")).contains(factId)).findFirst();
        if (fact.isEmpty() || !str(fact.get(), "text").contains(quote))
          throw error(503, "报告原文片段不属于本条所引证据");
        result.add(Map.of("sourceId", ref, "quote", quote));
      }
    }
    if (!hasAnswer) throw error(503, "报告原文片段至少需要一段所引回答");
    return result;
  }
}
