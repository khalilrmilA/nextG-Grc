import { useState, useEffect } from "react";
import {
  Plus,
  X,
  Loader2,
  Webhook,
  Trash2,
  Zap,
  CheckCircle2,
  XCircle,
  Globe,
} from "lucide-react";
import { webhooksApi } from "@/api/endpoints";

const MODULE_GROUPS: Record<string, string[]> = {
  risk: ["risk.created", "risk.updated", "risk.deleted"],
  incident: ["incident.created", "incident.updated", "incident.resolved"],
  compliance: ["compliance.assessment_completed", "compliance.gap_identified", "compliance.status_changed"],
  vendor: ["vendor.created", "vendor.updated", "vendor.risk_changed"],
  audit: ["audit.created", "audit.completed", "audit.finding_added"],
  policy: ["policy.created", "policy.published", "policy.expired"],
  user: ["user.created", "user.login", "user.role_changed"],
};

export default function WebhooksPage() {
  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [availableEvents, setAvailableEvents] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, { loading: boolean; code?: number; error?: string }>>({});

  const [form, setForm] = useState({
    url: "",
    description: "",
    events: [] as string[],
  });

  async function load() {
    try {
      const [hooks, events] = await Promise.all([
        webhooksApi.list(),
        webhooksApi.listEvents().catch(() => []),
      ]);
      setWebhooks(Array.isArray(hooks) ? hooks : hooks.items || []);
      if (Array.isArray(events) && events.length > 0) {
        setAvailableEvents(events);
      } else {
        // Fallback to hardcoded events
        setAvailableEvents(Object.values(MODULE_GROUPS).flat());
      }
    } catch {
      setWebhooks([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.url.trim()) {
      setError("URL is required");
      return;
    }
    if (form.events.length === 0) {
      setError("Select at least one event");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await webhooksApi.create({
        url: form.url,
        description: form.description || null,
        events: form.events,
      });
      setShowModal(false);
      setForm({ url: "", description: "", events: [] });
      setLoading(true);
      load();
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Failed to create webhook");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this webhook?")) return;
    try {
      await webhooksApi.delete(id);
      setWebhooks((prev) => prev.filter((w) => w.id !== id));
    } catch {}
  }

  async function handleTest(id: string) {
    setTestResults((prev) => ({ ...prev, [id]: { loading: true } }));
    try {
      const result = await webhooksApi.test(id);
      setTestResults((prev) => ({
        ...prev,
        [id]: { loading: false, code: result.status_code || result.code || 200 },
      }));
    } catch (err: any) {
      setTestResults((prev) => ({
        ...prev,
        [id]: { loading: false, error: err?.response?.data?.detail || "Test failed" },
      }));
    }
  }

  function toggleEvent(event: string) {
    setForm((prev) => ({
      ...prev,
      events: prev.events.includes(event)
        ? prev.events.filter((e) => e !== event)
        : [...prev.events, event],
    }));
  }

  function toggleModuleGroup(module: string) {
    const moduleEvents = MODULE_GROUPS[module] || [];
    const filtered = availableEvents.filter((e) => e.startsWith(module + "."));
    const events = filtered.length > 0 ? filtered : moduleEvents;
    const allSelected = events.every((e) => form.events.includes(e));
    if (allSelected) {
      setForm((prev) => ({
        ...prev,
        events: prev.events.filter((e) => !events.includes(e)),
      }));
    } else {
      setForm((prev) => ({
        ...prev,
        events: [...new Set([...prev.events, ...events])],
      }));
    }
  }

  // Group available events by module
  const groupedEvents: Record<string, string[]> = {};
  availableEvents.forEach((ev) => {
    const module = ev.split(".")[0];
    if (!groupedEvents[module]) groupedEvents[module] = [];
    groupedEvents[module].push(ev);
  });

  return (
    <div className="p-8 max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Webhooks</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage webhook integrations to receive real-time event notifications
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" /> Add Webhook
        </button>
      </div>

      {/* Webhook Cards */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
        </div>
      ) : webhooks.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-16 text-center">
          <Webhook className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          <p className="text-sm text-gray-400">No webhooks configured</p>
          <p className="text-xs text-gray-400 mt-1">
            Add a webhook to receive event notifications
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {webhooks.map((hook: any) => {
            const test = testResults[hook.id];
            return (
              <div
                key={hook.id}
                className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Globe className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      <p className="text-sm font-medium text-gray-900 truncate">{hook.url}</p>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold border ${
                          hook.is_active !== false
                            ? "bg-green-50 text-green-700 border-green-200"
                            : "bg-gray-50 text-gray-500 border-gray-200"
                        }`}
                      >
                        {hook.is_active !== false ? "Active" : "Inactive"}
                      </span>
                    </div>
                    {hook.description && (
                      <p className="text-xs text-gray-500 mb-3 ml-6">{hook.description}</p>
                    )}
                    <div className="flex flex-wrap gap-1.5 ml-6">
                      {(hook.events || []).map((ev: string) => (
                        <span
                          key={ev}
                          className="inline-flex items-center bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2.5 py-0.5 text-xs font-medium"
                        >
                          {ev}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {/* Test result */}
                    {test && !test.loading && (
                      <span className="flex items-center gap-1 text-xs">
                        {test.error ? (
                          <span className="text-red-600 flex items-center gap-1">
                            <XCircle className="w-3 h-3" /> {test.error}
                          </span>
                        ) : (
                          <span className="text-green-600 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> {test.code}
                          </span>
                        )}
                      </span>
                    )}
                    <button
                      onClick={() => handleTest(hook.id)}
                      disabled={test?.loading}
                      className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors disabled:opacity-50"
                    >
                      {test?.loading ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Zap className="w-3.5 h-3.5" />
                      )}
                      Test
                    </button>
                    <button
                      onClick={() => handleDelete(hook.id)}
                      className="inline-flex items-center gap-1 text-sm text-red-600 hover:text-red-700 font-medium px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setShowModal(false)}
          />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900">Add Webhook</h2>
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
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Webhook URL *
                </label>
                <input
                  type="url"
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  placeholder="https://example.com/webhook"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="e.g. Slack integration for incidents"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Events *
                </label>
                <div className="space-y-4">
                  {Object.entries(groupedEvents).map(([module, events]) => (
                    <div key={module}>
                      <div className="flex items-center gap-2 mb-2">
                        <input
                          type="checkbox"
                          checked={events.every((e) => form.events.includes(e))}
                          onChange={() => toggleModuleGroup(module)}
                          className="rounded border-gray-300"
                        />
                        <span className="text-sm font-semibold text-gray-900 capitalize">
                          {module}.*
                        </span>
                      </div>
                      <div className="ml-6 grid grid-cols-1 gap-1.5">
                        {events.map((ev) => (
                          <label
                            key={ev}
                            className="flex items-center gap-2 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={form.events.includes(ev)}
                              onChange={() => toggleEvent(ev)}
                              className="rounded border-gray-300"
                            />
                            <span className="text-sm text-gray-600">{ev}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
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
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />} Create Webhook
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
