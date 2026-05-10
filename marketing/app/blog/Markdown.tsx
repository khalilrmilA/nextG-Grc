import Link from "next/link";
import { Fragment } from "react";

/**
 * Lightweight markdown renderer tailored for blog posts.
 * Supports: ## ###, paragraphs, - lists, **bold**, [link](url), tables, blank lines.
 * Keeps server-render friendly (no client JS needed).
 */
export default function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r/g, "").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    if (line.startsWith("### ")) {
      blocks.push(<h3 key={key++} className="text-xl sm:text-2xl font-bold text-gray-900 mt-10 mb-4">{renderInline(line.slice(4))}</h3>);
      i++; continue;
    }
    if (line.startsWith("## ")) {
      blocks.push(<h2 key={key++} className="text-2xl sm:text-3xl font-extrabold text-gray-900 mt-14 mb-5">{renderInline(line.slice(3))}</h2>);
      i++; continue;
    }
    if (line.startsWith("# ")) {
      blocks.push(<h1 key={key++} className="text-3xl sm:text-4xl font-extrabold text-gray-900 mt-12 mb-6">{renderInline(line.slice(2))}</h1>);
      i++; continue;
    }

    // Markdown table — pipe-separated, second row is divider with dashes
    if (line.startsWith("|") && i + 1 < lines.length && lines[i + 1].startsWith("|") && /---/.test(lines[i + 1])) {
      const headerCells = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].startsWith("|")) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push(
        <div key={key++} className="my-8 overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-blue-50 text-gray-900">
                {headerCells.map((c, j) => (
                  <th key={j} className="text-left font-semibold px-4 py-3 border border-blue-100">{renderInline(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r} className={r % 2 ? "bg-white" : "bg-gray-50/40"}>
                  {row.map((c, j) => (
                    <td key={j} className="px-4 py-3 border border-gray-100 align-top text-gray-700">{renderInline(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Bulleted list
    if (line.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith("- ")) {
        items.push(lines[i].slice(2));
        i++;
      }
      blocks.push(
        <ul key={key++} className="list-disc pl-6 my-4 space-y-2 text-gray-700 leading-relaxed">
          {items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}
        </ul>
      );
      continue;
    }

    // Numbered list
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s/, ""));
        i++;
      }
      blocks.push(
        <ol key={key++} className="list-decimal pl-6 my-4 space-y-2 text-gray-700 leading-relaxed">
          {items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}
        </ol>
      );
      continue;
    }

    // Paragraph — collect consecutive non-empty, non-block lines
    const para: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].startsWith("#") &&
      !lines[i].startsWith("- ") &&
      !lines[i].startsWith("|") &&
      !/^\d+\.\s/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++} className="text-gray-700 leading-relaxed my-4 text-base">{renderInline(para.join(" "))}</p>
    );
  }

  return <>{blocks}</>;
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map(s => s.trim());
}

function renderInline(text: string): React.ReactNode {
  // Tokenize bold, code, and links — sequential pass.
  const out: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  const linkRe = /\[([^\]]+)\]\(([^)]+)\)/;
  const boldRe = /\*\*([^*]+)\*\*/;
  const codeRe = /`([^`]+)`/;

  while (remaining.length > 0) {
    const linkM = remaining.match(linkRe);
    const boldM = remaining.match(boldRe);
    const codeM = remaining.match(codeRe);

    const candidates = [
      linkM ? { kind: "link", index: linkM.index!, m: linkM } : null,
      boldM ? { kind: "bold", index: boldM.index!, m: boldM } : null,
      codeM ? { kind: "code", index: codeM.index!, m: codeM } : null,
    ].filter(Boolean) as Array<{ kind: string; index: number; m: RegExpMatchArray }>;

    if (candidates.length === 0) {
      out.push(<Fragment key={key++}>{remaining}</Fragment>);
      break;
    }

    candidates.sort((a, b) => a.index - b.index);
    const next = candidates[0];

    if (next.index > 0) {
      out.push(<Fragment key={key++}>{remaining.slice(0, next.index)}</Fragment>);
    }

    if (next.kind === "link") {
      const [, label, url] = next.m;
      const isInternal = url.startsWith("/");
      out.push(
        isInternal
          ? <Link key={key++} href={url} className="text-blue-600 hover:text-blue-700 underline underline-offset-2 font-medium">{label}</Link>
          : <a key={key++} href={url} className="text-blue-600 hover:text-blue-700 underline underline-offset-2 font-medium" target="_blank" rel="noopener noreferrer">{label}</a>
      );
    } else if (next.kind === "bold") {
      out.push(<strong key={key++} className="text-gray-900 font-semibold">{next.m[1]}</strong>);
    } else if (next.kind === "code") {
      out.push(<code key={key++} className="bg-gray-100 text-blue-700 px-1.5 py-0.5 rounded text-sm font-mono">{next.m[1]}</code>);
    }

    remaining = remaining.slice(next.index + next.m[0].length);
  }

  return out;
}
