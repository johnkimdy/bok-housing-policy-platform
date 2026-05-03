import styles from "./MarkdownRenderer.module.css";

/**
 * Lightweight markdown renderer — no external deps.
 * Handles: headings (##), **bold** with highlight, *italic*, tables, lists, hr, paragraphs.
 */

interface Props {
  text: string;
}

/* Inline: render **bold**, *italic*, `code` within a text segment */
function InlineContent({ text }: { text: string }) {
  // Split on bold (**...**), italic (*...*), or inline-code (`...`)
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong key={i} className={styles.bold}>
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
          return <em key={i}>{part.slice(1, -1)}</em>;
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return <code key={i} className={styles.inlineCode}>{part.slice(1, -1)}</code>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

/* Parse a markdown table block into header + rows */
function MdTable({ lines }: { lines: string[] }) {
  const parseRow = (line: string) =>
    line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

  const header = parseRow(lines[0]);
  // lines[1] is the separator row (---|---), skip it
  const rows = lines.slice(2).map(parseRow);

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {header.map((h, i) => (
              <th key={i}><InlineContent text={h} /></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci}><InlineContent text={cell} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function MarkdownRenderer({ text }: Props) {
  // Normalise line endings, split into lines
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // ── Blank line ──────────────────────────────────────────
    if (line.trim() === "") {
      i++;
      continue;
    }

    // ── Headings (#, ##, ###) ────────────────────────────────
    const headingMatch = line.match(/^(#{1,4})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = headingMatch[2];
      const Tag = (`h${Math.min(level + 2, 6)}`) as keyof JSX.IntrinsicElements;
      const cls =
        level === 1 ? styles.h1
        : level === 2 ? styles.h2
        : level === 3 ? styles.h3
        : styles.h4;
      elements.push(
        <Tag key={i} className={cls}>
          <InlineContent text={content} />
        </Tag>,
      );
      i++;
      continue;
    }

    // ── Horizontal rule ──────────────────────────────────────
    if (/^[-*_]{3,}$/.test(line.trim())) {
      elements.push(<hr key={i} className={styles.hr} />);
      i++;
      continue;
    }

    // ── Table (line contains | and next line is separator) ───
    if (line.includes("|") && lines[i + 1]?.match(/^[\s|:-]+$/)) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].includes("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      elements.push(<MdTable key={`table-${i}`} lines={tableLines} />);
      continue;
    }

    // ── Unordered list ───────────────────────────────────────
    if (/^[-*+]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*+]\s/, ""));
        i++;
      }
      elements.push(
        <ul key={`ul-${i}`} className={styles.ul}>
          {items.map((item, j) => (
            <li key={j}><InlineContent text={item} /></li>
          ))}
        </ul>,
      );
      continue;
    }

    // ── Ordered list ─────────────────────────────────────────
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s/, ""));
        i++;
      }
      elements.push(
        <ol key={`ol-${i}`} className={styles.ol}>
          {items.map((item, j) => (
            <li key={j}><InlineContent text={item} /></li>
          ))}
        </ol>,
      );
      continue;
    }

    // ── Blockquote ───────────────────────────────────────────
    if (line.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      elements.push(
        <blockquote key={`bq-${i}`} className={styles.blockquote}>
          {quoteLines.map((ql, j) => (
            <p key={j}><InlineContent text={ql} /></p>
          ))}
        </blockquote>,
      );
      continue;
    }

    // ── Paragraph ────────────────────────────────────────────
    {
      // Accumulate consecutive non-blank, non-special lines as a paragraph
      const paraLines: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() !== "" &&
        !lines[i].match(/^#{1,4}\s/) &&
        !lines[i].match(/^[-*+]\s/) &&
        !lines[i].match(/^\d+\.\s/) &&
        !lines[i].startsWith("> ") &&
        !lines[i].includes("|") &&
        !/^[-*_]{3,}$/.test(lines[i].trim())
      ) {
        paraLines.push(lines[i]);
        i++;
      }
      if (paraLines.length > 0) {
        elements.push(
          <p key={`p-${i}`} className={styles.p}>
            <InlineContent text={paraLines.join(" ")} />
          </p>,
        );
      }
    }
  }

  return <div className={styles.root}>{elements}</div>;
}
