package com.projectprobe;

import jakarta.servlet.http.*;
import java.util.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class Api {

  final Store s;
  final Auth auth;
  final ProjectService projects;
  final TrainingService trainings;
  final ModelService model;
  final InputService inputs;
  final TrainingSupport support;
  final AnswerDrafts drafts;
  final InterviewSpeech speech;

  Api(
    Store s,
    Auth auth,
    ProjectService projects,
    TrainingService trainings,
    ModelService model,
    InputService inputs,
    TrainingSupport support,
    AnswerDrafts drafts,
    InterviewSpeech speech
  ) {
    this.s = s;
    this.auth = auth;
    this.projects = projects;
    this.trainings = trainings;
    this.model = model;
    this.inputs = inputs;
    this.support = support;
    this.drafts = drafts;
    this.speech = speech;
  }

  @GetMapping("/health")
  Object health() {
    return Map.of("status", "ok");
  }

  @GetMapping("/ready")
  Object ready() {
    try { s.db.queryForObject("SELECT 1", Integer.class); }
    catch (Exception e) { throw Store.error(503, "数据库暂不可用，请稍后重试"); }
    return Map.of("status", "ready", "modelMode", model.mode, "modelCapacity", model.capacity());
  }

  @GetMapping("/config")
  Object config() {
    return Map.of(
      "modelMode",
      model.mode,
      "modelQualityReviewEnabled",
      model.mode.equals("live") && model.qualityReviewEnabled,
      "modelEvidenceSpansRequired",
      model.mode.equals("live") && model.evidenceSpansRequired,
      "modelName",
      model.mode.equals("live") ? model.model : "",
      "speechEnabled",
      inputs.speechReady(),
      "realtimeSpeechEnabled",
      inputs.realtimeSpeechReady(),
      "ttsEnabled",
      speech.ttsReady(),
      "resumeImportEnabled",
      model.mode.equals("live")
    );
  }

  @PostMapping("/auth/register")
  Object register(@RequestBody Map<String, Object> b, HttpServletResponse r) {
    return auth.login(b, true, r);
  }

  @PostMapping("/auth/login")
  Object login(@RequestBody Map<String, Object> b, HttpServletResponse r) {
    return auth.login(b, false, r);
  }

  @PostMapping("/auth/logout")
  void logout(HttpServletRequest q, HttpServletResponse r) {
    auth.logout(q, r);
  }

  @GetMapping("/me")
  Object me(HttpServletRequest r) {
    return s.one("SELECT id,username FROM app_users WHERE id=?", auth.user(r));
  }

  @GetMapping("/projects")
  Object projects(
    HttpServletRequest r,
    @RequestParam(defaultValue = "false") boolean summary
  ) {
    return projects.all(auth.user(r), summary);
  }

  @GetMapping("/projects/{id}")
  Object project(HttpServletRequest r, @PathVariable String id) {
    return projects.get(auth.user(r), id);
  }

  @PostMapping("/projects")
  Object createProject(
    HttpServletRequest r,
    @RequestBody Map<String, Object> b
  ) {
    return projects.save(auth.user(r), null, b);
  }

  @PostMapping("/projects/batch")
  Object createProjects(
    HttpServletRequest r,
    @RequestBody Map<String, Object> b
  ) {
    return projects.createBatch(auth.user(r), b);
  }

  @PutMapping("/projects/{id}")
  Object saveProject(
    HttpServletRequest r,
    @PathVariable String id,
    @RequestBody Map<String, Object> b
  ) {
    return projects.save(auth.user(r), id, b);
  }

  @PostMapping("/projects/{id}/extract")
  Object extract(HttpServletRequest r, @PathVariable String id) {
    return projects.extract(auth.user(r), id);
  }

  @PostMapping(value = "/resume/import", consumes = "multipart/form-data")
  Object importResume(
    HttpServletRequest r,
    @RequestParam("file") org.springframework.web.multipart.MultipartFile file
  ) {
    return inputs.resume(auth.user(r), file);
  }

  @PostMapping(
    value = "/trainings/{id}/transcribe",
    consumes = "multipart/form-data"
  )
  Object transcribe(
    HttpServletRequest r,
    @PathVariable String id,
    @RequestParam("turnId") String turnId,
    @RequestParam(defaultValue = "0") int questionVersion,
    @RequestParam("file") org.springframework.web.multipart.MultipartFile file
  ) {
    String user = auth.user(r);
    var training = trainings.get(user, id);
    var turns = Store.list(training, "turns");
    if (
      !"ACTIVE".equals(training.get("status")) ||
      turns.isEmpty() ||
      !turnId.equals(turns.get(turns.size() - 1).get("id")) ||
      !Store.str(turns.get(turns.size() - 1), "answer").isBlank()
    ) throw Store.error(409, "本题已结束，请重新加载当前问题");
    TrainingService.requireQuestionVersion(turns.get(turns.size() - 1), Map.of("questionVersion", questionVersion));
    return inputs.transcribe(file);
  }

  @PostMapping("/projects/{id}/confirm")
  Object confirm(
    HttpServletRequest r,
    @PathVariable String id,
    @RequestBody Map<String, Object> b
  ) {
    return projects.confirm(auth.user(r), id, b);
  }

  @GetMapping("/trainings")
  Object trainings(
    HttpServletRequest r,
    @RequestParam(defaultValue = "false") boolean summary,
    @RequestParam(defaultValue = "") String project
  ) {
    if (project.length() > 36) throw Store.error(400, "项目筛选参数不正确");
    return new TrainingCatalog(s).all(auth.user(r), summary, project);
  }

  @GetMapping("/trainings/{id}")
  Object training(HttpServletRequest r, @PathVariable String id) {
    return trainings.get(auth.user(r), id);
  }

  @GetMapping("/training-page")
  Object trainingPage(
    HttpServletRequest r,
    @RequestParam(defaultValue = "0") int offset,
    @RequestParam(defaultValue = "20") int limit,
    @RequestParam(defaultValue = "") String key,
    @RequestParam(defaultValue = "") String project
  ) {
    return new TrainingCatalog(s).page(
      auth.user(r),
      offset,
      limit,
      key,
      project
    );
  }

  @GetMapping("/training-overview")
  Object trainingOverview(HttpServletRequest r) {
    return new TrainingCatalog(s).overview(auth.user(r));
  }

  @GetMapping("/training-projects")
  Object trainingProjects(HttpServletRequest r) {
    return new TrainingCatalog(s).choices(auth.user(r));
  }

  @PostMapping("/trainings")
  Object start(HttpServletRequest r, @RequestBody Map<String, Object> b) {
    return trainings.start(auth.user(r), b);
  }

  @PostMapping("/trainings/{id}/answer")
  Object answer(
    HttpServletRequest r,
    @PathVariable String id,
    @RequestBody Map<String, Object> b
  ) {
    return trainings.answer(auth.user(r), id, b);
  }

  @GetMapping("/trainings/{id}/draft")
  Object draft(HttpServletRequest r, @PathVariable String id) {
    return drafts.read(auth.user(r), id);
  }

  @PutMapping("/trainings/{id}/draft")
  Object saveDraft(HttpServletRequest r, @PathVariable String id, @RequestBody Map<String, Object> b) {
    return drafts.save(auth.user(r), id, b);
  }

  @PostMapping("/trainings/{id}/finish")
  Object finish(HttpServletRequest r, @PathVariable String id) {
    return trainings.finish(auth.user(r), id);
  }

  @PostMapping("/trainings/{id}/support")
  Object support(HttpServletRequest r, @PathVariable String id, @RequestBody Map<String, Object> b) {
    return support.submit(auth.user(r), id, b);
  }

  @PostMapping("/trainings/{id}/plan")
  Object savePlan(
    HttpServletRequest r,
    @PathVariable String id,
    @RequestBody Map<String, Object> b
  ) {
    return trainings.savePlan(auth.user(r), id, b);
  }

  @PostMapping("/trainings/{id}/retry")
  Object retry(HttpServletRequest r, @PathVariable String id) {
    return trainings.generate(auth.user(r), id);
  }

}
