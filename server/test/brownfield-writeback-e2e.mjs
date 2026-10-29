/**
 * 二期 · brownfield 合并 + 写回（`F18` 生成侧衔接）端到端回归。
 * 覆盖：包名对齐（路径+package 行）· 布局定点插入（既有 id 不动）· strings/Manifest 合并 ·
 * 基座文件不写回 · 显式写回路由（含幂等与回滚）。
 * 跑法：`node --test test/brownfield-writeback-e2e.mjs`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TMP = mkdtempSync(join(process.env.TMPDIR ?? "/tmp", "ad-bf-"));
process.env.AD_DB_PATH = ":memory:";
process.env.AD_LOG_LEVEL = "fatal";
process.env.AD_UPLOAD_DIR = join(TMP, "uploads");
process.env.AD_PATCH_DIR = join(TMP, "patch-backups");
process.env.AD_PASSWORD_LOGIN = "development";
process.env.AD_DEV_PASSWORD = "bf-regression-pw";

const { buildApp } = await import("../src/app.ts");
const { ensureUser, issueToken } = await import("../src/core/auth.ts");
const { run, uid } = await import("../src/db/index.ts");
const { planBrownfieldMerge } = await import("../src/adapters/brownfield.ts");
const { applyPatch, rollbackPatch } = await import("../src/adapters/patch.ts");

const owner = ensureUser("bf_owner", "合并测试"); const token = issueToken(owner.user_id);
const app = buildApp(); await app.ready();
async function request(path, { method = "GET", body, key } = {}) {
  const res = await app.inject({ method, url: "/api/v1" + path, headers: { authorization: `Bearer ${token}`, ...(key ? { "idempotency-key": key } : {}) }, ...(body !== undefined ? { payload: body } : {}) });
  return { status: res.statusCode, ...res.json() };
}
const expect = (r, s) => { assert.equal(r.status, s, JSON.stringify(r)); return r.data; };

function sampleProject() {
  const root = mkdtempSync(join(TMP, "proj-"));
  const w = (rel, c) => { const p = join(root, rel); mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, c); };
  w("settings.gradle.kts", 'rootProject.name = "MyShop"\ninclude(":app")\n');
  w("build.gradle.kts", 'plugins { id("com.android.application") version "8.6.1" apply false }\n');
  w("app/build.gradle.kts", 'android { namespace = "com.example.myshop"\n compileSdk = 34 }\n');
  w("app/src/main/AndroidManifest.xml", '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:label="MyShop"></application></manifest>');
  w("app/src/main/res/layout/activity_main.xml", '<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android" android:orientation="vertical"><TextView android:id="@+id/home_title"/><Button android:id="@+id/home_submit"/></LinearLayout>');
  w("app/src/main/res/values/strings.xml", '<resources><string name="app_name">MyShop</string></resources>');
  return root;
}

const GENERATED = [
  { path: "settings.gradle.kts", kind: "gradle", content: 'rootProject.name = "GeneratedLayout"\ninclude(":app")\n' },
  { path: "app/build.gradle.kts", kind: "gradle", content: "android { namespace = \"com.autodevelopment.generated\" }\n" },
  { path: "gradle/wrapper/gradle-wrapper.properties", kind: "gradle", content: "distributionUrl=...\n" },
  { path: "app/src/main/res/layout/activity_main.xml", kind: "xml",
    content: '<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android" android:orientation="vertical"><TextView android:id="@+id/home_title"/><TextView android:id="@+id/home_hint"/></LinearLayout>' },
  { path: "app/src/main/res/values/strings.xml", kind: "xml",
    content: '<resources><string name="app_name">MyShop</string><string name="ad_hint">请输入</string></resources>' },
  { path: "app/src/main/AndroidManifest.xml", kind: "xml",
    content: '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application><activity android:name=".MainActivity" android:exported="true"></activity></application></manifest>' },
  { path: "app/src/main/java/com/autodevelopment/generated/MainActivity.kt", kind: "kotlin",
    content: "package com.autodevelopment.generated\n\nclass MainActivity\n" },
];

await test("二期 · brownfield 合并与写回", async (t) => {
  const root = sampleProject();
  const R = (rel) => join(root, rel);
  let projectId, taskId;
  try {
    await t.test("合并计划：基座不写回 · 包名对齐 · 三处定点合并", () => {
      const m = planBrownfieldMerge({ root, generated: GENERATED, namespace: "com.example.myshop" });
      const byPath = Object.fromEntries(m.files.map((f) => [f.path, f]));
      // 1) 基座/构建文件全部跳过
      assert.ok(m.skipped.some((s) => s.path === "settings.gradle.kts"));
      assert.ok(m.skipped.some((s) => s.path === "app/build.gradle.kts"));
      assert.ok(m.skipped.some((s) => s.path.startsWith("gradle/wrapper/")));
      assert.equal(m.module, "app");
      // 2) Kotlin：路径与 package 行都按工程 namespace 对齐
      const kt = byPath["app/src/main/java/com/example/myshop/MainActivity.kt"];
      assert.ok(kt, "Kotlin 目标路径应按 namespace 重写");
      assert.match(kt.content, /package com\.example\.myshop/);
      assert.doesNotMatch(kt.content, /autodevelopment/);
      // 3) 布局：只插新 id，既有 home_title/home_submit 不动
      const xml = byPath["app/src/main/res/layout/activity_main.xml"];
      assert.ok(xml && xml.overwrite === true);
      assert.match(xml.content, /home_hint/);
      assert.equal([...xml.content.matchAll(/@\+id\/home_title/g)].length, 1, "既有 id 不得重复插入");
      // 4) strings / manifest 合并
      assert.match(byPath["app/src/main/res/values/strings.xml"].content, /ad_hint/);
      assert.equal([...byPath["app/src/main/res/values/strings.xml"].content.matchAll(/name="app_name"/g)].length, 1);
      assert.match(byPath["app/src/main/AndroidManifest.xml"].content, /\.MainActivity/);
    });

    await t.test("合并结果可被补丁引擎落盘并可回滚", () => {
      const m = planBrownfieldMerge({ root, generated: GENERATED, namespace: "com.example.myshop" });
      const before = { xml: readFileSync(R("app/src/main/res/layout/activity_main.xml"), "utf8") };
      const plan = applyPatch({ root, projectId: "p_x", patchId: uid("patch"), files: m.files, message: "t" });
      assert.ok(plan.totals.create >= 1 && plan.totals.replace >= 1);
      assert.match(readFileSync(R("app/src/main/res/layout/activity_main.xml"), "utf8"), /home_hint/);
      assert.ok(existsSync(R("app/src/main/java/com/example/myshop/MainActivity.kt")));
      rollbackPatch(plan);
      assert.equal(readFileSync(R("app/src/main/res/layout/activity_main.xml"), "utf8"), before.xml);
      assert.equal(existsSync(R("app/src/main/java/com/example/myshop/MainActivity.kt")), false);
    });

    await t.test("★显式写回路由：非绝对路径伪造任务产物 → 合并后写回（幂等）", async () => {
      projectId = expect(await request("/projects", { method: "POST", body: { name: "写回回归" } }), 201).project_id;
      expect(await request(`/projects/${projectId}/engineering-intake`, { method: "POST", body: { root, confirm: true } }), 200);
      // 伪造一次生成任务的产物（模拟 codegen 输出）
      taskId = uid("task");
      for (const f of GENERATED) run(`INSERT INTO tbl_artifact(artifact_id,task_id,path,kind,content) VALUES(?,?,?,?,?)`,
        uid("art"), taskId, f.path, f.kind, JSON.stringify({ content: f.content }));
      expect(await request(`/projects/${projectId}/generation/${taskId}/writeback`, { method: "POST", body: {} }), 400);
      const d = expect(await request(`/projects/${projectId}/generation/${taskId}/writeback`, { method: "POST", key: "wb-1", body: { confirm: true } }), 201);
      assert.ok(d.notes.some((n) => n.includes("包名对齐")));
      assert.ok(d.skipped.some((s) => s.path === "settings.gradle.kts"));
      assert.match(readFileSync(R("app/src/main/res/layout/activity_main.xml"), "utf8"), /home_hint/);
      // 幂等重放
      const again = expect(await request(`/projects/${projectId}/generation/${taskId}/writeback`, { method: "POST", key: "wb-1", body: { confirm: true } }), 201);
      assert.equal(again.patch_id, d.patch_id);
      // 出现在补丁列表并可回滚
      const list = expect(await request(`/projects/${projectId}/patch-applications`), 200);
      assert.equal(list.total, 1);
      expect(await request(`/projects/${projectId}/patch-applications/${d.patch_id}/rollback`, { method: "POST", body: { confirm: true } }), 200);
      assert.equal(existsSync(R("app/src/main/java/com/example/myshop/MainActivity.kt")), false);
    });

    await t.test("无增量可写回 → 400（不是静默成功）", async () => {
      const tid = uid("task");
      run(`INSERT INTO tbl_artifact(artifact_id,task_id,path,kind,content) VALUES(?,?,?,?,?)`,
        uid("art"), tid, "settings.gradle.kts", "gradle", JSON.stringify({ content: 'rootProject.name="X"\n' }));
      expect(await request(`/projects/${projectId}/generation/${tid}/writeback`, { method: "POST", body: { confirm: true } }), 400);
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
