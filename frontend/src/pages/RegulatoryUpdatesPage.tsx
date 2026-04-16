import { useState, useEffect } from "react";
import {
  Plus,
  Search,
  X,
  Loader2,
  Filter,
  Scale,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Calendar,
  AlertCircle,
  Sparkles,
  CheckCircle2,
  ThumbsUp,
  ThumbsDown,
  Clock,
} from "lucide-react";
import { regulatoryApi } from "@/api/endpoints";

const IMPACT_BADGE: Record<string, string> = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high: "bg-orange-100 text-orange-700 border-orange-200",
  medium: "bg-yellow-100 text-yellow-700 border-yellow-200",
  low: "bg-green-100 text-green-700 border-green-200",
  informational: "bg-blue-100 text-blue-700 border-blue-200",
};

const STATUS_BADGE: Record<string, string> = {
  new: "bg-blue-100 text-blue-700 border-blue-200",
  under_review: "bg-yellow-100 text-yellow-700 border-yellow-200",
  action_required: "bg-red-100 text-red-700 border-red-200",
  implemented: "bg-green-100 text-green-700 border-green-200",
  not_applicable: "bg-gray-100 text-gray-600 border-gray-200",
};

const IMPACT_OPTIONS = ["critical", "high", "medium", "low", "informational"];
const STATUS_OPTIONS = ["new", "under_review", "action_required", "implemented", "not_applicable"];

