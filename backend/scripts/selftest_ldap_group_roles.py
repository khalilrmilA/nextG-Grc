"""Self-test for AD group → app role mapping (app/services/directory_auth.py).

STB requires "authentification centralisée via AD, incluant la gestion des
droits" — entitlements administered in the directory, not re-entered in the
app. None of this can be exercised without a live Active Directory, so the
resolution logic is tested here against realistic ``memberOf`` DNs.

Run:  venv/bin/python scripts/selftest_ldap_group_roles.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.directory_auth import (  # noqa: E402
    group_map_configured,
    map_groups_to_role,
)

failures: list[str] = []


def check(label: str, got, want) -> None:
    if got == want:
        print(f"  ok   {label}")
    else:
        failures.append(f"{label}: got {got!r}, want {want!r}")
        print(f"  FAIL {label}: got {got!r}, want {want!r}")


# A realistic STB-shaped map, written the way an admin would: bare CNs.
STB_MAP = {
    "GRC_RSSI": "ciso",
    "GRC_Risques": "risk_manager",
    "GRC_Conformite": "compliance_manager",
    "GRC_Auditeurs": "auditor",
    "GRC_Lecture": "viewer",
}
CFG = {"group_role_map": STB_MAP, "default_role": "viewer"}

DN_RSSI = "CN=GRC_RSSI,OU=Groupes,DC=stb,DC=com,DC=tn"
DN_AUDIT = "CN=GRC_Auditeurs,OU=Groupes,DC=stb,DC=com,DC=tn"
DN_LECTURE = "CN=GRC_Lecture,OU=Groupes,DC=stb,DC=com,DC=tn"
DN_UNRELATED = "CN=Domain Users,CN=Users,DC=stb,DC=com,DC=tn"


def main() -> None:
    print("\nmatching")
    check("full DN matches a bare-CN map key",
          map_groups_to_role([DN_RSSI], CFG), "ciso")
    check("bare group name also matches",
          map_groups_to_role(["GRC_Auditeurs"], CFG), "auditor")
    check("matching is case-insensitive",
          map_groups_to_role(["cn=grc_rssi,ou=groupes,dc=stb,dc=com,dc=tn"], CFG), "ciso")
    check("unmapped groups resolve to None",
          map_groups_to_role([DN_UNRELATED], CFG), None)
    check("no groups at all resolves to None",
          map_groups_to_role([], CFG), None)

    print("\nprecedence (most privileged wins, order-independent)")
    check("ciso beats auditor",
          map_groups_to_role([DN_AUDIT, DN_RSSI], CFG), "ciso")
    check("same result in the reverse order",
          map_groups_to_role([DN_RSSI, DN_AUDIT], CFG), "ciso")
    check("three memberships pick the top one",
          map_groups_to_role([DN_LECTURE, DN_AUDIT, DN_RSSI], CFG), "ciso")
    check("noise groups don't disturb the winner",
          map_groups_to_role([DN_UNRELATED, DN_LECTURE, DN_AUDIT], CFG), "auditor")

    print("\nconfiguration robustness")
    check("no map configured -> not configured",
          group_map_configured({"group_role_map": {}}), False)
    check("map configured -> configured",
          group_map_configured(CFG), True)
    check("map supplied as a JSON string (env var) works",
          map_groups_to_role([DN_RSSI], {"group_role_map": '{"GRC_RSSI": "ciso"}'}), "ciso")
    check("JSON string counts as configured",
          group_map_configured({"group_role_map": '{"GRC_RSSI": "ciso"}'}), True)
    check("malformed JSON degrades to unconfigured, never raises",
          group_map_configured({"group_role_map": "{not json"}), False)
    check("malformed JSON maps nothing",
          map_groups_to_role([DN_RSSI], {"group_role_map": "{not json"}), None)
    check("a role name that isn't a real UserRole is ignored",
          map_groups_to_role([DN_RSSI], {"group_role_map": {"GRC_RSSI": "wizard"}}), None)
    check("role values are case/space tolerant",
          map_groups_to_role([DN_RSSI], {"group_role_map": {"GRC_RSSI": " CISO "}}), "ciso")

    print("\nprivilege escalation is not reachable from a directory group")
    # super_admin is platform-wide and crosses every tenant; tenant_admin owns
    # the whole organisation. users.py/groups.py refuse to delegate either, and
    # a group map must not become a way around that.
    check("super_admin cannot be granted by an AD group",
          map_groups_to_role([DN_RSSI], {"group_role_map": {"GRC_RSSI": "super_admin"}}), None)
    check("tenant_admin cannot be granted by an AD group",
          map_groups_to_role([DN_RSSI], {"group_role_map": {"GRC_RSSI": "tenant_admin"}}), None)
    check("a privileged entry doesn't poison the rest of the map",
          map_groups_to_role([DN_RSSI, DN_AUDIT],
                             {"group_role_map": {"GRC_RSSI": "super_admin", "GRC_Auditeurs": "auditor"}}),
          "auditor")

    print("\nDN-scoped keys stay scoped (no same-name widening)")
    dn_scoped = {"group_role_map": {"CN=GRC_Admins,OU=Corp,DC=stb,DC=tn": "ciso"}}
    check("the exact DN matches",
          map_groups_to_role(["CN=GRC_Admins,OU=Corp,DC=stb,DC=tn"], dn_scoped), "ciso")
    check("a same-named group in another OU does NOT match",
          map_groups_to_role(["CN=GRC_Admins,OU=Branch,DC=stb,DC=tn"], dn_scoped), None)
    check("the bare CN alone does NOT match a DN-scoped key",
          map_groups_to_role(["GRC_Admins"], dn_scoped), None)

    print("\nDN parsing edge cases")
    check("escaped comma in a group name is preserved",
          map_groups_to_role([r"CN=GRC\, RSSI,OU=Groupes,DC=stb,DC=tn"],
                             {"group_role_map": {r"GRC\, RSSI": "ciso"}}), "ciso")
    check("a DN with no RDN separator still matches by CN",
          map_groups_to_role(["CN=GRC_RSSI"], CFG), "ciso")
    check("an empty group DN is skipped",
          map_groups_to_role(["", DN_AUDIT], CFG), "auditor")
    check("a group with no '=' is treated as a bare name",
          map_groups_to_role(["GRC_RSSI"], CFG), "ciso")

    print()
    if failures:
        print(f"FAILED ({len(failures)}):")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print("all LDAP group→role self-tests passed")


if __name__ == "__main__":
    main()
