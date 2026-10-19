# NCA DCC-1:2022 — extraction report (`nca-dcc-1-2022`)

## Sources
| lang | file | URL | sha256 |
|---|---|---|---|
| EN | src/dcc-en.pdf (28 pp) | https://cdn.nca.gov.sa/api/files/public/upload/1c2cfb9c-7788-4549-9f29-f337500f1787_Data-Cybersecurity-Controls-.pdf | 5eded079ed63e2fffffed9f5165e9de52f9a51e8cab588794472b6b4f55de43a |
| AR | src/dcc-ar.pdf (27 pp) | https://cdn.nca.gov.sa/api/files/public/upload/32bf3911-3c6d-4802-af66-773c2174aee5_DCC-.pdf | 5256fc8adb86eb9983146d1b83712ba6c889d5ae179e4c8c040b36aa46b182d0 |
| AR+EN | src/dcc-tool.xlsx (NCA DCC Assessment & Compliance Tool, sheet "حالة الالتزام بالضوابط ") | official NCA tool | 4d7e68dd3bb6063632b84d6744d611626d97d7c3f0e2f15d62e8da9ce3525949 |

No third-party mirrors used.

### Extraction routes
- **Control clauses (EN + AR)**: taken from the xlsx (clean Unicode, AR clause + blank line + EN clause per row), then
  cross-checked against the PDFs:
  - EN: the EN PDF has no usable text layer for the tables → OCR (tesseract -l eng, 300 dpi, psm 4) of pp. 11–19;
    every clause was aligned token-by-token against the OCR (script `work/dcc/cmp_en3.py`); remaining differences were
    resolved by looking at the page renders. Only 1 real difference found (see repairs).
  - AR: AR PDF text layer is readable but drops ligature glyphs (السيبرا→السيبراني, ض ن→ضمان, ح ية→حماية, أد→أدنى,
    غ→غير …). Word-level comparison xlsx vs `pdftotext -raw` + **visual read of every control table on AR pp. 11–18**
    (crops at 300 dpi). 5 differences found, PDF (binding) wording used.
- **Subdomain titles + Objectives**: EN typed from EN page renders (pp. 11–18) and confirmed by OCR alignment (0 mismatches);
  AR read from AR page renders (pp. 11, 13, 14, 15, 17) using the text layer as a base with ligature drops repaired.
- **Applicability**: read visually from the "Data Classification Level" columns of the EN tables (pp. 11–19) and
  re-checked against the AR tables (pp. 11–18) — all identical.
- **framework.description**: Executive Summary, EN p. 5 / AR p. 5 (verbatim sentence "In order to reach a secure and reliable Saudi cyberspace …").

## Counts
| level | extracted | official (EN p. 6 Introduction; AR p. 6 المقدمة) |
|---|---|---|
| domain | 3 | 3 Main Domains |
| subdomain | 11 | 11 Subdomains |
| control | 19 | 19 Main Controls |
| subcontrol | 47 | 47 Subcontrols |
Total 80 rows. All match. (Appendix A also states 9 extended + 2 new subdomains = 11.)

## EN↔AR pairing
80/80 rows have both EN and AR title; all 66 controls/subcontrols and 11 subdomains have both EN and AR description.
**Null fields** (all expected):
- `guidance`/`guidance_ar`: null everywhere (DCC has no guidance text in the controls document).
- domains: `description`, `description_ar`, `applicability`, `parent_id` null.
- subdomains: `applicability` null.
- `applicability` null for the 11 main controls whose table row is only a header row for their subcontrols:
  1-2-1, 1-3-1, 2-1-1, 2-2-1, 2-3-1, 2-4-1, 2-5-1, 2-6-1, 2-7-3, 3-1-1, 3-1-2 (levels are marked per subcontrol;
  2-7-3 and 3-1-2 have explicitly blank level cells).
No text field is null.

## Applicability encoding
The document marks every control per data-classification level with 4 columns — EN: **Public / Confidential / Secret / Top Secret**;
AR: **عام / مقيد / سري / سري للغاية** (so EN "Confidential" = AR "مقيد" = "Restricted"). Encoding in `applicability` (EN labels):
- `"Secret, Top Secret"` = checkmarks in those columns.
- `"Public, Confidential: At least every 2 years; Secret, Top Secret: At least annually"` = a text cell spanning those columns (verbatim EN cell text).
- 2-3-1-2: `"Public, Confidential; Secret, Top Secret: Use of BYOD devices is prohibited"` = ticks for Public+Confidential, text cell for Secret+Top Secret.
- 1-1-1: one cell spanning all four levels "At least annually".

