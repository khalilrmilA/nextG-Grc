# OTCC-1:2022 extraction report (`nca-otcc-1-2022`)

## Sources
| File | URL | sha256 | Used for |
|---|---|---|---|
| src/otcc-en.pdf (45 p.) | https://www.nca.gov.sa/otcc_en.pdf | 8c1e76719466bfc7d52ef4b0ff34cfcbb76a8995431d481aeca4e7a6e776808a | EN text (`pdftotext -layout`), L1/L2/L3 tick marks (rendered pages at 144 dpi, pixel detection per table row) |
| src/otcc-ar.pdf (46 p.) | https://www.nca.gov.sa/otcc_ar.pdf | df1c2fb0c8a3a5e36d3a3bd44230279bf90de6dc207f32c408f48322cdf14e2e | AR text (binding). `pdftotext -layout`, glyph repair, see below |
| src/otcc-tool.xlsx | NCA OTCC Assessment & Compliance Tool (provided) | e58dd7f3029182df85cbb8cb452e6c573f05f9517724526bac2acb5784107410 | Sheet "حالة الالتزام بالضوابط للمرفق 1": control levels, and correct Arabic spelling/digit order used to repair PDF glyph bugs |
| src/otcc/mapping-en.pdf (28 p.) | https://cdn.nca.gov.sa/api/files/public/upload/071d52fc-…_Operational-Technology-Cybersecurity-Controls-Methodogy-and-Mapping-Annex.pdf | a31156fa7b0545378d8de1d6e12e70ba8d1571a170d44b4ee1462f5956f348cc | Mapping Annex (OTCCMM-1:2022), Table 1 (ECC Domain 5 → OTCC) |
| src/otcc/mapping-ar.pdf (32 p.) | https://cdn.nca.gov.sa/api/files/public/upload/6e58f002-…_ملحق-المنهجية-والمواءمة-….pdf | 8606f182b93080212ddd4200043e32eead0af4b271d56ac75afd5dd3aea8308f | Cross-check of Table 1 (AR) |

Only official NCA files were used. No third-party mirror.

## Counts
| Level | Output | Official (EN p.9 / AR p.7) |
|---|---|---|
| domain | 4 | 4 main domains |
| subdomain | 23 | 23 subdomains |
| control | 47 | 47 main controls |
| subcontrol | 122 | 122 subcontrols |

All of them match. The xlsx also has 169 rows (47 + 122), with the same IDs.

**Per-level totals do not match the document.** EN Table 1 (p.12) gives L1 = 151, L2 = 117 and L3 = 56 "controls and sub-controls". I counted the 150 leaf requirements: the 28 main controls without subcontrols plus the 122 subcontrols. From the official ticks this gives L1 = 150, L2 = 120 and L3 = 60. The PDF tick marks and the xlsx levels agree on all 148 leaves that have ticks, so the gap is in the document's own totals. The 2 leaves without ticks are 2-9-1-3 and 2-10-1-3, which show periods in months instead. I could not reproduce 151/117/56 under any counting rule.

## Applicability (facility level)
- Each control and subcontrol has a tag: `L1, L2, L3`, `L1, L2` or `L1`.
- This comes from the xlsx "Control Level" column. A value of 3 means all levels, 2 means L1+L2, and 1 means L1 only. The annex (p.17) says L1 facilities implement everything, L2 facilities implement L2+L3, and L3 facilities implement L3.
- I checked this against the ✓ marks in the EN PDF table on every leaf row (pixel detection), and it agreed 148/148.
- For main controls that have subcontrols, the PDF puts the intro text and the first subcontrol on one row. The xlsx main-control level is used for them.
- 2-9-1-3 and 2-10-1-3 apply at every level, with a different frequency per level. Their tag is `L1, L2, L3 (periodicity: L1 every 3 months; L2 every 6 months; L3 every 12 months)`. The PDF prints "3 / 6 / 12 Months" in the L1/L2/L3 cells.
- Distribution: 75 at L1-L3, 62 at L1-L2, 30 at L1 only, and 2 with periodicity.
- Domains and subdomains have `applicability: null`.

