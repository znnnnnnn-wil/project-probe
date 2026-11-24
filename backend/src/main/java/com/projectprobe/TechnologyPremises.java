package com.projectprobe;

import static com.projectprobe.Store.*;
import java.util.*;
import java.util.regex.Pattern;

/** Conservative statement checks; absence, plans and negation are not evidence of use. */
final class TechnologyPremises {
  enum State { UNKNOWN, USED, NOT_USED, PLANNED }
  static final List<String> COMPONENTS = List.of("JPA", "JdbcTemplate", "MyBatis", "Redis", "Kafka", "RabbitMQ", "Elasticsearch", "Dubbo", "Seata");
  static String token(String component) { return "(?<![a-zA-Z0-9_])" + Pattern.quote(component) + "(?![a-zA-Z0-9_])"; }
  static boolean mentions(String text, String component) { return Pattern.compile(token(component), Pattern.CASE_INSENSITIVE).matcher(text).find(); }

  static State statement(String text, String component, boolean stack) {
    var matcher = Pattern.compile(token(component), Pattern.CASE_INSENSITIVE).matcher(text);
    if (!matcher.find()) return State.UNKNOWN;
    String prefix = text.substring(0, matcher.start());
    String suffix = text.substring(matcher.end());
    if (prefix.matches("(?is).*(假设|如果|例如|比如|学习|了解|研究|听说|是否|有没有).*")) return State.UNKNOWN;
    if (suffix.matches("(?is)^\\s*(?:目前|实际|实际上|暂时|还)?(?:尚未|并未|没有|未|不再|没)(?:实际)?(?:被)?(?:使用|采用|引入|接入|部署|配置|启用|用到).*")) return State.NOT_USED;
    if (suffix.matches("(?is)^\\s*(?:目前|还)?(?:仅)?(?:计划|准备|打算|考虑|待接入).*")) return State.PLANNED;
    if (prefix.matches("(?is).*(不再|没有|尚未|从未|并未|未曾|没|未|不)(?:实际)?(?:使用|采用|引入|接入|部署|配置|启用|用到|用|包含|包括).{0,25}")) return State.NOT_USED;
    if (prefix.matches("(?is).*(计划|准备|打算|考虑|拟|将来|以后|想用|待接入).{0,30}")) return State.PLANNED;
    if (stack || prefix.matches("(?is).*(使用|采用|引入|接入|部署|配置|启用|用到|改用|用了|用).{0,15}")) return State.USED;
    return State.UNKNOWN;
  }

  static State state(Map<String, Object> body, String component) {
    State state = State.UNKNOWN;
    var project = body.get("project") instanceof Map<?, ?> value ? value : Map.of();
    for (String field : List.of("stack", "background", "resume", "responsibility", "architecture", "implementation", "problems", "verification", "materials"))
      state = update(state, Objects.toString(project.get(field), ""), component, field.equals("stack"));
    for (var turn : list(new LinkedHashMap<>(body), "turns")) state = update(state, str(turn, "answer"), component, false);
    return state;
  }
  static State update(State previous, String text, String component, boolean stack) {
    for (String clause : text.split("[，,。！？!?；;\\r\\n]+")) {
      State next = statement(clause, component, stack);
      if (next != State.UNKNOWN) previous = next;
    }
    return previous;
  }

  static void validate(String question, Map<String, Object> body) {
    for (String component : COMPONENTS) {
      if (!mentions(question, component) || state(body, component) == State.USED) continue;
      for (String sentence : question.split("[。！？!?；;\\r\\n]+")) {
        boolean hypothetical = false;
        for (String clause : sentence.split("[，,]+")) {
          if (!mentions(clause, component)) continue;
          if (clause.matches("(?is).*(假设|如果|例如|比如).*")) { hypothetical = true; continue; }
          if (hypothetical || clause.matches("(?is).*(是否|有没有|考虑|可选).*")) continue;
          String assertion = "(?is).*(?:你(?:所)?(?:已经|已)?(?:使用|采用|配置|引入|搭建|启用|用到|用)(?:的|了)?|你的|项目(?:已经|已)(?:使用|引入|采用)).{0,25}" + token(component) + ".*";
          if (clause.matches(assertion)) throw error(503, "问题把未使用、计划中或未提供的组件说成已使用，请开放询问实际实现或明确标为假设");
        }
      }
    }
  }
}
