# B3 codegen / L1 resources

本目录配套 `server/src/adapters/codegen.ts` 与 `verify.ts`。只产出源码与资源，不运行 Gradle/Kotlin/Android 编译，不生成 APK，不进行 OCR 或图像处理，不访问飞书应用凭据。

## 对主 Agent 的接口与集成要求

```ts
export interface CodeFile {
  path: string; kind: string; content: string; encoding?: 'base64';
}
export interface CodegenInput { tree: any[]; pageName: string; moduleCode: string }
export interface CodegenAdapter {
  kind: 'development' | 'real' | 'unconfigured';
  generate(input: CodegenInput, signal: AbortSignal): Promise<CodeFile[]>;
}
export function createCodegenAdapter(): CodegenAdapter;
export function verifyL1(tree: any[], files: CodeFile[]): {
  passed: boolean;
  rules: { rule: string; ok: boolean; detail?: string }[];
  log_digest: string;
};
```

- 路由/任务/DB/SSE 属于主 Agent，本实现没有改这些文件。主 Agent 负责外发开关 `#68`、逐对象鉴权、正式 ID 分配、输入规范化哈希、旧 seq 丢弃、幂等、同项目并发门禁和任务原子提交。
- 先 `generate(input, taskAbortSignal)`，再 `verifyL1(tree, files)`；只有 L1 通过且任务仍有效才发布可渲染产物。取消会传回调用者的 AbortError/reason，不把取消伪装为任务失败，不自动产生版本。
- `path` 是工程根目录下的相对路径；`kind` 是文件类型标签，非执行许可。二进制 wrapper JAR 使用 `encoding: 'base64'`。导出端必须解码为真实字节，保持路径边界、不可跟随越界 symlink，恢复 `gradlew` 的可执行位（`chmod +x gradlew`）。CodeFile 不包含文件权限字段。
- L1 只是静态检查；接口 `#46` 的真实本地 build-report 才能给出 L2 结果。未回传保持 `reported=false` / “未验证构建”。

## 模式：默认 fail-closed

- `AD_CODEGEN_MODE=development`：显式确定性 Android XML/Kotlin 布局生成，无网络、非真实 AI。
- 未设置 `AD_CODEGEN_MODE` 时，也接受显式 `AD_LLM_MODE=development`。设置 `AD_CODEGEN_MODE=real` 会覆盖继承的 LLM development。
- 真实网关须同时设置 `AD_CODEGEN_BASE_URL` 与 `AD_CODEGEN_API_KEY`，可设置 `AD_CODEGEN_MODE=real`。无 mode 且双配置齐全也选择 real。缺配置、不合法 URL、未知 mode 均返回 `kind=unconfigured`，generate 抛 `ApiError(UPSTREAM_UNAVAILABLE)`。
- 不读取 `AD_FEISHU_*`；不复用 `AD_LLM_API_KEY`。本文件不打印日志，也不把上游错误正文、生成源码、secret 放进错误/摘要。

### 真实网关协议

`POST {AD_CODEGEN_BASE_URL去掉末尾斜杠}/v1/codegen`，JSON 请求体 `{tree,pageName,moduleCode}`；`Authorization: Bearer <AD_CODEGEN_API_KEY>`。生产请使用 HTTPS；HTTP 保留给本地网关。URL 禁止用户信息、query/hash，redirect 禁用，避免密钥重定向泄露。

响应支持 `CodeFile[]` 或 `{files: CodeFile[]}`，不猜测其他 envelope。每次调用从请求到完整响应体共享 **60 秒** deadline。网络错误/超时/408/429/5xx 最多 **2 次重试**（总 3 次），指数退避加抖动。其他 4xx、非法 JSON/CodeFile 不重试。不承诺整个含重试任务小于 60 秒。提供稳定 payload SHA-256 `Idempotency-Key`；网关需实现该幂等键，否则网络中断时仍可能重复计费。

调用者 signal 可取消请求、读响应体与退避；取消原样抛回。请求和响应大小上限 20 MiB；产物最多 1024 文件；相对路径长度≤240，拒绝 traversal、绝对路径、反斜杠、Windows 保留名、大小写碰撞、非法编码/NUL。响应逐块限流读取，超时不会因收到响应头而解除。

真实网关接入、真实 LLM 语义效果**未验收**；仅完成回环 HTTP 网关自测。

## 输入与 development 支持范围

已读 `platform/specs/接口-Spec.md §5.5.22~26`、`platform/design/数据模型.md E6/E7/E8/§4`、`web/src/editor/model.ts`。用户指定的 `web/src/editor/widget.ts` 在当前 workspace 及会话附件均不存在；实际控件目录为 `web/src/domain/widgets.ts`，已读取并逐项映射 **37** 种控件。

