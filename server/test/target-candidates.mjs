/**
 * `#80` 目标接入点识别回归（2026-11-03 由草案转正式基线）。
 * 覆盖：未接入工程 → `items=[] ambiguous=false`；已接入 → 命中模块的候选（高置信、唯一）；
 * 无命中 → 低置信 / 多候选 → `ambiguous=true`；以及 `target` 随 `#43` 回传被接受。
 * 跑法：`node --test test/target-candidates.mjs`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

process.env.AD_DB_PATH = ":memory:";
process.env.AD_LOG_LEVEL = "fatal";
process.env.AD_CODEGEN_MODE = "development";
process.env.AD_UPLOAD_DIR = mkdtempSync(resolve(".tmp-t80-uploads-"));
process.env.AD_PASSWORD_LOGIN = "development";
process.env.AD_DEV_PASSWORD = "t80-pw";

const { buildApp } = await import("../src/app.ts");
const { ensureUser, issueToken } = await import("../src/core/auth.ts");
const { seedUiSpec, uiSpecFor } = await import("./_uispec-fixture.mjs");

const owner = ensureUser("t80_owner", "目标接入点测试"); const token = issueToken(owner.user_id);
const app = buildApp(); await app.ready();

async function request(path, { method = "GET", body, headers = {} } = {}) {
  const res = await app.inject({ method, url: "/api/v1" + path, headers: { authorization: `Bearer ${token}`, ...headers }, ...(body !== undefined ? { payload: body } : {}) });
  return { status: res.statusCode, ...res.json() };
}
const expect = (r, s) => { assert.equal(r.status, s, JSON.stringify(r)); return r.data; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (id) => { for (let i = 0; i < 400; i++) { const t = (await request(`/tasks/${id}`)).data; if (!["running", "queued"].includes(t.status)) return t; await sleep(10); } throw Error("task timeout"); };

/** 造一个既有 Android 工程：包含与页面模块 `WORK` 同名的 Activity / layout。 */
function sampleProject() {
  const root = mkdtempSync(join(process.env.AD_UPLOAD_DIR, "proj-"));
  const w = (rel, c) => { const p = join(root, rel); mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, c); };
  w("settings.gradle.kts", 'rootProject.name = "MyShop"\ninclude(":app")\n');
  w("build.gradle.kts", 'plugins { id("com.android.application") version "8.6.1" apply false }\n');
  w("app/build.gradle.kts", 'android { namespace = "com.example.myshop"\n defaultConfig { applicationId = "com.example.myshop"; minSdk = 24 }\n compileSdk = 34 }\n');
  w("app/src/main/AndroidManifest.xml", '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application><activity android:name=".ui.WorkActivity" android:exported="true"/></application></manifest>');
  w("app/src/main/res/layout/activity_work.xml", '<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"><TextView android:id="@+id/work_title"/></LinearLayout>');
  w("gradlew", "#!/bin/sh\n");
  return root;
}

await test("#80 目标接入点识别", async (t) => {
  const root = sampleProject();
  let projectId, workPage;
  try {
    await t.test("未接入工程（source_kind=new）→ items=[] 且 ambiguous=false", async () => {
      projectId = expect(await request("/projects", { method: "POST", body: { name: "T80" } }), 201).project_id;
      seedUiSpec(projectId, "WORK", "工作台", ["主按钮", "文本"]);
      workPage = expect(await request(`/projects/${projectId}/pages`), 200).items.find((p) => p.module_code === "WORK");
      assert.ok(workPage, "UI-Spec 应把 WORK 页同步进 tbl_page");
      const d = expect(await request(`/projects/${projectId}/pages/${workPage.page_id}/target-candidates`), 200);
      assert.deepEqual(d.items, []);
      assert.equal(d.ambiguous, false);
    });

    await t.test("接入后命中模块 → 唯一高置信候选、不歧义", async () => {
      expect(await request(`/projects/${projectId}/engineering-intake`, { method: "POST", body: { root, confirm: true } }), 200);
      const d = expect(await request(`/projects/${projectId}/pages/${workPage.page_id}/target-candidates`), 200);
      assert.equal(d.items.length, 1, JSON.stringify(d));
      assert.equal(d.ambiguous, false);
      const c = d.items[0];
      assert.equal(c.module, "app");
      assert.equal(c.activity, ".ui.WorkActivity");
      assert.equal(c.layout, "activity_work");
      assert.ok(c.confidence >= 0.6, `置信度应 ≥0.6，实际 ${c.confidence}`);
      assert.ok(Array.isArray(c.reasons) && c.reasons.length > 0, "必须给出可核查理由");
    });

    await t.test("target 随 #43 回传被接受（生成链路不因 target 失败）", async () => {
      expect(await request("/users/me/ai-egress", { method: "PUT", body: { consent_acknowledged: true, egress_enabled: true } }), 200);
      const spec = uiSpecFor({ ...workPage, project_id: projectId });
      const gen = expect(await request(`/pages/${workPage.page_id}/generations`, { method: "POST", body: {
        input_hash: spec.input_hash, base_seq: 0,
        target: { module: "app", activity: ".ui.WorkActivity", layout: "activity_work" },
      } }), 202);
      assert.equal((await wait(gen.task_id)).status, "succeeded");
    });

    await t.test("非法 target 被拒", async () => {
      const spec = uiSpecFor({ ...workPage, project_id: projectId });
      const bad = await request(`/pages/${workPage.page_id}/generations`, { method: "POST", body: {
        input_hash: spec.input_hash, base_seq: 999, target: { module: "a\nb" },
      } });
      assert.equal(bad.status, 400, JSON.stringify(bad));
    });

    await t.test("无命中 → 低置信 → ambiguous=true（前端须让用户指定）", async () => {
      // 换一个模块段在工程里没有同名 Activity / layout 的页面（会在末尾替换 UI-Spec，故放最后）
      seedUiSpec(projectId, "ZZZ", "无对应页", ["文本"]);
      const zzz = expect(await request(`/projects/${projectId}/pages`), 200).items.find((p) => p.module_code === "ZZZ");
      assert.ok(zzz);
      const d = expect(await request(`/projects/${projectId}/pages/${zzz.page_id}/target-candidates`), 200);
      assert.equal(d.ambiguous, true, JSON.stringify(d));
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