## Refs (official only)
- 11 control-level refs to `nca-ecc-1-2018`, basis "control text" ("With reference to ECC control …" / "In addition to the subcontrols in ECC control …"):
  1-1-1→1-8-1, 1-1-2→1-8-2, 1-2-1→1-9-3, 1-3-1→1-10-3, 2-1-1→2-2-3, 2-1-3→2-2-3-5, 2-2-1→2-3-3, 2-3-1→2-6-3, 2-4-1→2-7-3, 2-5-1→2-8-3, 3-1-1→4-1 (ECC subdomain).
- 9 subdomain-level refs, basis "Appendix A (Figure 5: ECC and DCC Subdomains)": Figure 5 draws each DCC subdomain inside the ECC-1 subdomain
  cell of the same name. Figure 5 shows names, not IDs; the ECC-1 IDs (1-8, 1-9, 1-10, 2-2, 2-3, 2-6, 2-7, 2-8, 4-1) were assigned from
  the ECC-1 subdomain names and are consistent with the control-text refs above. 2-6 and 2-7 are marked "New Subdomain" → no ref.
- 3-1-2 says "in addition to the applicable controls in ECC and controls within DCC domain (1), (2), and (3)" — generic, no specific ID → not recorded.

## Artifact repairs applied
1. Whitespace: collapsed line breaks / double spaces / trailing spaces in xlsx cells (e.g. 2-6-1-4 "or   erasure").
2. Removed Arabic tatweel U+0640 (justification kashida in both PDF and xlsx, e.g. "التشــــــفير" → "التشفير", "المســح").
3. AR PDF ligature/glyph drops repaired in objectives/titles (السيبرا→السيبراني, ض ن→ضمان, ح ية→حماية, الأع ل→الأعمال, غ→غير, ا في ذلك→بما في ذلك, سؤولياتهم→بمسؤولياتهم, العامل→العاملين, ُ كن→يُمكن), each confirmed on the page render.
4. Quote normalisation in AR 3-1 objective: source mixes `"Outsourcing"والخدمات` (no space) and `"Managed Services“`; output uses straight quotes with normal spacing.
5. title_ar of subdomains/domains: the AR doc prints the EN name in parentheses after the AR title, e.g. "المراجعة والتدقيق الدوري للأمن السيبراني (Periodical Cybersecurity Review and Audit)"; the parenthetical EN was dropped from title_ar.
6. Subcontrol IDs digit-reversed in the xlsx (e.g. "1-1-4-2" for 2-4-1-1, "8-2-1-3" for 3-1-2-8) normalised; Arabic-Indic → Western digits for IDs only (digits inside AR clause text kept as printed).

### xlsx vs official PDF differences (PDF wording used)
| id | xlsx | PDF (used) |
|---|---|---|
| 2-5-1-2 AR | وفقًا للمستوى **المتوسط** (Moderate) … (NCS – 1:2020) | وفقًا للمستوى **الأساسي** (Moderate) … (NCS – 1:2020). — AR p. 15 |
| 2-4-1-3 AR | … (Data Scrambling)**>** | … (Data Scrambling). — AR p. 14 |
| 2-4-1-4 AR | من الانتحال(Brand Protection) | من الانتحال (Brand Protection). — AR p. 14 |
| 2-1-1 AR | بحد أدنى، ما يلي | بحد أدنى، ما يلي: — AR p. 13 |
| 2-7-3-3 AR | لا تقل عن 12 شهرًا | لا تقل عن ١٢ شهرًا — AR p. 16 |
| 3-1-2-1 EN | … who have access to the data. | … who have access to the data (no full stop in EN p. 19) |

