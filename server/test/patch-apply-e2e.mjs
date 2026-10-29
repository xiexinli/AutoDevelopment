/**
 * 二期 · 增量写回（`REQ-PATCH-001`）端到端回归 —— 在**进程内**起 App，对**临时构造的 Android 工程**做真实写盘。
 * 覆盖：越界/禁碰拒绝 · 冲突整批拒绝（原子）· XML 既有 id 保护 · 原子写 · 快照回滚 · 幂等 · 未接入拒绝。
 * 跑法：`node --test test/patch-apply-e2e.mjs`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TMP = mkdtempSync(join(process.env.TMPDIR ?? "/tmp", "ad-patch-"));
process.env.AD_DB_PATH = ":memory:";
process.env.AD_LOG_LEVEL = "fatal";
process.env.AD_UPLOAD_DIR = join(TMP, "uploads");
process.env.AD_PATCH_DIR = join(TMP, "patch-backups");
process.env.AD_PASSWORD_LOGIN = "development";
process.env.AD_DEV_PASSWORD = "patch-regression-pw";

const { buildApp } = await import("../src/app.ts");
const { ensureUser, issueToken } = await import("../src/core/auth.ts");

const owner = ensureUser("patch_owner", "补丁测试"); const token = issueToken(owner.user_id);
const app = buildApp(); await app.ready();

async function request(path, { method = "GET", body, key, headers = {} } = {}) {
  const res = await app.inject({ method, url: "/api/v1" + path, headers: { authorization: `Bearer ${token}`, ...(key ? { "idempotency-key": key } : {}), ...headers }, ...(body !== undefined ? { payload: body } : {}) });
  return { status: res.statusCode, ...res.json() };
}
const expect = (r, status) => { assert.equal(r.status, status, JSON.stringify(r)); return r.data; };

/** 造一个「既有 Android 工程」 */
function sampleProject() {
  const root = mkdtempSync(join(TMP, "proj-"));
  const w = (rel, c) => { const p = join(root, rel); mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, c); };
  w("settings.gradle.kts", 'rootProject.name = "MyShop"\ninclude(":app")\n');
  w("build.gradle.kts", 'plugins { id("com.android.application") version "8.6.1" apply false }\n');
  w("app/build.gradle.kts", 'android { namespace = "com.example.myshop"\n defaultConfig { applicationId = "com.example.myshop"; minSdk = 24 }\n compileSdk = 34 }\n');
  w("app/src/main/AndroidManifest.xml", "<manifest><application/></manifest>");
  w("app/src/main/res/layout/activity_main.xml", '<LinearLayout><TextView android:id="@+id/home_title"/><Button android:id="@+id/home_submit"/></LinearLayout>');
  w("gradlew", "#!/bin/sh\n");
  w("gradle/wrapper/gradle-wrapper.properties", "distributionUrl=...gradle-8.9-bin.zip\n");
  w("local.properties", "sdk.dir=/Users/x/Library/Android/sdk\n");
  return root;
}