## Refs (111 refs on 81 controls, all `nca-ecc-1-2018`)
- **Control text** ("With reference to ECC control …", "In addition to subcontrols in ECC control …", "ECC subdomain 1-4"). I extracted these from the EN text, and they are identical to the IDs in the AR text for all 169 controls. Subdomain-level refs (for example `1-4`, `2-1`) are kept as stated.
- **Mapping Annex, Table 1** ("Relationship Between OTCC and ECC Domain 5"). Each row is turned around and recorded on the OTCC control as `{framework: nca-ecc-1-2018, control: 5-x-x(-x)}`.
  - ECC 5-1-3 is mapped to "-", so it gets no ref.
  - **Doubt:** for ECC 5-1-3-3, both the EN and AR annex list "2-11-1, 2-11-3". **OTCC 2-11-3 does not exist**, so only 2-11-1 got the ref.
- **Not recorded:**
  - The annex's international mapping tables (C2M2, NERC CIP, NOG 104, NIST, IEC 62443). Those frameworks are not in the short-name list.
  - The CSCC statement (annex p.12). It only covers the scope split and gives no control IDs.
  - Figure 2 of the annex (ECC↔OTCC subdomain relationship). It is a colour-coded figure with no IDs.
  - The reference to NCA's NCS-1:2020 in 2-7-1. It is not in the short-name list.

## EN↔AR pairing / nulls
- All 198 items have EN and AR for both title and description (domains have a null description by design).
- **Null fields: none.** guidance and guidance_ar are null throughout, because the controls document has no guidance.
- Only one clause is longer than 480 characters (2-2-1-7). Its title is truncated with "…", and the description holds the full text.

## Repairs applied
**EN** (`pdftotext -layout`):
- Removed page headers and footers, the "Controls / Control level / L1 L2 L3" header rows and the "3 6 12 / Months Months Months" cell text.
- Re-joined line breaks. A hyphen was removed only when the joined word exists in the document or xlsx vocabulary.
- Re-joined IDs split across lines ("4-1-\n3"), and removed a duplicated hyperlink overlay ("1-10-3 1-10-3").
- **Glyphs missing from the printed PDF.** The renders also show a gap, and the xlsx EN text confirms the word:
  - 1-2-1 "requir ments" → requirements
  - 1-8-1 "cybers curity" → cybersecurity
  - 2-2-2 "env ronment" → environment
  - 1-4 objective "met odology" → methodology
  - 1-3-1-7 "defined-period" (hyphen at a line break) → "defined period", as in the xlsx
- **Subdomain 1-8 title.** The table header on EN p.21 wrongly repeats "Cybersecurity in Human Resources". I used "Cybersecurity Awareness and Training Program", which is the name in the same document's Figure 2, the AR doc and the xlsx.
- Other EN subdomain titles are as printed in the control tables. Some differ slightly from Figure 2:
  - "Networks Security Management"
  - "Vulnerabilities Management"
  - "Mobile Devices Security"
  - "System and Processing Facilities Protection"
  - 3-1: "Cybersecurity Resilience Aspects…"
- Remaining wording differences from the xlsx EN are kept as the PDF prints them: "(OTCC-1:2022)" against the xlsx "(OTCC-1: 2022)", and "its implementation" in 2-2-2.

**AR** (binding text):
- The AR PDF fonts emit ligatures in reversed or lossy Unicode, for example:
  - السيرباين→السيبراني, ضامن→ضمان, يف→في, عىل→على
  - األمن→الأمن, املخاطر→المخاطر, مبا→بما, غري→غير
- Some ligatures drop a letter entirely: والتحصـن→والتحصين, التغيـر→التغيير, عـى→على, ضـان→ضمان, لفـرة→لفترة. I confirmed these on the render of AR p.23/26.
- **Control clauses:** I aligned the PDF word stream with the xlsx Arabic text, using letter-multiset keys per word. Each PDF word was replaced by its aligned xlsx spelling, which has the same letters in the correct order. Words with no match kept the PDF form, with these manual repairs: وعرب→وعبر, االعتيادي→الاعتيادي, االنتهاء→الانتهاء, االحداث→الاحداث, واملحيط→والمحيط, األقل→الأقل, ييل→يلي.
- **Where the xlsx wording differs from the PDF, the PDF wins:**
  - 1-3-1-5: إجراءاتها
  - 1-6-2: مرة
  - 2-3-1: ما يلي
  - 2-3-1-5: الاعتيادي
  - 2-4-1-4: order of Wi-Fi, Bluetooth, Cellular, Satellite
  - 2-6-1-3: الآمنة/الإعدادات/الانتهاء
  - 2-8-1-2: الإعدادات
  - 2-11-1-5 and 2-12-1-5: الصناعي
  - 2-11-1-7 and 2-11-1-9: الاحداث (printed without hamza)
  - 4-1-2: "متطلبات الأمن السيبراني للأمن السيبراني للأطراف الخارجية، لبيئة أنظمة …", where the duplication is printed in the PDF
  - Tanween as printed
