import { useState, useEffect } from "react";
import { Plus, Search, X, Loader2, ShieldOff, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import { securityApi } from "@/api/endpoints";

const EXCEPTION_STATUS_BADGE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600 border-gray-200",
  pending_approval: "bg-yellow-100 text-yellow-700 border-yellow-200",
  approved: "bg-green-100 text-green-700 border-green-200",
  rejected: "bg-red-100 text-red-700 border-red-200",
  expired: "bg-gray-100 text-gray-500 border-gray-200",
  revoked: "bg-red-100 text-red-700 border-red-200",
};

const ACCEPTANCE_STATUS_BADGE: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700 border-yellow-200",
  approved: "bg-green-100 text-green-700 border-green-200",
  rejected: "bg-red-100 text-red-700 border-red-200",
  expired: "bg-gray-100 text-gray-500 border-gray-200",
};

const SEV_BADGE: Record<string, string> = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high: "bg-orange-100 text-orange-700 border-orange-200",
  medium: "bg-yellow-100 text-yellow-700 border-yellow-200",
  low: "bg-green-100 text-green-700 border-green-200",
};

const SEVERITY_OPTIONS = ["critical", "high", "medium", "low"];
const EXCEPTION_TYPE_OPTIONS = ["risk", "control", "vulnerability", "requirement", "asset"];

