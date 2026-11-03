/**
 * `#80` 目标接入点识别（2026-11-03 **由草案转正式基线**，`K5`）。
 *
 * 口径（`接口契约 §1.16`）：读该页 `UI-Spec`（页面 + 元素 `EL-*`）+ 工程约束包（`#74`）
 * → 返回 `{items:[{module, activity, layout, confidence, reasons[]}], ambiguous}`。
 * **纯读、无副作用**；未接入工程（`source_kind=new`）→ `items=[]` 且 `ambiguous=false`（走「从零生成」）。
 *
 * 设计：**确定性启发式**，不做承诺式断言 ——
 *  - 三路证据（Gradle 模块 / 既有 `Activity` / 既有 layout）各自与**页面模块**（或页面名）比对：
 *    命中 → 计入候选并把置信度抬升；未命中 → 回退为「取前若干个」仍作候选（低置信）；
 *  - `ambiguous = 候选不唯一 ∨ 置信度 < 0.6` → **前端必须让用户显式指定**，所选值随 `#43` 的 `target` 回传；
 *  - 任何一路读不到 → 记入 `reasons`（**不静默**），不据此断言「一定对」。
 */
export interface TargetCandidate {
  module: string; activity: string; layout: string;
  /** 0~1，两位小数；界面按 `{n}%` 展示 */
  confidence: number; reasons: string[];
}
export interface TargetRecognition { items: TargetCandidate[]; ambiguous: boolean }

/** 约束包中与识别相关的切片（避免此处依赖 `adapters/engineering` 的完整类型） */
export interface PackLike {
  modules?: string[]; activities?: string[]; layouts?: string[]; namespace?: string | null;
}

const norm = (s: string): string => s.replace(/^:/, "").trim().toLowerCase();
const cap = (n: number): number => Math.round(Math.min(0.99, Math.max(0, n)) * 100) / 100;

export function recognizeTargets(input: {
  moduleCode: string; pageName: string; pack: PackLike | null; imported: boolean;
}): TargetRecognition {
  if (!input.imported) return { items: [], ambiguous: false };

  const moduleCode = input.moduleCode.toUpperCase();
  const code = moduleCode.toLowerCase();
  const pageName = (input.pageName ?? "").trim();
  const mods = input.pack?.modules ?? [];
  const acts = input.pack?.activities ?? [];
  const lays = input.pack?.layouts ?? [];

  const hit = (name: string): boolean => {
    const n = norm(name);
    return !!n && (n.includes(code) || (!!pageName && n.includes(pageName.toLowerCase())));
  };
  const modHit = mods.filter(hit), actHit = acts.filter(hit), layHit = lays.filter(hit);

  const reasons: string[] = [];
  if (!mods.length) reasons.push("工程里没有读到 Gradle 模块");
  if (!acts.length) reasons.push("工程里没有读到既有 Activity");
  if (!lays.length) reasons.push("工程里没有读到既有 layout");

  let c = 0.3;
  if (modHit.length) { c += 0.3; reasons.push(`Gradle 模块命中页面模块 ${moduleCode}`); }
  if (actHit.length) { c += 0.25; reasons.push(`既有 Activity 命中页面 ${moduleCode}`); }
  if (layHit.length) { c += 0.25; reasons.push(`既有 layout 命中页面 ${moduleCode}`); }
  const confidence = cap(c);

  const useMods = modHit.length ? modHit : (mods.length ? mods.slice(0, 3) : [""]);
  const useActs = actHit.length ? actHit : (acts.length ? acts.slice(0, 3) : [""]);
  const useLays = layHit.length ? layHit : (lays.length ? lays.slice(0, 3) : [""]);

  const items: TargetCandidate[] = [];
  for (const m of useMods) for (const a of useActs) for (const l of useLays)
    items.push({ module: norm(m), activity: a, layout: l, confidence, reasons: [...reasons] });
  const capped = items.slice(0, 6);

  if (!capped.length)
    capped.push({ module: "", activity: "", layout: "", confidence: 0,
      reasons: ["工程里没有可用于识别的模块 / Activity / layout，需由你指定目标接入点"] });
  if (!reasons.length) capped.forEach((i) => i.reasons.push("模块 / Activity / layout 三者均与页面模块同名"));

  const ambiguous = capped.length !== 1 || confidence < 0.6;
  return { items: capped, ambiguous };
}
