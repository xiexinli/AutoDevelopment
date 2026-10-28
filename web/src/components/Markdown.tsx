import { useMemo } from "react";

/**
 * 极简 Markdown 渲染器 —— **不引入外部依赖、不联网**，且**转义 HTML、不执行任何标签**
 * （`UI-Spec §4.4 ⑤`：平台气泡「Markdown 渲染，转义 HTML、不执行标签」）。
 *
 * 支持：标题 / 表格 / 列表 / 引用 / 分隔线 / 粗体 / 行内代码。
 */
export default function Markdown({ text, compact }: { text: string; compact?: boolean }) {
  const blocks = useMemo(() => {
    const lines = (text ?? "").split("\n");
    const out: React.ReactNode[] = [];
    let table: string[][] = [];

    const inline = (s: string, key: string): React.ReactNode => {
      // **粗体** 与 `行内代码`，其余一律按纯文本渲染（React 默认转义，不执行标签）
      const parts = s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter((x) => x !== "");
      return parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**")
          ? <b key={`${key}-${i}`}>{p.slice(2, -2)}</b>
          : p.startsWith("`") && p.endsWith("`")
            ? <code key={`${key}-${i}`}>{p.slice(1, -1)}</code>
            : <span key={`${key}-${i}`}>{p}</span>,
      );
    };

    const flushTable = () => {
      if (!table.length) return;
      const [head, ...rows] = table;
      out.push(
        <table key={`t${out.length}`} style={{ width: "100%", borderCollapse: "collapse", margin: "8px 0", fontSize: 13 }}>
          <thead>
            <tr>{head.map((h, i) => (
              <th key={i} style={{ border: "1px solid var(--ad-border)", padding: "6px 8px", background: "var(--ad-bg-page)", textAlign: "left" }}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>{r.map((c, ci) => (
                <td key={ci} style={{ border: "1px solid var(--ad-border)", padding: "6px 8px" }}>{inline(c, `c${ri}-${ci}`)}</td>
              ))}</tr>
            ))}
          </tbody>
        </table>,
      );
      table = [];
    };

    lines.forEach((raw, idx) => {
      const line = raw.trimEnd();
      if (/^\|.*\|$/.test(line)) {
        const cells = line.slice(1, -1).split("|").map((c) => c.trim());
        if (cells.every((c) => /^-+$/.test(c.replace(/:/g, "")))) return; // 分隔行
        table.push(cells);
        return;
      }
      flushTable();
      if (!line.trim()) return;
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        const lv = h[1].length;
        const size = compact ? (lv <= 2 ? 15 : 13) : (lv <= 2 ? 18 : lv === 3 ? 15 : 13);
        out.push(<div key={idx} style={{ fontWeight: 600, fontSize: size, margin: compact ? "6px 0 3px" : "12px 0 6px" }}>{inline(h[2], `h${idx}`)}</div>);
        return;
      }
      if (/^(---|\*\*\*)\s*$/.test(line)) {
        out.push(<hr key={idx} style={{ border: "none", borderTop: "1px solid var(--ad-border)", margin: "8px 0" }} />);
        return;
      }
      if (/^>\s?/.test(line)) {
        out.push(<div key={idx} style={{ borderLeft: "3px solid var(--ad-border)", paddingLeft: 8, color: "var(--ad-text-secondary)", margin: "4px 0" }}>{inline(line.replace(/^>\s?/, ""), `q${idx}`)}</div>);
        return;
      }
      if (/^[-*]\s+/.test(line)) {
        out.push(
          <div key={idx} style={{ paddingLeft: 14, margin: "2px 0" }}>
            • {inline(line.replace(/^[-*]\s+/, "").replace(/\[x\]/i, "✓").replace(/\[ \]/, "□"), `l${idx}`)}
          </div>,
        );
        return;
      }
      out.push(<div key={idx} style={{ margin: "2px 0", lineHeight: 1.7 }}>{inline(line, `p${idx}`)}</div>);
    });
    flushTable();
    return out;
  }, [text, compact]);

  return <div style={{ fontSize: 13 }}>{blocks}</div>;
}
