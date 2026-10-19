# SAMA Cyber Security Framework v1.0 (May 2017) — extraction report

Output: `out/sama.json` (short_name `sama-csf-1-0`). Scripts: `work/sama/{split,build,xcheck,assemble}.py`.

## Sources
| lang | URL | file | sha256 | route |
|---|---|---|---|---|
| en | https://rulebook.sama.gov.sa/sites/default/files/en_net_file_store/SAMA_EN_3837_VER1.pdf ("Download Original PDF" on the rulebook) | src/sama/SAMA_EN_3837_VER1.pdf | ce68ce5a316350946746025619601245d3d26de08fbf4882ffdf1fa8ee088cb9 | Original issued PDF (Word 2013, created 2017-05-29, 56 p., "Version 1.0"). Used to check every EN string + page renders. |
| en | https://rulebook.sama.gov.sa/en/entiresection/3875 | src/sama/en_entiresection_3875.html | 15ee3547d954790a58d3ec09cbbc38b64ca5a96b2973c9e4bca817f22f9909ad | Section 3 "Control Domains" — primary EN structure + text (HTML tables, clean labels) |
| ar | https://rulebook.sama.gov.sa/ar/entiresection/3875 | src/sama/ar_entiresection_3875.html | 33792927fdc02e9da9683120d727d04bd3232af79246cba88d201cb9b57fc7c3 | Only AR source for all AR text |
| en | https://rulebook.sama.gov.sa/en/entiresection/3837 | src/sama/en_entiresection_3837.html | 05514ee7c8538c883e752fbf5e942da82bc1f4f3e38aa27164c595d100d63801 | 1.1 (framework.description), 1.4 (applicability) |
| ar | https://rulebook.sama.gov.sa/ar/entiresection/3837 | src/sama/ar_entiresection_3837.html | df6269089cd4adecc29b41fb2a23558534b4e3d5e50080391fc554c347edcbdb | same, AR |

Also saved (not used for text): single-node pages en/ar_node_{3837,3847,3915,3948,3951,5472,5888}.html.
sama.gov.sa itself timed out (HTTP 000). The rulebook's "AR original PDF" link (SAMA_AR_3837_VER1.pdf) is byte-identical to the EN PDF — **no Arabic PDF of the framework exists on the rulebook**. No third-party mirrors used.

## Governing language — IMPORTANT
- The **framework document itself was issued in English**. Every Arabic rulebook page of the framework carries: "هذه النسخة مترجمة و قد يطرأ عليها تعديلات لاحقا. يجب الاستناد على التعليمات الواردة في الوثيقة الأصلية" (this version is translated … rely on the original document).
- The "Arabic governs" statement ("This translation is provided for guidance. The governing text is the Arabic text") appears on the EN page of the **covering circular** (node 5888), not on the framework.
- Therefore `binding_language` = **"en"**. The AR text is SAMA's own official rulebook translation (verbatim), not a governing original.

## Structure / ID scheme
- Official numbering (Figure 1, PDF p.8): `3.3.12 – 4.a.6.a` = subdomain + control-consideration path (up to 4 levels). IDs use that with an ASCII hyphen: `3.1.1-3`, `3.1.1-3.a`, `3.3.13-4.b.6.g.1`. Hyphen also avoids the clash between 3.2.1's own considerations and its sub-subdomains 3.2.1.1–3.2.1.4.
- domain (3.1–3.4; description = domain intro paragraphs) → subdomain (description = **Principle**, guidance = **Objective**; 3.2.1.1–3.2.1.4 are level "subdomain" with parent 3.2.1) → level-1 consideration = "control" → deeper levels = "subcontrol".
- title = description = the clause's own text only (lead-in clauses like "…should include:" do not repeat their children). No clause > 480 chars.
- AR labels أ ب ج د هـ و ز ح ط ي ك ل mapped to a…l; AR headings' reversed numbers (e.g. "13.3.3") normalised. EN and AR trees are identical (same 530 IDs in same order, asserted).
- **3.3.12 Payment Systems** has no numbered considerations (official text = 2 bullets, the 2nd with 3 sub-bullets). Synthetic IDs **`3.3.12-b1`, `3.3.12-b2`** (not official); b2 contains the MADA lead-in + its 3 sub-bullets joined by newlines (AR flattens all 5 bullets, so split likewise).
- 3.4.3 Principle includes the italic note "Please note that this requirement is not applicable to private cloud services (= internal cloud)." as a second paragraph of description.
- `applicability` (EN only, verbatim from §1.4, present in the original PDF p.6) on 3.1.2, 3.2.3, 3.3.12, 3.3.13 (non-bank exceptions).
- Maturity model, intro, appendices: not included as controls.