- **Latin terms in parentheses** were scrambled by the bidi extraction ("( )OT/ICS", "((Factory…", stray ”). These were rebuilt: the general rule moves leading punctuation to the end of an LTR run. Twelve controls were fixed by hand and checked on the renders: 1-4-1-2, 2-2-1-7, 2-3-1-2, 2-3-1-7, 2-4-1-3, 2-4-1-4, 2-4-1-10, 2-5-1-4, 2-6-1-2, 2-11-1-4, 2-12-1-1, 3-1-1-6.
- **ECC references inside AR text** use Arabic-Indic digits in logical (meaning) order, for example "رجوعاً للضابطين ١-٣-١ و ١-٣-٢". This matches the xlsx and the visual reading of the PDF. pdftotext gives these reversed and with Western digits.
- Kashida (tatweel), subcontrol ID prefixes and the level-cell text "٣ أشهر…" were removed.
- **Subdomain objectives, titles and domain names** are not in the xlsx. I repaired them by hand from the PDF extraction, using the same reversed-ligature classes, and read them against the page renders (AR pp.14, 16, 17, 23-28, 31, 32, 35).
  - Domain 1 is printed "حوكمة الامن السيبراني" (no hamza) and is kept as printed.
  - The AR titles of 2-3 ("حماية النظم ومرافق المعالجة") and 4-1 ("الأمن السيبراني المتعلق بالأطراف الخارجية") follow the PDF, not the xlsx variants.
- framework.description and description_ar are the "Objectives" paragraphs (EN p.9, AR p.7, render checked).

## Spot-check (re-verified on page renders)
| ID | AR page | EN check | Text OK | Level ticks OK |
|---|---|---|---|---|
| 1-1-2 | 14 | xlsx EN identical | ✓ | ✓ L1-3 |
| 1-3-1-5 | 16 | xlsx EN identical | ✓ | ✓ L1 |
| 1-4-1-4 | 17 | xlsx | ✓ | ✓ L1-2 |
| 2-2-1-4 | 22 | xlsx | ✓ | ✓ L1 |
| 2-3-1-10 | 24 | xlsx | ✓ | ✓ L1 |
| 2-4-1-6 | 25 | xlsx | ✓ | ✓ L1-3 |
| 2-4-1-14 | 26 | xlsx | ✓ | ✓ L1-3 |
| 2-5-1-3 | 27 | xlsx | ✓ | ✓ L1-2 |
| 2-11-1-10 | 31 | xlsx | ✓ | ✓ L1-3 |
| 2-12-1-7 | 32 | xlsx | ✓ | ✓ L1-2 |
| 3-1-1-5 | 35 | xlsx | ✓ | ✓ L1-3 |

EN renders were viewed for pp.17, 18, 21 and 24 (1-2-1, 1-4 objective, 1-8-1, 2-2-1-9 … 2-3-1-4), with ticks and text matching. Every EN clause matches the xlsx EN at ≥0.97 similarity, except the five repaired typos and the two kept differences listed above.

Example (2-4-1-6):
- EN: "Network communications, services, and connection points between different zones must be limited to the minimum to meet operational, maintenance, and safety requirements."
- AR: "تقييد استخدام اتصالات الشبكة، والخدمات، ونقاط الاتصال بين المناطق المختلفة (Zones) وحصرها على الحد الأدنى؛ لتلبية متطلبات التشغيل والصيانة والسلامة."

## Doubts
1. The per-level totals in the document (151/117/56) cannot be reproduced. The output total is 150/120/60.
2. The annex maps ECC 5-1-3-3 to OTCC "2-11-3", which does not exist. That target was dropped.
3. **AR subdomain objectives (23):** these are my manual glyph repair with no second machine source. Tesseract OCR was started but was too slow on the shared machine. I read each one against the renders, but residual errors are possible. This is especially so for hamza, where the PDF sometimes prints "الاحداث", "الأثار" or "الامن" without the expected hamza or madda, and I kept those as printed.
4. Minor spacing around Arabic punctuation (for example "وغيرها) ،", "السيبراني ، يجب") is kept as extracted.
5. The source URL of the xlsx tool is not recorded (it was provided in src/).
