/**
 * EntitlementsContext — what this tenant is actually allowed to use.
 *
 * Loaded once after login from GET /subscriptions/current/entitlements, which
 * computes its answer with the same has_feature() that require_feature enforces
 * with on every gated endpoint. Gating the UI on anything else lets the two
 * drift, and a drifted gate is worse than none: the sidebar offers a page that
 * answers 402 when clicked.
 *
 * Fail OPEN, deliberately. If the request fails we return true for everything
 * and render the full navigation. The backend is still enforcing, so the worst
 * case is a 402 the user could already have hit; failing closed would blank the
 * sidebar of a working appliance because one request timed out.
 */
import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { authSession } from "../store/auth";
import { subscriptionsApi } from "../api/endpoints";

interface EntitlementsValue {
  /** feature key -> allowed. Empty until loaded. */
  features: Record<string, boolean>;
  /** The tenant's pack, or "super_admin". */
  tier: string;
  /** Numeric quotas (max_vendors, ...). Not gates. */
  limits: Record<string, unknown>;
  loading: boolean;
  /** True if the map could not be loaded, so everything is being shown. */
  degraded: boolean;
  /**
   * True if the tenant may use `feature`.
   *
   * Unknown keys return true. A nav item naming a feature the backend does not
   * publish is a mapping mistake in the frontend, and hiding the page would
   * turn that mistake into an invisible one.
   */
  hasFeature: (feature: string) => boolean;
  /** True if ANY of the features is allowed. For pages backed by more than one. */
  hasAnyFeature: (features: readonly string[]) => boolean;
  reload: () => void;
}

const EntitlementsContext = createContext<EntitlementsValue>({
  features: {},
  tier: "",
  limits: {},
  loading: false,
  degraded: false,
  hasFeature: () => true,
  hasAnyFeature: () => true,
  reload: () => {},
});

export function EntitlementsProvider({ children }: { children: React.ReactNode }) {
  const [features, setFeatures] = useState<Record<string, boolean>>({});
  const [tier, setTier] = useState("");
  const [limits, setLimits] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(false);
  const [degraded, setDegraded] = useState(false);

  const load = useCallback(() => {
    if (!authSession.isLoggedIn()) {
      // Signed out: drop the previous tenant's map rather than leaving it for
      // whoever logs in next.
      setFeatures({});
      setTier("");
      setDegraded(false);
      return;
    }
    setLoading(true);
    subscriptionsApi
      .getEntitlements()
      .then((d) => {
        setFeatures(d.features ?? {});
        setTier(d.tier ?? "");
        setLimits(d.limits ?? {});
        setDegraded(false);
      })
      .catch(() => {
        // Older backend, or the request failed. Show everything.
        setFeatures({});
        setDegraded(true);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const hasFeature = useCallback(
    (feature: string) => {
      if (degraded) return true;
      const v = features[feature];
      return v === undefined ? true : v;
    },
    [features, degraded],
  );

  const hasAnyFeature = useCallback(
    (keys: readonly string[]) => keys.length === 0 || keys.some((k) => hasFeature(k)),
    [hasFeature],
  );

  return (
    <EntitlementsContext.Provider
      value={{ features, tier, limits, loading, degraded, hasFeature, hasAnyFeature, reload: load }}
    >
      {children}
    </EntitlementsContext.Provider>
  );
}

export function useEntitlements() {
  return useContext(EntitlementsContext);
}
