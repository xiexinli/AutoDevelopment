/**
 * 工程接入扫描（`F17`）回归 —— 用**临时构造的 Android 工程**验证约束提取与安全校验。
 * 跑法：`node --test test/engineering-scan.mjs`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalEngineeringAgent, validateEngineeringRoot, summarizeConstraints } from "../src/adapters/engineering.ts";

function sampleProject() {
  const root = mkdtempSync(join(tmpdir(), "ad-eng-"));
  const w = (rel, content) => { const p = join(root, rel); mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, content); };
  w("settings.gradle.kts", 'pluginManagement { repositories { google() } }\nrootProject.name = "MyShop"\ninclude(":app")\ninclude(":core")\n');
  w("build.gradle.kts", 'plugins { id("com.android.application") version "8.6.1" apply false; id("org.jetbrains.kotlin.android") version "2.0.10" apply false }\n');
  w("gradle/libs.versions.toml", '[versions]\nagp = "8.6.1"\nkotlin = "2.0.10"\n\n[libraries]\nretrofit = "com.squareup.retrofit2:retrofit:2.11.0"\n');
  w("gradle/wrapper/gradle-wrapper.properties", "distributionUrl=https\\://services.gradle.org/distributions/gradle-8.9-bin.zip\n");
  w("app/build.gradle.kts", [
    'plugins { id("com.android.application") }',
    "android {",
    '    namespace = "com.example.myshop"',
    '    defaultConfig { applicationId = "com.example.myshop"; minSdk = 24; targetSdk = 34 }',
    "    compileSdk = 34",
    "    compileOptions { sourceCompatibility = JavaVersion.VERSION_17 }",
    "}",
    "dependencies {",
    '    implementation("androidx.core:core-ktx:1.13.1")',
    '    implementation("com.squareup.retrofit2:retrofit:2.11.0")',
    "}",
  ].join("\n"));
  w("app/src/main/AndroidManifest.xml", '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application/></manifest>');
  w("app/src/main/res/layout/activity_main.xml", '<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"><TextView android:id="@+id/home_title"/><Button android:id="@+id/home_submit"/></LinearLayout>');
  w("AGENTS.md", "# 项目约定\n用 MVVM。");
  w(".editorconfig", "root = true");
  w("gradlew", "#!/bin/sh\nexec java -jar gradle/wrapper/gradle-wrapper.jar \"$@\"\n");
  return root;
}

test("扫描本机 Android 工程：提取框架 / 依赖 / agent 配置 / 命名抽样", async () => {
  const root = sampleProject();
  try {
    const pack = await createLocalEngineeringAgent().scan(root);
    assert.equal(pack.android_detected, true);
    assert.equal(pack.project_name, "MyShop");
    assert.equal(pack.namespace, "com.example.myshop");
    assert.equal(pack.application_id, "com.example.myshop");
    assert.deepEqual(pack.modules, [":app", ":core"]);
    assert.equal(pack.android.agp, "8.6.1");
    assert.equal(pack.android.kotlin, "2.0.10");
    assert.equal(pack.android.gradle, "8.9");
    assert.equal(pack.android.compile_sdk, 34);
    assert.equal(pack.android.min_sdk, 24);
    assert.equal(pack.android.target_sdk, 34);
    assert.ok(pack.dependencies.some((d) => d.name === "com.squareup.retrofit2:retrofit" && d.version === "2.11.0"));
    assert.ok(pack.agent_config_files.includes("AGENTS.md"));
    assert.ok(pack.style_tools.includes(".editorconfig"));
    assert.ok(pack.naming_samples.includes("home_title"));
    assert.ok(pack.naming_samples.includes("home_submit"));
    assert.ok(pack.build_commands.includes("./gradlew assembleDebug"));
    // 每项都带来源
    assert.ok(pack.items.every((i) => i.source && i.confidence));
    // markdown 正文可落知识库
    assert.match(pack.markdown, /工程约束包（MyShop）/);
    // 摘要供提示词注入
    const s = summarizeConstraints(pack);
    assert.match(s, /namespace：com\.example\.myshop/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("安全校验：非绝对路径 / 非 Android 目录 一律拒绝", () => {
  assert.throws(() => validateEngineeringRoot("relative/path"), /绝对路径/);
  const empty = mkdtempSync(join(tmpdir(), "ad-eng-empty-"));
  try {
    assert.throws(() => validateEngineeringRoot(empty), /没找到 Android 工程/);
  } finally { rmSync(empty, { recursive: true, force: true }); }
});
