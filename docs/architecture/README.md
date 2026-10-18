# NG-GRC Reference Architecture

The architecture of GRCEye as it is today, and of NG-GRC: the platform built from it to deliver BM-01's "Path C". NG-GRC joins the GRC core, the inventory collector and the CTEM connection in one data model, for the KSA market first.

**Start with Volume 1, chapter 1 (executive summary).**

| File | For | Contents |
|---|---|---|
| [NG-GRC_Vol1_Decision_Dossier.md](NG-GRC_Vol1_Decision_Dossier.md) | Technical Committee | Executive summary; context and method; scorecard against BM-01 R1–R8; comparison with Paths A and B; target overview and principles; roadmap; decisions, risks and open questions; glossary |
| [NG-GRC_Vol2_GRCEye_Today.md](NG-GRC_Vol2_GRCEye_Today.md) | Engineering | GRCEye today: platform, functional modules, cross-cutting architecture, technical debt; full module inventory; framework catalogue |
| [NG-GRC_Vol3_Target_Architecture.md](NG-GRC_Vol3_Target_Architecture.md) | Engineering | Target block designs: GRC core (KSA content, core completion, Arabic), inventory collector, CTEM connection, MSSP and white-label, enterprise base, platform foundations; target data model |
| [pdf/](pdf/) | Everyone | The three volumes as PDF (A4, clickable contents and bookmarks) |
| [designs/](designs/) | Engineering | The seven detailed design papers behind Volume 3 |

**Why three volumes:**
- **Volume 1** is the decision record for the committee.
- **Volume 2** is the reference on today's code; it changes when the code changes.
- **Volume 3** is the build specification; it changes as P0–P3 proceed.

Chapter numbers run across all three volumes, so a reference such as §9.7 works from any volume.

**Before relying on this document:**
- **Status:** version 1.0, draft for the Technical Committee, 16 October 2026. Based on commit `98020b3`.
- **Owner:** the assessment was performed by AI agents (Volume 1, §2.4). A named GRCEye technical lead must validate and own its conclusions; fill in the "[name, role]" placeholders.
- **Classification:** Confidential, for Technical Committee members and GRCEye engineering only. Section 6.5 and Part II describe live-service weaknesses that are not yet fixed.
- **Evidence pack:** code-level evidence (file:line findings, including security issues) is kept outside this repository, in GRCEye engineering's internal evidence pack.
- **Diagrams:** written in Mermaid. They render on GitHub; in VS Code, install a Mermaid preview extension such as "Markdown Preview Mermaid Support".
