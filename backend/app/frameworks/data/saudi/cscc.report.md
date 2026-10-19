# CSCC-1:2019 extraction report (`nca-cscc-1-2019`)

## Sources
| lang | URL | local file | sha256 | route |
|---|---|---|---|---|
| en | https://cdn.nca.gov.sa/api/files/public/upload/f15af01c-dc59-4281-95e2-03a770655937_Critical-Systems-Cybersecurity-Controls.pdf (same file as nca.gov.sa/cscc-en.pdf; `cscc-en-b.pdf` is byte-identical) | src/cscc-en.pdf | 0eb7b86d5bec6e120b0416d25d66d367fb06c4f7b98347eb9e1341b8c1d438c1 | `pdftotext -layout`. The text layer is clean; parsed with a script |
| ar | https://nca.gov.sa/cscc-ar.pdf (re-downloaded: byte-identical, and no newer AR PDF is linked on nca.gov.sa/ar/regulatory-documents/controls-list/cscc/) | src/cscc-ar.pdf | 96dcdf2e259f264a2ea33177fa9948457fdabdf2ac5e5d2f4b97f7b8b8875c0b | text layer has glyph-mapping bugs and jumbled reading order. Used for objectives (after repair) and as the reference for checking every control |
| ar | https://nca.gov.sa/CSCC_Assessment_and_Compliance_Tool_v2.0.xlsx (linked from the official AR CSCC page) | src/cscc/cscc-tool.xlsx | b355f612f55bd8611d4b1642fe61dade1223f83bde5c30424f38b6eb3c2b1152 | clean-Unicode Arabic for all 105 controls and subcontrols and for the domain/subdomain titles (sheet "حالة الالتزام بالضوابط - نظام ١") |

How the Arabic was built:
- **Control and subcontrol text (105 items):** taken from the NCA xlsx tool. Each item was aligned word by word against the AR PDF text layer, ignoring letter order inside a word to absorb the glyph bugs. 189 distinct PDF→xlsx word pairs were checked; every one is a known glyph artifact (for example السيرباين→السيبراني, عىل→على, يف→في, األمن→الأمن, حامية→حماية, قامئة→قائمة). No wording differences were left unexplained, apart from the xlsx defects listed below, which were corrected to the PDF.
- **Subdomain objectives and the framework description:** taken from the AR PDF text layer, repaired, then read against page renders on AR PDF pp. 7 and 14–24. A second automatic check matched them against the PDF word skeletons: 100%, except for 3 tokens that were verified visually.

## Counts
| level | extracted | stated by document |
|---|---|---|
| domain | 4 | 4 Main Domains |
| subdomain | 21 | 21 Subdomains |
| control | 32 | 32 Main Controls |
| subcontrol | 73 | 73 Subcontrols |

The totals are stated in the Introduction (EN p.12, AR p.7). Both match.

## EN↔AR pairing
- 130 of 130 items have both EN and AR titles. All 126 subdomains, controls and subcontrols have both EN and AR descriptions.
- **Null fields:** only `description`/`description_ar` on the 4 domains, because domains have no objective text in the document. `guidance`/`guidance_ar` and `applicability` are null everywhere, because the controls document contains none.
- Pairing is by ID. Some xlsx IDs were stored digit-reversed (for example `1-1-4-2` for 2-4-1-1). They were normalised and the order checked against the EN sequence.
- No clause exceeds 480 characters, so title equals description everywhere.

## Corrections of the xlsx toward the binding AR PDF (each verified on the page render)
- 1-3-1: xlsx "في جهة" → PDF "في الجهة" (p.14).
- 2-2-1-3 and 2-2-1-4: `"MFA"` → `«MFA»`. 2-4-1-8: scrambled `("Distrbuted … "DDoS)` → `(Distrbuted Denial of Service Attack «DDoS»)`. 2-11-1-3: → `(User Behavior Analytics «UBA»)`. 2-2-1-7: `((Service Account` → `(Service Account)`.
- Case per PDF: `(Firewall Rules)` (2-4-1-2) and `(Online and Offline Backup)` (2-8-1-1).

