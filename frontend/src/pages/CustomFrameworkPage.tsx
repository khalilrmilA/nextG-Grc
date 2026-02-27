import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, Plus, Trash2, ChevronDown, ChevronRight,
  Loader2, CheckCircle, Save,
} from "lucide-react";
import { customFrameworkApi } from "@/api/endpoints";
import type { Framework, FrameworkControl, ControlCreate, RequirementCreate } from "@/types";

const REGIONS = ["Global", "EU", "US", "US-Gov", "UK", "APAC", "LATAM", "MEA"];
const INDUSTRIES = ["All", "Technology", "Finance", "Healthcare", "Government", "Retail", "Energy", "Manufacturing"];
const CATEGORIES = [
  "identify", "protect", "detect", "respond", "recover",
  "governance", "organizational", "technical", "physical",
];

// ─── Step 1: Framework Metadata ────────────────────────────────────────────────

function MetadataStep({
  onCreated,
}: {
  readonly onCreated: (fw: Framework) => void;
}) {
  const [name, setName]         = useState("");
  const [shortName, setShort]   = useState("");
  const [version, setVersion]   = useState("1.0");
  const [description, setDesc]  = useState("");
  const [issuingBody, setIssuer]= useState("");
  const [regions, setRegions]   = useState<string[]>([]);
  const [industries, setIndustries] = useState<string[]>([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");

  function autoSlug(n: string) {
    return n.toUpperCase().replace(/[^A-Z0-9]/g, "_").slice(0, 20);
  }

  function toggleRegion(r: string) {
    setRegions((prev) => prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]);
  }
  function toggleIndustry(i: string) {
    setIndustries((prev) => prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !shortName.trim()) return;
    setLoading(true);
    setError("");
    try {
      const fw = await customFrameworkApi.create({
        name: name.trim(),
        short_name: shortName.trim(),
        version: version.trim() || "1.0",
        description: description.trim() || undefined,
        issuing_body: issuingBody.trim() || undefined,
        applicable_regions: regions,
        applicable_industries: industries,
      });
      onCreated(fw);
    } catch {
      setError("Failed to create framework. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="max-w-2xl space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">Framework name *</label>
          <input
            type="text"
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g. Acme Corp Internal Security Standard"
            value={name}
            onChange={(e) => { setName(e.target.value); if (!shortName) setShort(autoSlug(e.target.value)); }}
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Short name / code *</label>
          <input
            type="text"
            maxLength={20}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g. ACME_SEC"
            value={shortName}
            onChange={(e) => setShort(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 20))}
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Version</label>
          <input
            type="text"
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="1.0"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
          />
        </div>

        <div className="col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
          <textarea
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            rows={3}
            placeholder="Brief description of the purpose and scope of this framework…"
            value={description}
            onChange={(e) => setDesc(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Issuing body</label>
          <input
            type="text"
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g. Acme Corp Security Team"
            value={issuingBody}
            onChange={(e) => setIssuer(e.target.value)}
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Applicable regions</label>
        <div className="flex flex-wrap gap-2">
          {REGIONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => toggleRegion(r)}
              className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
                regions.includes(r)
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Applicable industries</label>
        <div className="flex flex-wrap gap-2">
          {INDUSTRIES.map((i) => (
            <button
              key={i}
              type="button"
              onClick={() => toggleIndustry(i)}
              className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
                industries.includes(i)
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
              }`}
            >
              {i}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={loading || !name.trim() || !shortName.trim()}
        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-colors"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        Save & Continue to Controls
      </button>
    </form>
  );
}

// ─── Requirement row in add-control form ──────────────────────────────────────

function RequirementInput({
  req,
  index,
  onChange,
  onRemove,
}: {
  readonly req: RequirementCreate;
  readonly index: number;
  readonly onChange: (i: number, r: RequirementCreate) => void;
  readonly onRemove: (i: number) => void;
}) {
  return (
    <div className="flex items-start gap-2">
      <select
        className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 w-20 flex-shrink-0"
        value={req.requirement_level}
        onChange={(e) => onChange(index, { ...req, requirement_level: e.target.value as RequirementCreate["requirement_level"] })}
      >
        <option value="must">must</option>
        <option value="should">should</option>
        <option value="may">may</option>
      </select>
      <input
        type="text"
        className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
        placeholder="Requirement text…"
        value={req.requirement_text}
        onChange={(e) => onChange(index, { ...req, requirement_text: e.target.value })}
      />
      <button type="button" onClick={() => onRemove(index)} className="text-gray-300 hover:text-red-500 mt-1.5">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ─── Step 2: Control Builder ───────────────────────────────────────────────────

function ControlBuilderStep({ framework }: { readonly framework: Framework }) {
  const [controls, setControls] = useState<(FrameworkControl & { pending?: boolean })[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Add control form state
  const [controlId, setControlId]     = useState("");
  const [title, setTitle]             = useState("");
  const [category, setCategory]       = useState("");
  const [description, setDescription] = useState("");
  const [guidance, setGuidance]       = useState("");
  const [tags, setTags]               = useState("");
  const [requirements, setRequirements] = useState<RequirementCreate[]>([
    { requirement_text: "", requirement_level: "must" },
  ]);
  const [saving, setSaving]     = useState(false);
  const [saveError, setSaveError] = useState("");

  function resetForm() {
    setControlId(""); setTitle(""); setCategory(""); setDescription("");
    setGuidance(""); setTags("");
    setRequirements([{ requirement_text: "", requirement_level: "must" }]);
  }

  async function addControl(e: React.FormEvent) {
    e.preventDefault();
    if (!controlId.trim() || !title.trim()) return;
    setSaving(true);
    setSaveError("");
    try {
      const ctrl = await customFrameworkApi.addControl(framework.id, {
        control_id: controlId.trim(),
        title: title.trim(),
        description: description.trim() || undefined,
        guidance: guidance.trim() || undefined,
        category: category || undefined,
        tags: tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
      });

      // Add requirements
      const validReqs = requirements.filter((r) => r.requirement_text.trim());
      for (const req of validReqs) {
        await customFrameworkApi.addRequirement(framework.id, ctrl.id, req);
      }

      setControls((prev) => [...prev, ctrl]);
      resetForm();
    } catch {
      setSaveError("Failed to save control. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteControl(ctrl: FrameworkControl) {
    try {
      await customFrameworkApi.deleteControl(framework.id, ctrl.id);
      setControls((prev) => prev.filter((c) => c.id !== ctrl.id));
      if (expanded === ctrl.id) setExpanded(null);
    } catch {
      // silent
    }
  }

  return (
    <div className="grid grid-cols-5 gap-6">
      {/* Left: Control tree */}
      <div className="col-span-2 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">Controls ({controls.length})</h3>
        </div>
        {controls.length === 0 ? (
          <div className="text-center py-8 text-xs text-gray-400 border-2 border-dashed border-gray-200 rounded-xl">
            No controls yet. Add your first control →
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-50">
            {controls.map((ctrl) => (
              <div key={ctrl.id}>
                <div
                  className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-gray-50"
                  onClick={() => setExpanded(expanded === ctrl.id ? null : ctrl.id)}
                >
                  {expanded === ctrl.id ? (
                    <ChevronDown className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                  )}
                  <span className="font-mono text-xs text-gray-400">{ctrl.control_id}</span>
                  <span className="flex-1 text-xs font-medium text-gray-700 truncate">{ctrl.title}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteControl(ctrl); }}
                    className="text-gray-200 hover:text-red-500 flex-shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                {expanded === ctrl.id && (
                  <div className="px-4 pb-3 text-xs text-gray-500 space-y-1">
                    {ctrl.category && <p><span className="font-medium">Category:</span> {ctrl.category}</p>}
                    {ctrl.description && <p className="text-gray-600">{ctrl.description}</p>}
                    {ctrl.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {ctrl.tags.map((t) => (
                          <span key={t} className="bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded text-xs">{t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Framework summary */}
        {controls.length > 0 && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-xs text-green-700">
            <CheckCircle className="w-3.5 h-3.5 inline mr-1" />
            Framework <strong>{framework.short_name}</strong> has {controls.length} control{controls.length !== 1 ? "s" : ""}. You can now use it in assessments.
          </div>
        )}
      </div>

      {/* Right: Add control form */}
      <div className="col-span-3">
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Add Control</h3>
          <form onSubmit={addControl} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Control ID *</label>
                <input
                  type="text"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="e.g. SEC-1.1"
                  value={controlId}
                  onChange={(e) => setControlId(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
                <select
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="">None</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Title *</label>
              <input
                type="text"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="e.g. Password Management Policy"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
              <textarea
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                rows={2}
                placeholder="What this control covers…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Implementation guidance</label>
              <textarea
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                rows={2}
                placeholder="How to implement this control…"
                value={guidance}
                onChange={(e) => setGuidance(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Tags (comma-separated)</label>
              <input
                type="text"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="access-control, passwords, iam"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
              />
            </div>

            {/* Requirements */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-gray-600">Requirements</label>
                <button
                  type="button"
                  onClick={() => setRequirements((prev) => [...prev, { requirement_text: "", requirement_level: "must" }])}
                  className="text-xs text-blue-600 hover:text-blue-800"
                >
                  + Add
                </button>
              </div>
              <div className="space-y-2">
                {requirements.map((req, i) => (
                  <RequirementInput
                    key={i}
                    req={req}
                    index={i}
                    onChange={(idx, r) => setRequirements((prev) => prev.map((x, j) => j === idx ? r : x))}
                    onRemove={(idx) => setRequirements((prev) => prev.filter((_, j) => j !== idx))}
                  />
                ))}
              </div>
            </div>

            {saveError && <p className="text-xs text-red-600">{saveError}</p>}

            <button
              type="submit"
              disabled={saving || !controlId.trim() || !title.trim()}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors w-full justify-center"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Add Control
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function CustomFrameworkPage() {
  const navigate = useNavigate();
  const [framework, setFramework] = useState<Framework | null>(null);

  return (
    <div className="p-8 max-w-6xl space-y-6">
      {/* Header */}
      <div>
        <button
          onClick={() => navigate("/frameworks")}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-3"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to frameworks
        </button>
        <h1 className="text-2xl font-bold text-gray-900">Create Custom Framework</h1>
        <p className="text-gray-500 text-sm mt-1">
          Build your own compliance standard with sections, controls, and requirements
        </p>
      </div>

      {/* Steps */}
      <div className="flex items-center gap-3 mb-2">
        <div className={`flex items-center gap-2 text-sm font-medium ${!framework ? "text-blue-600" : "text-green-600"}`}>
          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${!framework ? "bg-blue-600 text-white" : "bg-green-100 text-green-700"}`}>
            {framework ? <CheckCircle className="w-3.5 h-3.5" /> : "1"}
          </span>
          Framework Details
        </div>
        <div className="h-px w-8 bg-gray-200" />
        <div className={`flex items-center gap-2 text-sm font-medium ${framework ? "text-blue-600" : "text-gray-400"}`}>
          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${framework ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-400"}`}>
            2
          </span>
          Add Controls
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        {!framework ? (
          <MetadataStep onCreated={(fw) => setFramework(fw)} />
        ) : (
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-blue-600 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-blue-800">{framework.name}</p>
                <p className="text-xs text-blue-600">
                  {framework.short_name} v{framework.version} · Created successfully. Now add controls below.
                </p>
              </div>
            </div>
            <ControlBuilderStep framework={framework} />
          </div>
        )}
      </div>
    </div>
  );
}