- 要求服务端正式 `EL-<模块>-<序号>`，归一化大写零填充后去重，要求与 moduleCode 一致；拒绝 tmp/null ID，最多 200 个 active 元素，void 节点及其子树不生成。
- 37 类型严格映射基线 Android 类，包括 RecyclerView（不是 ListView）、ConstraintLayout、CardView、ViewPager2、BottomNavigationView、TabLayout。不用 TextView 冒充复杂控件。
- 兼容 UI 字段 `wrap/match`、background/font_color/font_size/radius 和 E7 的 `wrap_content/match_parent`、background_color/text_color/text_size_sp/corner_radius_dp。值域二次验证，不截断非法值，报错携带安全的 element_id/field，不回显原始值。
- 基本布局：宽高、padding/margin 四边、背景 shape、圆角、solid/dashed/dotted border、透明度、可见性、文本颜色/字号、gravity。支持输入框多行/密码、单行标签、横向 ProgressBar、SpannableString 和头像 oval outline。文本从 text（若有）或 alias 提取并做 XML/Android string 转义。
- click/long_press（兼容 long_click）/double_click 或 E8 事件数组均支持，action_type 只允许 none，生成空回调。单击与双击并存时，单击延迟 300ms，第二次点击取消待执行单击。
- LinearLayout/CheckGroup/RadioGroup 纵向布局；ConstraintLayout/RelativeLayout 子节点按确定性垂直链摆放。ScrollView 多于一个 active 直接子节点拒绝；非容器子元素、选择组错误子类型拒绝。

### 明确限制，不谎报完整可编译

- LIST/GRID/BANNER/TAB_LAYOUT 的 **非空子模板直接 FORMAT_UNSUPPORTED**，不静默丢树，也不把 AdapterView 当任意 ViewGroup 使用；空实例只是正确类的空 View。没有列表/grid/pager 数据适配器、Tab 配置、Spinner 数据或 BottomNavigation menu。
- IMAGE/AVATAR/VIDEO 没有媒体资源源；RICH_TEXT 只有 SpannableString、无 authored spans；头像裁剪在正方形尺寸才是圆形，长方形为椭圆。没有联网加载图片或视频。
- CARD 使用 card background/radius，不渲染自定义 stroke。复杂原生控件可能忽略 text/gravity、边距由父布局解释、平台/theme 自带内边距与 tint 会造成预览差异；内部可点击子控件可能消费父事件。
- LABEL 用输入 padding，不自行覆盖；DIVIDER 用输入 height，基线默认高度须由输入设为 1dp。不支持 authored constraint/relative 编辑数据、Recycler item 及复杂导航数据。
- 依赖**直接版本**固定并输出 `dependency-versions.json`；因未执行 Gradle dependency resolution，不提供伪造的 transitive lockfile。清单明确 `transitive_lock=not_resolved_no_build`。这不是 Kotlin 编译通过声明。

## L1 五条规则（真实静态检查）

| rule | 检查内容 |
|---|---|
| xml_syntax | Python3 stdlib ElementTree 逐文件解析 XML，检查语法/实体/命名空间；禁用 DTD/ENTITY，深度/节点数/时限有上限 |
| project_structure | settings/root/app Gradle、manifest application/activity 对应 Kotlin package/class、layout、gradle.properties、固定版本清单及四份 wrapper SHA-256 完整性 |
| element_id_bijection | active 元素归一化去重；layout 正式 Android ID 一一对应，不缺、不多、不重复，正确 Android 类；提供 tag 时须与正式 ID 相符 |
| style_ranges | 检查输入 E7/UI 值域和 XML 的 dimension、padding/margin/radius、字号、alpha、border、颜色、visibility；解析显式 color/dimen/integer 引用与 android style item；0dp 仅接受 Android weight/constraint 语义 |
| resource_references | 收集 main/res 声明、@+id、values、显式 XML/Kotlin R 引用；检查缺资源、非法/未知引用、同 values 文件重复声明；仅 Android SDK 和固定 Material theme 有明确豁免 |

诊断和 `log_digest` 不含源码/PRD/解析器 stderr/URL/secret，仅规则结果、数量、摘要哈希及 `Kotlin_compile=not_run;L2=not_reported`。

解析或样式/引用无法静态证明时 fail-closed：不等同 aapt2 编译；无法分析 Kotlin 任意表达式、反射/动态 getIdentifier、Gradle 自定义资源生成、第三方全部 attr/style、跨 module 与变体配置。L1 不检验 Kotlin 语法/类型/生命周期/运行时布局，不证明 AGP/SDK 已安装，不证明可编译或 L2 通过。xml_syntax 失败时依赖 XML 的规则也失败，不返回假通过。

## 依赖需求