## Artifact repair classes applied
- EN: page headers and footers removed ("Sharing Indicator: White", "Document Classification: Open", page numbers, running title). The "Objective"/"Controls" column labels were removed. Line-wrapped text was re-joined, plus one hyphenation ("mini-mum" → "minimum", 2-12-2) and "processed/ managed" → "processed/managed" (4-2).
- AR: Unicode NFKC; removal of bidi control characters and tatweel; glyph-bug repair (lam-alef/hamza, swapped letter pairs, ى/ي ligatures, dropped glyphs in the tatweel-justified 2-5 objective); detached tanween and shadda re-attached (بنا ًء → بناءً, المق ّرة → المقرّة, وف ّعال → وفعّال); bidi comma placement (" ،X" → "، X"); bracket mirroring around embedded English. Whitespace inside parentheses was normalised.
- AR digits: kept as Arabic-Indic, as the PDF renders them (e.g. "٢-٣-١-٤"), written in logical order without the PDF's " - " spacing.
- AR titles: the English gloss in parentheses that follows each Arabic heading was stripped from `title_ar`, along with the "١- " prefix on domain names. EN titles are taken from the EN doc.

## Mappings (refs), 49 in total
- **Control text (29):** 28 explicit ECC-1:2018 citations ("In addition to … ECC control 2-2-3", "With reference to ECC subcontrol 2-9-3-3", etc.), recorded on the citing control as `nca-ecc-1-2018`. There is also 1 internal citation: 2-2-1-4 → CSCC 2-3-1-4 (`nca-cscc-1-2019`).
- **Appendix A (Figure 5), 20 refs at subdomain level:** Figure 5 overlays CSCC subdomain numbers on the ECC-1 subdomain boxes. It prints ECC subdomain **names**, not ECC IDs. I resolved each name to its ECC-1:2018 ID by exact name and position (1-1→1-1, 1-2→1-5, 1-3→1-6, 1-4→1-8, 1-5→1-9, 2-1→2-1, 2-2→2-2, 2-3→2-3, 2-4→2-5, 2-5→2-6, 2-6→2-7, 2-7→2-8, 2-8→2-9, 2-9→2-10, 2-10→2-11, 2-11→2-12, 2-12→2-15, 3-1→3-1, 4-1→4-1, 4-2→4-2). These match the control-text citations in every case.
  - 2-13 Application Security is the "new subdomain" in Figure 5 and has no ECC counterpart. The 9 ECC subdomains with no CSCC additions are 1-2, 1-3, 1-4, 1-7, 1-10, 2-4, 2-13, 2-14 and 5-1. This is consistent with the appendix text: "added to twenty subdomains", "no controls … for nine subdomains".
- Not recorded: 4-2-1-1 names NCA's "Cloud Cybersecurity Controls (CCC)" without any version or control ID. CSCC (2019) predates CCC-1:2020, and CCC-1:2020 is not in the short-name list.

## Spot-check (10 random controls, seed 7; EN and AR compared with page renders)
| ID | EN page | AR page |
|---|---|---|
| 2-4-1-2 | 24 | 18 |
| 2-1-1-2 | 22 | 16 |
| 2-5-1-1 | 24 | 18 |
| 2-12-1 | 27 | 22 |
| 1-3-1-2 | 20 | 14 |
| 1-3-2-2 | 21 | 15 |
| 2-9-1-1 | 26 | 20 |
| 1-4-1 | 21 | 15 |
| 2-4-1-7 | 24 | 18 |
| 2-10-1-2 | 26 | 21 |

All matched. In addition, every AR control page (pp. 14–24) and all 21 AR objectives were read against renders, as were EN pp. 24, 31 and 32.

## Doubts
- **The official texts contain typos, kept verbatim:**
  - AR 4-2-1 "للأمن السيراني" (missing ب; confirmed on AR p.24).
  - EN: "Prohibting" (2-5-1-1, 2-6-1-1, 2-6-1-5), "managmenet" (2-3-1-3), "Distrbuted" (AR 2-4-1-8), "To Ensure" (2-6).
- **EN and AR are not literal translations of each other.** For example, EN 1-5-1-2 says "experienced Saudi professionals" while AR says "مواطنون ذوو كفاءة عالية". Also, the English gloss on AR subdomain headings sometimes differs from the EN title: 1-3 "…Projects" vs "…Project Management", and 1-4 "Periodical Assessment and Audit" vs "Periodical Cybersecurity Review and Audit". Each language is kept as published.
- **The xlsx is tool v2.0, which may postdate the 2019 PDF.** Wherever it differed in wording, the PDF won. Its punctuation was accepted where the PDF text layer could not reliably show punctuation; the spot-checked pages showed no punctuation differences.
- **Appendix A refs depend on resolving names to ECC-1 IDs**, because Figure 5 shows no ECC IDs.
