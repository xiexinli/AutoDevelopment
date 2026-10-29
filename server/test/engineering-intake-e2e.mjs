/**
 * 工程接入（`F17`/`F18`）端到端回归 —— 在**进程内**起 App（同 `b2-regression.mjs` 套路），
 * 覆盖：#N1 接入扫描 / #N2 读约束 / #N3 编辑约束 / 项目来源字段 / 安全校验 / 知识库分区。
 * 跑法：`node --test test/engineering-intake-e2e.mjs`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

process.env.AD_DB_PATH = ":memory:";
process.env.AD_LOG_LEVEL = "fatal";
process.env.AD_UPLOAD_DIR = mkdtempSync(resolve(".tmp-eng-uploads-"));
process.env.AD_PASSWORD_LOGIN = "development";
const DEV_PW = "eng-regression-pw";
process.env.AD_DEV_PASSWORD = DEV_PW;

const { buildApp } = await import("../src/app.ts");
const { ensureUser, issueToken } = await import("../src/core/auth.ts");

const owner = ensureUser("eng_owner", "工程接入测试"); const token = issueToken(owner.user_id);
const app = buildApp(); await app.ready();

async function request(path, { method = "GET", body, headers = {} } = {}) {
  const res = await app.inject({ method, url: "/api/v1" + path, headers: { authorization: `Bearer ${token}`, ...headers }, ...(body !== undefined ? { payload: body } : {}) });
  return { status: res.statusCode, ...res.json() };
}
const expect = (r, status) => { assert.equal(r.status, status, JSON.stringify(r)); return r.data; };

function sampleProject() {
  const root = mkdtempSync(join(process.env.AD_UPLOAD_DIR, "proj-"));
  const w = (rel, c) => { const p = join(root, rel); mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, c); };
  w("settings.gradle.kts", 'rootProject.name = "MyShop"\ninclude(":app")\n');
  w("build.gradle.kts", 'plugins { id("com.android.application") version "8.6.1" apply false }\n');
  w("app/build.gradle.kts", 'android { namespace = "com.example.myshop"\n defaultConfig { applicationId = "com.example.myshop"; minSdk = 24 }\n compileSdk = 34 }\n dependencies { implementation("androidx.core:core-ktx:1.13.1") }\n');
  w("app/src/main/AndroidManifest.xml", "<manifest><application/></manifest>");
  w("app/src/main/res/layout/activity_main.xml", '<LinearLayout><TextView android:id="@+id/home_title"/></LinearLayout>');
  w("AGENTS.md", "# 约定");
  w("gradlew", "#!/bin/sh\n");
  return root;
}

await test("F17/F18 工程接入端到端", async (t) => {
  const root = sampleProject();
  let projectId;
  try {
    await t.test("新建项目默认 source_kind=new", async () => {
      projectId = expect(await request("/projects", { method: "POST", body: { name: "接入回归" } }), 201).project_id;
      assert.equal(expect(await request(`/projects/${projectId}`), 200).source_kind, "new");
    });

    await t.test("未确认授权 → 400", async () => {
      expect(await request(`/projects/${projectId}/engineering-intake`, { method: "POST", body: { root } }), 400);
    });

    await t.test("非 Android 目录 / 相对路径 → 400", async () => {
      expect(await request(`/projects/${projectId}/engineering-intake`, { method: "POST", body: { root: "relative", confirm: true } }), 400);
      const empty = mkdtempSync(join(process.env.AD_UPLOAD_DIR, "empty-"));
      expect(await request(`/projects/${projectId}/engineering-intake`, { method: "POST", body: { root: empty, confirm: true } }), 400);
    });

    await t.test("接入扫描成功 → 约束落库 + 项目转 imported", async () => {
      const d = expect(await request(`/projects/${projectId}/engineering-intake`, { method: "POST", body: { root, confirm: true } }), 200);
      assert.equal(d.source_kind, "imported");
      assert.equal(d.engineering_root, root);
      assert.equal(d.android.agp, "8.6.1");
      assert.equal(d.android.min_sdk, 24);
      assert.ok(d.counts.items > 0);
      const p = expect(await request(`/projects/${projectId}`), 200);
      assert.equal(p.source_kind, "imported");
      assert.equal(p.engineering_root, root);
      // 列表也带 source_kind
      const list = expect(await request("/projects"), 200);
      assert.equal(list.items.find((x) => x.project_id === projectId).source_kind, "imported");
    });

    let kbDocId, version;
    await t.test("#N2 读约束：结构化 + 正文 + 摘要", async () => {
      const d = expect(await request(`/projects/${projectId}/constraints`), 200);
      assert.ok(d.pack);
      assert.match(d.content_md, /工程约束包/);
      assert.match(d.summary, /namespace：com\.example\.myshop/);
      assert.equal(d.source_kind, "imported");
      kbDocId = d.kb_doc_id; version = d.version;
    });

    await t.test("约束进入知识库（sector=constraints）", async () => {
      const kb = expect(await request(`/projects/${projectId}/kb-docs?sector=constraints`), 200);
      assert.equal(kb.total, 1);
      assert.equal(kb.items[0].kb_doc_id, kbDocId);
    });

    await t.test("#N3 编辑约束：If-Match 乐观锁", async () => {
      expect(await request(`/projects/${projectId}/constraints`, { method: "PUT", body: { content_md: "改过的约束" }, headers: { "if-match": String(version) } }), 200);
      expect(await request(`/projects/${projectId}/constraints`, { method: "PUT", body: { content_md: "再改" }, headers: { "if-match": String(version) } }), 409);
      const d = expect(await request(`/projects/${projectId}/constraints`), 200);
      assert.equal(d.content_md, "改过的约束");
      assert.equal(d.origin, "user_edited");
    });

    await t.test("未接入的项目读约束 → 404", async () => {
      const p2 = expect(await request("/projects", { method: "POST", body: { name: "空项目" } }), 201).project_id;
      expect(await request(`/projects/${p2}/constraints`), 404);
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