- 服务端：现有 Node/TypeScript 环境；新增代码只用 Node builtin，不改 package.json 或 lockfile。
- L1：PATH 中必须有 **Python3**，使用 `python3 -I -c` 和 stdlib ElementTree（输入仅 stdin，无临时源码文件）。当前机器已可用，无 npm 安装需求；部署缺失请**主 Agent 安装 Python3**或单独裁决 XML 库依赖，本 Agent 未安装依赖。缺失时 xml_syntax fail，不以正则冒充 XML parser。
- 用户以后真实本地构建所需：JDK17、Android SDK35（minSdk23）、网络及下列固定版本；**本次不运行任何构建**。

| 工具/依赖 | 固定版本 |
|---|---|
| Gradle | 8.9 |
| Android Gradle Plugin | 8.7.3 |
| Kotlin Android plugin | 2.0.21 |
| ConstraintLayout | 2.2.0 |
| CardView | 1.0.0 |
| RecyclerView | 1.3.2 |
| ViewPager2 | 1.1.0 |
| Material Components | 1.12.0 |

## 官方完整 Gradle wrapper 来源与校验

真实资源从 **Gradle 官方仓库固定 tag v8.9.0** 获取（保留 scripts/JAR 的 Apache license header）：

- https://raw.githubusercontent.com/gradle/gradle/v8.9.0/gradlew
- https://raw.githubusercontent.com/gradle/gradle/v8.9.0/gradlew.bat
- https://raw.githubusercontent.com/gradle/gradle/v8.9.0/gradle/wrapper/gradle-wrapper.jar
- https://raw.githubusercontent.com/gradle/gradle/v8.9.0/gradle/wrapper/gradle-wrapper.properties

properties 以官方原文件为基础，将 distributionUrl 明确钉到稳定 `gradle-8.9-bin.zip` 并添加官方发布 SHA-256；不是空壳 wrapper。JAR 为 **43,504 字节**真实 ZIP，静态核对包含 `GradleWrapperMain.class`、`Download.class` 等完整类，且与官方发布摘要一致。

- JAR 官方 checksum：https://services.gradle.org/distributions/gradle-8.9-wrapper.jar.sha256
- Distribution 官方 checksum：https://services.gradle.org/distributions/gradle-8.9-bin.zip.sha256
- 固定 distribution SHA-256：`d725d707bfabd4dfdc958c624003b3c80accc03f7037b5122c4b1d0ef15cecab`

| workspace 路径 | SHA-256 |
|---|---|
| gradle/gradlew | `9cbbb4d68ff7fb5211c4d58f598ac9d8664c05fdcd1e5f59b7f2c3ac1ee00af0` |
| gradle/gradlew.bat | `0f3ed8f03b50934cb8c48b15a470d5c20a30a5385825e48b55bcc8ea3d8f8e18` |
| gradle/gradle/wrapper/gradle-wrapper.jar | `498495120a03b9a6ab5d155f5de3c8f0d986a449153702fb80fc80e134484f17` |
| gradle/gradle/wrapper/gradle-wrapper.properties | `4c2158e858a54c55c5f8a2b508242b22b99f6fb6b6ffdee12131e9f1be116cff` |

development 通过 import.meta.url 定位上述资源，不依赖进程 cwd，不在生成时下载，任何 wrapper 缺失/摘要不符均报 UPSTREAM_UNAVAILABLE。verifyL1 也检查全部四份摘要，伪 jar/截断 script 不会通过。

## 简要自测记录（2026-10-21）

- 新增两个模块定向 TypeScript `tsc --noEmit --strict ...` 通过，无构建或文件 emit。
- Node stdin 内存自测 **23 项通过**：默认 unconfigured、确定性生成、五条规则全通过、37 控件正确类、嵌套约束/相对布局、模型字段兼容、XML 错闭合/未绑定 namespace/DTD、ID 缺失/重复/错误类、样式越界、引用缺失、wrapper 缺失/伪 jar、归一化重复 ID、复杂模板拒绝、void 子树、取消、200 上限。
- 回环 HTTP 网关 **13 项通过**：array/{files}、3 attempts 上限、400 不重试、非法 JSON/路径/base64/大小写碰撞、流式 body 取消、退避取消、60s 含 body deadline（加速 timer 自测）、mode 优先级。非真实 LLM。
- 追加 **8 项通过**：截断 gradlew、改动 properties、values style 字号、dimen 负 padding、非法 named color、Python3 缺失 fail-closed、路径 traversal、Kotlin 注释/字符串伪资源引用；定向累计 **44 项通过**，最后再次实测 37 类生成与五规则全通过。wrapper ZIP CRC 完整，33 个 ZIP 条目（43,504 字节）。
- 自测产物仅在内存，未另写测试文件、未改路由/DB/前端/package；未执行 `gradlew`、Kotlin 或 Android 编译。
