/**
 * DataActions — Reusable CSV Export/Import buttons for any data table.
 * Usage: <DataActions module="risks" onImportDone={reload} />
 */
import { useState, useRef } from "react";
import { Download, Upload, Loader2 } from "lucide-react";
import { dataApi } from "@/api/endpoints";

interface Props {
  readonly module: string; // "risks" | "vendors" | "assets" | "audits" | "policies" | "compliance"
  readonly onImportDone?: () => void;
  readonly showImport?: boolean;
}

export default function DataActions({ module, onImportDone, showImport = true }: Props) {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ created: number; errors: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleExport() {
    try {
      setExporting(true);
      await dataApi.exportCsv(module);
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      setExporting(false);
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setImporting(true);
      setImportResult(null);
      const result = await dataApi.importCsv(module, file);
      setImportResult(result);
      onImportDone?.();
    } catch (err) {
      console.error("Import failed:", err);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleExport}
        disabled={exporting}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
      >
        {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
        Export CSV
      </button>

      {showImport && ["risks", "vendors", "assets"].includes(module) && (
        <>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleImport} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            Import CSV
          </button>
        </>
      )}

      {importResult && (
        <span className={`text-xs ${importResult.errors.length > 0 ? "text-amber-600" : "text-green-600"}`}>
          {importResult.created} imported{importResult.errors.length > 0 ? `, ${importResult.errors.length} errors` : ""}
        </span>
      )}
    </div>
  );
}
