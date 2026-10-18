# Design papers

These are the seven block design papers that Volume 3 of the NG-GRC Reference Architecture condenses. They are the detailed specifications for engineers: components, data model, flows, APIs, migration steps, phasing, ADRs and risks.

| Paper | Volume 3 chapter |
|---|---|
| [design-content.md](design-content.md) | §8: KSA content and cross-mapping |
| [design-core.md](design-core.md) | §8: core completion and Arabic |
| [design-inventory.md](design-inventory.md) | §9: inventory collector |
| [design-ctem.md](design-ctem.md) | §10: CTEM connection |
| [design-tenancy.md](design-tenancy.md) | §11: multi-entity, MSSP and white-label |
| [design-enterprise.md](design-enterprise.md) | §12: API, SSO, audit trail and events |
| [design-platform.md](design-platform.md) | §13: platform foundations and deployment |

**Sensitivity.** The "current state" sections of these papers point at today's code, including defects that are not yet fixed (§6.5 of Volume 1). Keep the papers within GRCEye engineering until those items are closed. Share them with partner engineers only after that.

**Precedence.** The papers were written in parallel from a shared baseline (Volume 1, Appendix C.1). Where a paper differs from the cross-cutting decisions X-01–X-18 (Volume 1, §7.2) or from Volume 3, the volumes prevail. Examples:
- MinIO, Caddy or SQLite fallbacks;
- generic "KMS or HSM" keys;
- the `legacy-builtin` pack name;
- ADR numbering: the volumes renumber ADRs as ADR-CNT/COR/INV/CTM/MSP/ENT/PLT-nn, with a mapping in Volume 1, §16.2.