## Spot-check (re-verified against page renders, EN page / AR page)
- 1-1-2 (EN 11 / AR 11): "With reference to ECC control 1-8-2, cybersecurity review and audit must be conducted periodically by independent parties outside the organization’s cybersecurity function as specified for each data classification level." / "رجوعًا للضابط ١-٨-٢ في الضوابط الأساسية للأمن السيبراني، فإنه يجب أن تتم مراجعة تطبيق ضوابط الأمن السيبراني للبيانات من قبل أطراف مستقلة عن الإدارة المعنية بالأمن السيبراني من داخل الجهة حسب المدة المحددة لكل مستوى." — Public, Confidential: At least every 2 years; Secret, Top Secret: At least annually
- 1-2-1-2 (EN 11–12 / AR 11): "A signed agreement by personnel pledging to not use social media, … approved by relevant authorities." / "تعهد العاملين في الجهة بعدم استخدام تطبيقات التراسل أو التواصل الإجتماعي … من الجهات ذات العلاقة." — Confidential, Secret, Top Secret
- 1-3-1-5 (EN 12 / AR 12): "Procedures for secure data disposal." / "إجراءات الإتلاف الآمن للبيانات." — Confidential, Secret, Top Secret
- 2-1-1-1 (EN 13 / AR 13): "Strict restriction to allow only the minimum number of personnel … approved by the Authorizing Official." / "التقييد الحازم بالسماح للحد الأدنى من العاملين … من قبل صاحب الصلاحية." — Secret, Top Secret
- 2-2-1-1 (EN 13 / AR 13): "Applying security patches and updates from the time of announcement …" / "تطبيق حزم التحديثات، والإصلاحات الأمنية من وقت إطلاقها …" — Public, Confidential: At least every month; Secret, Top Secret: Immediately
- 2-3-1-2 (EN 14 / AR 14): "Centrally managing BYOD devices using Mobile Device Management (MDM) system and activating the remote wipe feature." / "إدارة أجهزة (BYOD) مركزيًا باستخدام نظام إدارة الأجهزة المحمولة (Mobile Device Management – MDM) وتفعيل خاصية الحذف عن بعد." — Public, Confidential; Secret, Top Secret: Use of BYOD devices is prohibited
- 2-4-1-3 (EN 15 / AR 14): "Prohibiting the use of data in any environment other than the production environment, …" / "حظر استخدام البيانات في أي بيئة غير بيئة الإنتاج (Production Environment) …" — Confidential, Secret, Top Secret
- 2-5-1-2 (EN 16 / AR 15): "… as per the requirements of the “moderate level” in the National Cryptographic Standards (NCS-1:2020)." / "… وفقًا للمستوى الأساسي (Moderate) ضمن المعايير الوطنية للتشفير (NCS – 1:2020)." — Confidential
- 2-7-3-3 (EN 17 / AR 16): "Securely retaining (for a period not less than 12 months) logs of printers, scanners and copy machines usage." / "الاحتفاظ بطريقة آمنة بسجل الكتروني … لفترة لا تقل عن ١٢ شهرًا." — Secret, Top Secret
- 3-1-2-8 (EN 19 / AR 18): "Preventing carrying out of devices, storage media and documents outside the closed room, as well as the entry of any other electronic devices." / "منع خروج الأجهزة ووحدات التخزين والوثائق من القاعة المغلقة، ومنع إدخال أي أجهزة إلكترونية للقاعة." — Secret, Top Secret
(In fact every control table page, EN 11–19 and AR 11–18, was viewed.)

## Doubts
- Classification levels: the task brief said "Top Secret / Secret / Restricted"; the document actually uses **four** levels
  (Public/Confidential/Secret/Top Secret = عام/مقيد/سري/سري للغاية) and several controls apply to Public too. Recorded as printed (EN labels).
- 2-5-1-2: the AR PDF says "المستوى الأساسي (Moderate)" while the NCA xlsx says "المستوى المتوسط (Moderate)". Used the PDF (binding document). Worth a human glance.
- Subdomain refs from Appendix A rely on matching ECC-1 subdomain *names* in Figure 5 to ECC-1 IDs (the figure has no ECC IDs). Drop them if only ID-explicit refs are wanted.
- Domain 3 is titled "Third-Party and Cloud Computing Cybersecurity" but DCC defines only subdomain 3-1 (Third-Party); there is no cloud subdomain — this is how the document is, not a gap.
- EN apostrophes are kept as in the xlsx (’ mostly, one ' in 2-4-1-4 "organization's"), matching the PDF renders.
- AR objective of 1-1 keeps "تنظيمياً" (tanween on alef) and other spellings exactly as printed (e.g. "الإجتماعي", "إعتماد", "الآت التصوير" in 2-7-3-x) — these are the regulator's own spellings, not repaired.