export default function SecurityExceptionsPage() {
  const [activeTab, setActiveTab] = useState<"exceptions" | "acceptances">("exceptions");

  // Exceptions state
  const [exceptions, setExceptions] = useState<any[]>([]);
  const [excLoading, setExcLoading] = useState(true);
  const [showExcModal, setShowExcModal] = useState(false);
  const [excSearch, setExcSearch] = useState("");
  const [excError, setExcError] = useState("");
  const [excSubmitting, setExcSubmitting] = useState(false);
  const [excForm, setExcForm] = useState({
    title: "",
    justification: "",
    description: "",
    severity: "medium",
    exception_type: "risk",
    expiration_date: "",
    compensating_controls: "",
  });

  // Acceptances state
  const [acceptances, setAcceptances] = useState<any[]>([]);
  const [accLoading, setAccLoading] = useState(true);
  const [showAccModal, setShowAccModal] = useState(false);
  const [accError, setAccError] = useState("");
  const [accSubmitting, setAccSubmitting] = useState(false);
  const [accForm, setAccForm] = useState({
    name: "",
    justification: "",
    expiration_date: "",
  });

  async function loadExceptions() {
    try {
      const data = await securityApi.listExceptions();
      setExceptions(Array.isArray(data) ? data : data.items || []);
    } catch {
      setExceptions([]);
    } finally {
      setExcLoading(false);
    }
  }

  async function loadAcceptances() {
    try {
      const data = await securityApi.listAcceptances();
      setAcceptances(Array.isArray(data) ? data : data.items || []);
    } catch {
      setAcceptances([]);
    } finally {
      setAccLoading(false);
    }
  }

  useEffect(() => {
    loadExceptions();
    loadAcceptances();
  }, []);

  async function handleExcSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!excForm.title.trim()) { setExcError("Title is required"); return; }
    if (!excForm.justification.trim()) { setExcError("Justification is required"); return; }
    if (!excForm.expiration_date) { setExcError("Expiration date is required"); return; }
    setExcSubmitting(true);
    setExcError("");
    try {
      await securityApi.createException(excForm);
      setShowExcModal(false);
      setExcForm({ title: "", justification: "", description: "", severity: "medium", exception_type: "risk", expiration_date: "", compensating_controls: "" });
      setExcLoading(true);
      loadExceptions();
    } catch (err: any) {
      setExcError(err?.response?.data?.detail || "Failed to create exception");
    } finally {
      setExcSubmitting(false);
    }
  }

  async function handleAccSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accForm.name.trim()) { setAccError("Name is required"); return; }
    if (!accForm.justification.trim()) { setAccError("Justification is required"); return; }
    if (!accForm.expiration_date) { setAccError("Expiration date is required"); return; }
    setAccSubmitting(true);
    setAccError("");
    try {
      await securityApi.createAcceptance(accForm);
      setShowAccModal(false);
      setAccForm({ name: "", justification: "", expiration_date: "" });
      setAccLoading(true);
      loadAcceptances();
    } catch (err: any) {
      setAccError(err?.response?.data?.detail || "Failed to create risk acceptance");
    } finally {
      setAccSubmitting(false);
    }
  }

  async function handleApproveException(id: string) {
    try {
      await securityApi.approveException(id);
      loadExceptions();
    } catch {}
  }

  async function handleRejectException(id: string) {
    const reason = prompt("Rejection reason (optional):");
    try {
      await securityApi.rejectException(id, reason || undefined);
      loadExceptions();
    } catch {}
  }

  async function handleApproveAcceptance(id: string) {
    try {
      await securityApi.approveAcceptance(id);
      loadAcceptances();
    } catch {}
  }

  const filteredExceptions = exceptions.filter((i) =>
    i.title?.toLowerCase().includes(excSearch.toLowerCase())
  );

  return (
    <div className="p-8 max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Security Exceptions</h1>
          <p className="text-sm text-gray-500 mt-1">Manage security exceptions and risk acceptances</p>
        </div>
        <button
          onClick={() => activeTab === "exceptions" ? setShowExcModal(true) : setShowAccModal(true)}
          className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" /> {activeTab === "exceptions" ? "New Exception" : "New Risk Acceptance"}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        <button
          onClick={() => setActiveTab("exceptions")}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === "exceptions" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
        >
          <ShieldOff className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />
          Exceptions
        </button>
        <button
          onClick={() => setActiveTab("acceptances")}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === "acceptances" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
        >
          <AlertTriangle className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />
          Risk Acceptances
        </button>
      </div>

      {/* Exceptions Tab */}
      {activeTab === "exceptions" && (
        <>
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={excSearch}
                onChange={(e) => setExcSearch(e.target.value)}
                placeholder="Search exceptions..."
                className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            {excLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
              </div>
            ) : filteredExceptions.length === 0 ? (
              <div className="text-center py-16 text-gray-400">No exceptions found</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="text-left px-6 py-3 font-medium text-gray-500">Title</th>
                    <th className="text-left px-6 py-3 font-medium text-gray-500">Severity</th>
                    <th className="text-left px-6 py-3 font-medium text-gray-500">Status</th>
                    <th className="text-left px-6 py-3 font-medium text-gray-500">Type</th>
                    <th className="text-left px-6 py-3 font-medium text-gray-500">Expiration</th>
                    <th className="text-left px-6 py-3 font-medium text-gray-500">Requested By</th>
                    <th className="text-right px-6 py-3 font-medium text-gray-500">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredExceptions.map((item: any) => (
                    <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                      <td className="px-6 py-4 font-medium text-gray-900">{item.title}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${SEV_BADGE[item.severity] || "bg-gray-100 text-gray-600"}`}>
                          {item.severity}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${EXCEPTION_STATUS_BADGE[item.status] || "bg-gray-100 text-gray-600"}`}>
                          {item.status?.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-gray-600">{item.exception_type || "-"}</td>
                      <td className="px-6 py-4 text-gray-500">{item.expiration_date ? new Date(item.expiration_date).toLocaleDateString() : "-"}</td>
                      <td className="px-6 py-4 text-gray-500">{item.requested_by_id || "-"}</td>
                      <td className="px-6 py-4 text-right">
                        {(item.status === "pending_approval" || item.status === "draft") && (
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => handleApproveException(item.id)} className="inline-flex items-center gap-1 text-green-600 hover:text-green-700 text-xs font-medium">
                              <CheckCircle className="w-4 h-4" /> Approve
                            </button>
                            <button onClick={() => handleRejectException(item.id)} className="inline-flex items-center gap-1 text-red-600 hover:text-red-700 text-xs font-medium">
                              <XCircle className="w-4 h-4" /> Reject
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* Acceptances Tab */}
      {activeTab === "acceptances" && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {accLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
            </div>
          ) : acceptances.length === 0 ? (
            <div className="text-center py-16 text-gray-400">No risk acceptances found</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="text-left px-6 py-3 font-medium text-gray-500">Name</th>
                  <th className="text-left px-6 py-3 font-medium text-gray-500">Status</th>
                  <th className="text-left px-6 py-3 font-medium text-gray-500">Justification</th>
                  <th className="text-left px-6 py-3 font-medium text-gray-500">Expiration</th>
                  <th className="text-right px-6 py-3 font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {acceptances.map((item: any) => (
                  <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-4 font-medium text-gray-900">{item.name}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${ACCEPTANCE_STATUS_BADGE[item.status] || "bg-gray-100 text-gray-600"}`}>
                        {item.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-600 max-w-xs truncate">{item.justification || "-"}</td>
                    <td className="px-6 py-4 text-gray-500">{item.expiration_date ? new Date(item.expiration_date).toLocaleDateString() : "-"}</td>
                    <td className="px-6 py-4 text-right">
                      {item.status === "pending" && (
                        <button onClick={() => handleApproveAcceptance(item.id)} className="inline-flex items-center gap-1 text-green-600 hover:text-green-700 text-xs font-medium">
                          <CheckCircle className="w-4 h-4" /> Approve
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Exception Create Modal */}
      {showExcModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowExcModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900">New Security Exception</h2>
              <button onClick={() => setShowExcModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            {excError && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-xl text-sm">{excError}</div>}
            <form onSubmit={handleExcSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
                <input value={excForm.title} onChange={(e) => setExcForm({ ...excForm, title: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Justification *</label>
                <textarea value={excForm.justification} onChange={(e) => setExcForm({ ...excForm, justification: e.target.value })} rows={3} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea value={excForm.description} onChange={(e) => setExcForm({ ...excForm, description: e.target.value })} rows={2} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Severity</label>
                  <select value={excForm.severity} onChange={(e) => setExcForm({ ...excForm, severity: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Exception Type</label>
                  <select value={excForm.exception_type} onChange={(e) => setExcForm({ ...excForm, exception_type: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {EXCEPTION_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Expiration Date *</label>
                <input type="date" value={excForm.expiration_date} onChange={(e) => setExcForm({ ...excForm, expiration_date: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Compensating Controls</label>
                <textarea value={excForm.compensating_controls} onChange={(e) => setExcForm({ ...excForm, compensating_controls: e.target.value })} rows={2} placeholder="Describe compensating controls in place..." className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowExcModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
                <button type="submit" disabled={excSubmitting} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {excSubmitting && <Loader2 className="w-4 h-4 animate-spin" />} Create Exception
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Acceptance Create Modal */}
      {showAccModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowAccModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900">New Risk Acceptance</h2>
              <button onClick={() => setShowAccModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            {accError && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-xl text-sm">{accError}</div>}
            <form onSubmit={handleAccSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                <input value={accForm.name} onChange={(e) => setAccForm({ ...accForm, name: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Justification *</label>
                <textarea value={accForm.justification} onChange={(e) => setAccForm({ ...accForm, justification: e.target.value })} rows={4} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Expiration Date *</label>
                <input type="date" value={accForm.expiration_date} onChange={(e) => setAccForm({ ...accForm, expiration_date: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowAccModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
                <button type="submit" disabled={accSubmitting} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {accSubmitting && <Loader2 className="w-4 h-4 animate-spin" />} Create Acceptance
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
