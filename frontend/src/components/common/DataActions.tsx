/**
 * DataActions — Reusable CSV/XML Export/Import buttons for any data table.
 * Usage: <DataActions module="risks" onImportDone={reload} />
 *
 * Backed by /data/export/{module}?format=csv|xml and /data/import/{module}?format=csv|xml
 * (backend/app/api/v1/endpoints/data_io.py). XML support added for RFP gap T2
 * ("no generic XML import/export, only scanner-report XML ingestion").
 */
import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Download, Upload, Loader2 } from "lucide-react";
import { dataApi, type DataIoFormat } from "@/api/endpoints";

interface Props {
  readonly module: string; // "risks" | "vendors" | "assets" | "audits" | "policies" | "compliance" | "threats"
  readonly onImportDone?: () => void;
  readonly showImport?: boolean;
}

const IMPORTABLE_MODULES = ["risks", "vendors", "assets"];

export default function DataActions({ module, onImportDone, showImport = true }: Props) {
  const { t } = useTranslation();
  const [exportingFormat, setExportingFormat] = useState<DataIoFormat | null>(null);
  const [importingFormat, setImportingFormat] = useState<DataIoFormat | null>(null);
  const [importResult, setImportResult] = useState<{ created: number; errors: string[] } | null>(null);
  const csvFileRef = useRef<HTMLInputElement>(null);
  const xmlFileRef = useRef<HTMLInputElement>(null);

  async function handleExport(format: DataIoFormat) {
    try {
      setExportingFormat(format);
      await dataApi.exportData(module, format);
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      setExportingFormat(null);
    }
  }

  async function handleImport(format: DataIoFormat, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setImportingFormat(format);
      setImportResult(null);
      const result = await dataApi.importData(module, file, format);
      setImportResult(result);
      onImportDone?.();
    } catch (err) {
      console.error("Import failed:", err);
    } finally {
      setImportingFormat(null);
      e.target.value = "";
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => handleExport("csv")}
        disabled={exportingFormat !== null}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
      >
        {exportingFormat === "csv" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
        {t("data.export_csv")}
      </button>
      <button
        onClick={() => handleExport("xml")}
        disabled={exportingFormat !== null}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
      >
        {exportingFormat === "xml" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
        {t("data.export_xml")}
      </button>

      {showImport && IMPORTABLE_MODULES.includes(module) && (
        <>
          <input ref={csvFileRef} type="file" accept=".csv" className="hidden" onChange={(e) => handleImport("csv", e)} />
          <button
            onClick={() => csvFileRef.current?.click()}
            disabled={importingFormat !== null}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            {importingFormat === "csv" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            {t("data.import_csv")}
          </button>

          <input ref={xmlFileRef} type="file" accept=".xml" className="hidden" onChange={(e) => handleImport("xml", e)} />
          <button
            onClick={() => xmlFileRef.current?.click()}
            disabled={importingFormat !== null}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            {importingFormat === "xml" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            {t("data.import_xml")}
          </button>
        </>
      )}

      {importResult && (
        <span className={`text-xs ${importResult.errors.length > 0 ? "text-amber-600" : "text-green-600"}`}>
          {importResult.errors.length > 0
            ? t("data.imported_with_errors", { count: importResult.created, errors: importResult.errors.length })
            : t("data.imported_count", { count: importResult.created })}
        </span>
      )}
    </div>
  );
}