function formatLabel(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function RegulatoryUpdatesPage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchResult, setFetchResult] = useState<{ created: number; message: string } | null>(null);
  const [approving, setApproving] = useState<string | null>(null);

  const [form, setForm] = useState({
    title: "",
    description: "",
    source: "",
    regulation_name: "",
    impact: "medium",
    effective_date: "",
    deadline: "",
    url: "",
  });

  async function load() {
    try {
      const params: any = {};
      if (statusFilter) params.status_filter = statusFilter;
      const data = await regulatoryApi.list(params);
      setItems(Array.isArray(data) ? data : data.items || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [statusFilter]);

  async function handleApprove(id: string) {
    setApproving(id);
    try {
      await regulatoryApi.approve(id);
      load();
    } finally {
      setApproving(null);
    }
  }

  async function handleReject(id: string) {
    setApproving(id);
    try {
      await regulatoryApi.reject(id);
      load();
    } finally {
      setApproving(null);
    }
  }

  async function handleFetchNews() {
    setFetching(true);
    setFetchResult(null);
    try {
      const result = await regulatoryApi.fetchNews();
      setFetchResult({ created: result.created, message: result.message });
      if (result.created > 0) {
        setLoading(true);
        load();
      }
    } catch {
      setFetchResult({ created: 0, message: "Failed to fetch news. Make sure the backend is running." });
    } finally {
      setFetching(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) {
      setError("Title is required");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await regulatoryApi.create({
        ...form,
        effective_date: form.effective_date || null,
        deadline: form.deadline || null,
        url: form.url || null,
      });
      setShowModal(false);
      setForm({
        title: "",
        description: "",
        source: "",
        regulation_name: "",
        impact: "medium",
        effective_date: "",
        deadline: "",
        url: "",
      });
      setLoading(true);
      load();
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Failed to create regulatory update");
    } finally {
      setSubmitting(false);
    }
  }

  const pending = items.filter((i) => i.status === "pending_approval");
  const filtered = items.filter(
    (i) =>
      i.status !== "pending_approval" &&
      (i.title?.toLowerCase().includes(search.toLowerCase()) ||
        i.regulation_name?.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="p-8 max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Regulatory Updates</h1>
          <p className="text-sm text-gray-500 mt-1">
            Track regulatory changes and their impact on your organization
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleFetchNews}
            disabled={fetching}
            className="inline-flex items-center gap-2 bg-purple-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-purple-700 disabled:opacity-60 transition-colors"
          >
            {fetching ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            {fetching ? "Fetching..." : "Fetch Latest (AI)"}
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Update
          </button>
        </div>
      </div>

      {fetchResult && (() => {
        const updateWord = fetchResult.created === 1 ? "update" : "updates";
        return (
        <div
          className={`flex items-start gap-3 px-4 py-3 rounded-xl text-sm border ${
            fetchResult.created > 0
              ? "bg-green-50 border-green-200 text-green-800"
              : "bg-gray-50 border-gray-200 text-gray-600"
          }`}
        >
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="flex-1">
            <span className="font-medium">
              {fetchResult.created > 0
                ? `${fetchResult.created} ${updateWord} ready for review`
                : "No new proposals"}
            </span>
            <span className="ml-2 text-xs opacity-75">{fetchResult.message}</span>
          </div>
          <button onClick={() => setFetchResult(null)} className="opacity-50 hover:opacity-100">
            <X className="w-4 h-4" />
          </button>
        </div>
        );
      })()}

      {/* Pending Approval Queue */}
      {pending.length > 0 && (
        <div className="bg-white rounded-2xl border border-amber-200 shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-6 py-4 border-b border-amber-100 bg-amber-50/60">
            <Clock className="w-4 h-4 text-amber-600" />
            <h2 className="font-semibold text-amber-900 text-sm">
              AI Proposals — Pending Your Review ({pending.length})
            </h2>
            <span className="ml-auto text-xs text-amber-600">
              Review each item and approve or reject
            </span>
          </div>
          <div className="divide-y divide-gray-50">
            {pending.map((item: any) => (
              <div key={item.id} className="flex items-start gap-4 px-6 py-4 hover:bg-gray-50/40 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm text-gray-900">{item.title}</span>
                    {item.impact && (
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold border ${IMPACT_BADGE[item.impact] || "bg-gray-100 text-gray-600"}`}>
                        {item.impact}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                    {item.source && <span>{item.source}</span>}
                    {item.regulation_name && <span className="font-medium text-blue-600">{item.regulation_name}</span>}
                    {item.affected_frameworks?.length > 0 && (
                      <span>{item.affected_frameworks.join(", ")}</span>
                    )}
                  </div>
                  {item.description && (
                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">{item.description}</p>
                  )}
                  {item.url && (
                    <a href={item.url} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-blue-500 hover:underline mt-1">
                      <ExternalLink className="w-3 h-3" /> View source
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleApprove(item.id)}
                    disabled={approving === item.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
                  >
                    {approving === item.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <ThumbsUp className="w-3 h-3" />}
                    Approve
                  </button>
                  <button
                    onClick={() => handleReject(item.id)}
                    disabled={approving === item.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-red-200 text-red-600 text-xs font-medium rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
                  >
                    {approving === item.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <ThumbsDown className="w-3 h-3" />}
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-5 gap-4">
        {STATUS_OPTIONS.map((s) => {
          const count = items.filter((i) => i.status === s).length;
          return (
            <div key={s} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold border ${STATUS_BADGE[s]}`}
                >
                  {formatLabel(s)}
                </span>
              </div>
              <p className="text-2xl font-bold text-gray-900 mt-2">{count}</p>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search updates..."
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-400" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-gray-200 rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {formatLabel(s)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Scale className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No regulatory updates found</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-6 py-3 font-medium text-gray-500 w-8" />
                <th className="text-left px-6 py-3 font-medium text-gray-500">Title</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Source</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Regulation</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Impact</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Status</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Effective</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Deadline</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item: any) => (
                <>
                  <tr
                    key={item.id}
                    onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                    className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors cursor-pointer"
                  >
                    <td className="px-6 py-4">
                      {expandedId === item.id ? (
                        <ChevronUp className="w-4 h-4 text-gray-400" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-gray-400" />
                      )}
                    </td>
                    <td className="px-6 py-4 font-medium text-gray-900">{item.title}</td>
                    <td className="px-6 py-4 text-gray-600">{item.source || "-"}</td>
                    <td className="px-6 py-4 text-gray-600">{item.regulation_name || "-"}</td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${
                          IMPACT_BADGE[item.impact] || "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {item.impact}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${
                          STATUS_BADGE[item.status] || "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {formatLabel(item.status || "new")}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-500">
                      {item.effective_date
                        ? new Date(item.effective_date).toLocaleDateString()
                        : "-"}
                    </td>
                    <td className="px-6 py-4 text-gray-500">
                      {item.deadline ? new Date(item.deadline).toLocaleDateString() : "-"}
                    </td>
                  </tr>
                  {expandedId === item.id && (
                    <tr key={`${item.id}-detail`} className="border-b border-gray-50">
                      <td colSpan={8} className="px-6 py-4 bg-gray-50/30">
                        <div className="space-y-3">
                          {item.description && (
                            <div>
                              <p className="text-xs font-medium text-gray-500 mb-1">Description</p>
                              <p className="text-sm text-gray-700 whitespace-pre-wrap">
                                {item.description}
                              </p>
                            </div>
                          )}
                          <div className="flex items-center gap-4">
                            {item.url && (
                              <a
                                href={item.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
                              >
                                <ExternalLink className="w-3 h-3" /> View Source
                              </a>
                            )}
                            {item.effective_date && (
                              <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                                <Calendar className="w-3 h-3" /> Effective:{" "}
                                {new Date(item.effective_date).toLocaleDateString()}
                              </span>
                            )}
                            {item.deadline && (
                              <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                                <AlertCircle className="w-3 h-3" /> Deadline:{" "}
                                {new Date(item.deadline).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                          {item.notes && (
                            <div>
                              <p className="text-xs font-medium text-gray-500 mb-1">Notes</p>
                              <p className="text-sm text-gray-700 whitespace-pre-wrap">
                                {item.notes}
                              </p>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setShowModal(false)}
          />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900">Add Regulatory Update</h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {error && (
              <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-xl text-sm">{error}</div>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
                <input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={3}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Source</label>
                  <input
                    value={form.source}
                    onChange={(e) => setForm({ ...form, source: e.target.value })}
                    placeholder="e.g. EU Commission"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Regulation Name
                  </label>
                  <input
                    value={form.regulation_name}
                    onChange={(e) => setForm({ ...form, regulation_name: e.target.value })}
                    placeholder="e.g. GDPR, NIS2"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Impact</label>
                <select
                  value={form.impact}
                  onChange={(e) => setForm({ ...form, impact: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {IMPACT_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {formatLabel(o)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Effective Date
                  </label>
                  <input
                    type="date"
                    value={form.effective_date}
                    onChange={(e) => setForm({ ...form, effective_date: e.target.value })}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Deadline</label>
                  <input
                    type="date"
                    value={form.deadline}
                    onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">URL</label>
                <input
                  type="url"
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  placeholder="https://..."
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />} Add Update
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
