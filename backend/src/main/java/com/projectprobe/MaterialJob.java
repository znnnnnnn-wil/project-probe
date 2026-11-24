package com.projectprobe;

import static com.projectprobe.Store.*;

record MaterialJob(String user, String kind, String input, String token) {
  // Called inside the account transaction with the matching cache lookup.
  static MaterialJob claim(Store store, String user, String kind, String input, String duplicateMessage) {
    long time = now();
    store.db.update("DELETE FROM material_jobs WHERE user_id=? AND expires_at<=?", user, time);
    if (!store.db.queryForList("SELECT token FROM material_jobs WHERE user_id=? AND kind=? AND input_key=?",
        user, kind, input).isEmpty()) throw error(409, duplicateMessage);
    return start(store, user, kind, input, time);
  }

  static MaterialJob trackResumeRead(Store store, String user) {
    return start(store, user, "RESUME_PARSE", id(), now());
  }

  private static MaterialJob start(Store store, String user, String kind, String input, long time) {
    String token = id();
    store.db.update("INSERT INTO material_jobs VALUES (?,?,?,?,?)", user, kind, input, token, time + 90_000);
    return new MaterialJob(user, kind, input, token);
  }

  void requireCurrent(Store store) {
    if (store.db.queryForList("SELECT token FROM material_jobs WHERE user_id=? AND kind=? AND input_key=? AND token=? AND expires_at>?",
        user, kind, input, token, now()).isEmpty()) throw error(409, "材料处理任务已失效，请重新提交");
  }

  void release(Store store) {
    store.db.update("DELETE FROM material_jobs WHERE user_id=? AND kind=? AND input_key=? AND token=?",
      user, kind, input, token);
  }
}
