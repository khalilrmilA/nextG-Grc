import { useState } from "react";
import { BookOpen, GraduationCap, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";

const TABS = [
  { id: "admin", key: "docs.tab_admin", Icon: BookOpen },
  { id: "training", key: "docs.tab_training", Icon: GraduationCap },
  { id: "sla", key: "docs.tab_sla", Icon: FileText },
] as const;

// Inline markup: `code` and **bold**.
function fmt(s: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("`"))
      out.push(<code key={m.index} className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-800 text-[12px] font-mono">{tok.slice(1, -1)}</code>);
    else out.push(<b key={m.index}>{tok.slice(2, -2)}</b>);
    last = m.index + tok.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

export default function DocumentationPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("admin");

  const sections = (t(`docs.${tab}`, { returnObjects: true }) as any[]) || [];
  const slaNote = tab === "sla" ? String(t("docs.sla_note", "")) : "";
  const thead = (t("docs.sla_thead", { returnObjects: true }) as string[]) || [];
  const rows = (t("docs.sla_rows", { returnObjects: true }) as string[][]) || [];

  return (
    <div className="p-8 max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t("docs.title", "Documentation")}</h1>
        <p className="text-sm text-gray-500 mt-1">{t("docs.subtitle", "Administrator guide, training programme and service level for the platform")}</p>
      </div>

      <div className="flex items-center gap-2 border-b border-gray-200">
        {TABS.map(({ id, key, Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === id ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            <Icon className="w-4 h-4" /> {t(key)}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        {slaNote && <p className="text-sm text-gray-500 italic mb-2">{slaNote}</p>}
        {Array.isArray(sections) && sections.map((sec: any, i: number) => (
          <div key={i}>
            <h3 className="text-sm font-semibold text-gray-900 mt-5 mb-1.5">{sec.h}</h3>
            {Array.isArray(sec.items) && sec.items.length > 0 && (
              <ul className="space-y-1.5 mb-2">
                {sec.items.map((it: string, j: number) => (
                  <li key={j} className="text-sm text-gray-600 leading-relaxed pl-4 relative">
                    <span className="absolute left-0 top-2 w-1.5 h-1.5 rounded-full bg-blue-400" />{fmt(it)}
                  </li>
                ))}
              </ul>
            )}
            {sec.table && thead.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm mt-1 mb-3">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/60 text-gray-500">
                      {thead.map((h, k) => <th key={k} className="text-left px-3 py-2 font-medium">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, k) => (
                      <tr key={k} className="border-b border-gray-50">
                        {r.map((cell, c) => (
                          <td key={c} className={`px-3 py-2 ${c === 0 ? "font-medium text-gray-800" : "text-gray-600"}`}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