## Counts
| level | count |
|---|---|
| domain | 4 |
| subdomain | 36 (31 + 3.2.1.1–3.2.1.4 … i.e. 7+5+4+17+3) |
| control | 149 |
| subcontrol | 341 |
| total | 530 |
Document states only "four main domains" (§2.1); no other totals. Independent check: the PDF's §3 text has 488 lines starting with a `N.`/`x.` label = 149+341 − 2 bullets of 3.3.12. ✔

## EN↔AR pairing & nulls
- 530/530 nodes have title + title_ar; all description/description_ar filled; subdomain guidance/guidance_ar (Objective) filled for all 36.
- Null by design only: `guidance`/`guidance_ar` on 4 domains, 149 controls, 341 subcontrols. No null text fields otherwise.
- `refs`: all empty. SAMA text cites PCI-DSS, EMV, SWIFT CSCF, SARIE, MADA (3.2.3, 3.3.12) — none are in the short-name list; no NCA mapping exists.

## Repairs applied
1. HTML → text: tags stripped, entities unescaped, `<br>&nbsp;` row terminators removed, whitespace collapsed. No Arabic presentation forms present (no NFKC needed).
2. EN text vs original PDF: every EN string (530 titles, descriptions, objectives) was checked as a whitespace-insensitive, case-sensitive substring of the PDF text. Only 4 mismatches; PDF (original) wording adopted:
   - 3.2.3 title: rulebook "Compliance with (Inter)national Industry Standards" → PDF "Compliance with (inter)national industry standards" (title_ar unchanged)
   - 3.3.4 principle: "which Outlines" → "which outlines"
   - 3.3.12-b2: "MADA" → "mada" (×2, as printed)
   - 3.3.14-4.l: rulebook "red- teaming" (line-break hyphen artifact) → "red-teaming" (verified on p.33 render)
3. AR: no repairs; verbatim from rulebook.

## Spot-check (10 random, seed 7) — EN verified on page renders
| id | page | EN | AR |
|---|---|---|---|
| 3.2.1.3-3.a | 21 ✔ | the consideration of predefined limits for levels of cyber security risk; | مراعاة الحدود المحددة مسبقًا لمستويات مخاطر الأمن السيبراني؛ |
| 3.4.3-4.g.3 | 38 ✔ | the Member Organization has the right to perform a cyber security examination at the cloud service provider; | يحق للمؤسسة المالية إجراء فحص الأمن السيبراني لدى مقدم الخدمة السحابية؛ |
| 3.1.4-4.a.4 | 16 ✔ | cyber security risk management process; | إجراءات إدارة مخاطر الأمن السيبراني؛ |
| 3.2.4-5.c | 23 ✔ | all agreed actions are being managed on an ongoing basis. | الإدارة المستمرة لكافة الإجراءات المتفق عليها. |
| 3.3.11-3 | 30 ✔ | The effectiveness of the secure disposal cyber security controls should be measured and periodically evaluated. | يجب قياس وتقييم فعالية ضوابط الأمن السيبراني للتخلص الآمن بشكل دوري. |
| 3.1.2-2.c | 14 ✔ | the Banking Sector's cyber security strategy. | استراتيجية الأمن السيبراني للقطاع المصرفي. |
| 3.1.3-4.a | 15 ✔ | a definition of cyber security; | تعريف الأمن السيبراني؛ |
| 3.3.15-7.i | 34 ✔ | description of impact (e.g., loss of data, … number of customers impacted); | وصف التأثير (على سبيل المثال، فقدان البيانات، … وعدد العملاء المتأثرين بالحادثة)؛ |
| 3.3.6-5.e | 27 (text-match only, page not viewed) | vulnerability and patch management; | إدارة الثغرات الأمنية وحزم التحديثات والإصلاحات؛ |
| 3.1.3-4.f.6 | 15 ✔ | compliance with regulatory and contractual obligations are being met; | الوفاء بالالتزامات التنظيمية والتعاقدية؛ |
Also viewed pp. 8, 13, 31, 33. AR could not be checked against a page render (no AR PDF exists); AR numbering/structure matches EN 1:1.

## Doubts
- AR is a translation (by SAMA, on its rulebook), labelled non-governing; minor gaps exist in it, kept verbatim, e.g. 3.3.3-2 AR "يجب وقياس وتقييم فعالية…" (verb "مراقبة" missing vs EN "monitored, measured"); 3.3.14-4.a AR drops the "(SOC)" abbreviation.
- Rulebook EN typographic quotes (’) differ from the PDF in a few places only in quote style; kept rulebook characters (curly apostrophes), whitespace/quote-insensitive match confirmed.
- `3.3.12-b1/b2` IDs are synthetic (no official numbers).
- name_ar = rulebook's title "الدليل التنظيمي لأمن المعلومات في القطاع المالي" (literally "Information Security Regulatory Guide…"), which is SAMA's official Arabic name, not a literal of "Cyber Security Framework".
- Later SAMA circulars (e.g. 2019 Maturity Level 4 requirements for banks, node 5472) are not merged; they don't change control text.