await test("二期 · 增量写回端到端", async (t) => {
  const root = sampleProject();
  const R = (rel) => join(root, rel);
  let projectId, patchId;
  try {
    await t.test("未接入的项目 → 拒绝写回", async () => {
      const p = expect(await request("/projects", { method: "POST", body: { name: "空项目" } }), 201).project_id;
      expect(await request(`/projects/${p}/patch-applications`, { method: "POST", body: { confirm: true, files: [{ path: "app/x.txt", content: "x" }] } }), 400);
    });

    await t.test("接入既有工程", async () => {
      projectId = expect(await request("/projects", { method: "POST", body: { name: "补丁回归" } }), 201).project_id;
      expect(await request(`/projects/${projectId}/engineering-intake`, { method: "POST", body: { root, confirm: true } }), 200);
    });

    await t.test("未确认 → 400", async () => {
      expect(await request(`/projects/${projectId}/patch-applications`, { method: "POST", body: { files: [{ path: "a.txt", content: "x" }] } }), 400);
    });

    await t.test("★越界与硬禁碰：整批拒绝，不写任何文件", async () => {
      for (const bad of ["../escape.txt", "/abs.txt", "gradle/wrapper/x.properties", "gradlew", "local.properties", "app/release.jks", ".git/config"]) {
        expect(await request(`/projects/${projectId}/patch-applications`, { method: "POST", body: { confirm: true, files: [{ path: bad, content: "x" }] } }), 400);
      }
      assert.equal(existsSync(join(root, "..", "escape.txt")), false);
    });

    await t.test("★冲突：已存在且内容不同 → 409，且**未写入**（原子）", async () => {
      const before = readFileSync(R("app/src/main/res/layout/activity_main.xml"), "utf8");
      const r = await request(`/projects/${projectId}/patch-applications`, { method: "POST", body: { confirm: true, files: [
        { path: "app/src/main/res/values/colors.xml", content: "<resources/>" },          // 本可新建
        { path: "app/src/main/res/layout/activity_main.xml", content: "<LinearLayout/>" }, // 冲突（且会删 id）
      ] } });
      expect(r, 409);
      assert.equal(existsSync(R("app/src/main/res/values/colors.xml")), false, "冲突时不得留下半成品");
      assert.equal(readFileSync(R("app/src/main/res/layout/activity_main.xml"), "utf8"), before);
    });

    await t.test("★XML 既有 id 不可静默删除（overwrite 也要拦）", async () => {
      const r = await request(`/projects/${projectId}/patch-applications`, { method: "POST", body: { confirm: true, files: [
        { path: "app/src/main/res/layout/activity_main.xml", content: "<LinearLayout/>", overwrite: true },
      ] } });
      expect(r, 400);
      assert.match(JSON.stringify(r), /home_title/);
    });

    await t.test("正向：新建 + 带 overwrite 的替换 + unchanged 跳过", async () => {
      const d = expect(await request(`/projects/${projectId}/patch-applications`, {
        method: "POST", key: "patch-same-key", body: { confirm: true, message: "接入页生成", files: [
          { path: "app/src/main/res/values/colors.xml", content: '<resources><color name="ad_bg">#FFFFFF</color></resources>' },
          { path: "app/src/main/res/layout/activity_main.xml", content: '<LinearLayout><TextView android:id="@+id/home_title"/><Button android:id="@+id/home_submit"/><TextView android:id="@+id/home_hint"/></LinearLayout>', overwrite: true },
          { path: "app/src/main/res/values/colors.xml", content: "dup" },  // 让下面单独测重复；这里先去掉
        ].slice(0, 2) },
      }), 201);
      patchId = d.patch_id;
      assert.equal(d.totals.create, 1);
      assert.equal(d.totals.replace, 1);
      assert.match(readFileSync(R("app/src/main/res/values/colors.xml"), "utf8"), /ad_bg/);
      assert.match(readFileSync(R("app/src/main/res/layout/activity_main.xml"), "utf8"), /home_hint/);
      assert.deepEqual(d.entries.find((e) => e.path.endsWith("activity_main.xml")).removed_ids, []);
    });

    await t.test("幂等：同键重放返回首次结果，不产生第二次写入", async () => {
      const before = readFileSync(R("app/src/main/res/values/colors.xml"), "utf8");
      const d = expect(await request(`/projects/${projectId}/patch-applications`, {
        method: "POST", key: "patch-same-key", body: { confirm: true, message: "接入页生成", files: [
          { path: "app/src/main/res/values/colors.xml", content: '<resources><color name="ad_bg">#FFF</color></resources>' },
        ] },
      }), 201);
      assert.equal(d.patch_id, patchId);
      assert.equal(readFileSync(R("app/src/main/res/values/colors.xml"), "utf8"), before);
    });

    await t.test("补丁列表（倒序、含文件清单与 totals）", async () => {
      const d = expect(await request(`/projects/${projectId}/patch-applications`), 200);
      assert.equal(d.total, 1);
      assert.equal(d.items[0].patch_id, patchId);
      assert.equal(d.items[0].status, "applied");
      assert.ok(d.items[0].files.some((f) => f.endsWith("colors.xml")));
    });

    await t.test("★回滚：replace 还原、create 删除", async () => {
      expect(await request(`/projects/${projectId}/patch-applications/${patchId}/rollback`, { method: "POST", body: {} }), 400);
      const d = expect(await request(`/projects/${projectId}/patch-applications/${patchId}/rollback`, { method: "POST", body: { confirm: true } }), 200);
      assert.equal(d.restored, 1); assert.equal(d.removed, 1);
      assert.equal(existsSync(R("app/src/main/res/values/colors.xml")), false, "create 的文件应被删除");
      const xml = readFileSync(R("app/src/main/res/layout/activity_main.xml"), "utf8");
      assert.doesNotMatch(xml, /home_hint/);
      assert.match(xml, /home_title/);
      // 二次回滚 → 400
      expect(await request(`/projects/${projectId}/patch-applications/${patchId}/rollback`, { method: "POST", body: { confirm: true } }), 400);
    });

    await t.test("allow_id_removal 显式放行（可控删除）", async () => {
      const d = expect(await request(`/projects/${projectId}/patch-applications`, { method: "POST", body: { confirm: true, files: [
        { path: "app/src/main/res/layout/activity_main.xml", content: '<LinearLayout><TextView android:id="@+id/home_title"/></LinearLayout>', overwrite: true, allow_id_removal: true },
      ] } }), 201);
      assert.deepEqual(d.entries[0].removed_ids, ["home_submit"]);
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
