/** 页面和测试共用的复审条件，不把“勾选采纳”当成内容已解决。 */
export function normalizeAnswer(value: string | undefined): string {
  return (value ?? "").replace(/^__other/, "").trim();
}
export function reviewSubmitReasons(input: {
  busy: boolean; blockingOpen: number; unset: number; dirty: boolean; revisionChanged: boolean;
}): string[] {
  const reasons: string[] = [];
  if (input.busy) reasons.push("正在保存或审核，请稍候。");
  if (input.blockingOpen) reasons.push(`还有 ${input.blockingOpen} 项阻断没有作答，请补充答复。`);
  if (input.unset) reasons.push(`还有 ${input.unset} 条假设没有选择，先逐条选完再继续。`);
  if (input.dirty) reasons.push("补充内容尚未写入 PRD，请先勾选采纳并确认写入。");
  if (!input.revisionChanged && !input.dirty) reasons.push("PRD 尚无新的已写入版本，无需重复提交复审。");
  return reasons;
}
