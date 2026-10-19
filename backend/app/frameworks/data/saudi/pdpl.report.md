# sdaia-pdpl: extraction report

Personal Data Protection Law (نظام حماية البيانات الشخصية), Royal Decree M/19 (9/2/1443H), as amended by Royal Decree M/148 (5/9/1444H). This is the consolidated current text. It covers the law only, not the Implementing Regulations.

## Sources (all under SCRATCH/src/pdpl/)
| lang | file | URL | sha256 | role |
|---|---|---|---|---|
| en | pdpl-en-sdaia-2023.pdf | https://sdaia.gov.sa/en/SDAIA/about/Documents/Personal%20Data%20English%20V2-23April2023-%20Reviewed-.pdf | f832f302…b0790c | **EN text source** (pdftotext text layer; Word-generated, clean) |
| en | pdpl-en-sdaia-2025.pdf | https://sdaia.gov.sa/en/SDAIA/about/Documents/PersonalDataProtectionLaw.pdf | f8e499d3…f55af | The current link on SDAIA's DataProtection page (a 2025 re-layout). Its text layer was diffed against the 2023 file. After removing artifacts (the "Public" footer and bullet glyphs extracted as "!" or "\"#") all 43 articles are identical. |
| ar | uqn-18347.html | https://www.uqn.gov.sa/details?p=18347 | 65dbc961…942f7e | Umm Al-Qura official gazette: **original** law text (M/19, published 1443-2-17) |
| ar | uqn-21670.html | https://www.uqn.gov.sa/details?p=21670 | 4594ba25…cbb82 | Umm Al-Qura: **"تعديلات نظام حماية البيانات الشخصية"**, the 27 amendment items approved by M/148 (published 1444-9-16) |
| ar | uqn-21671.html | https://www.uqn.gov.sa/details?p=21671 | 48b843b3…8c8084 | Royal Decree M/148 itself (provenance only) |
| ar | pdpl-ar-sdaia-2025.pdf | https://sdaia.gov.sa/ar/SDAIA/about/Documents/PersonalDataProtectionLawAr.pdf | 0bb6d1eb…a1cf | SDAIA **consolidated** Arabic text. Its fonts have no ToUnicode map, so the text layer is gibberish. Used only as a cross-check, through tesseract `ara` OCR at 300 dpi plus visual page renders. |

The full sha256 values are in `pdpl.json` → `framework.sources`.

**Arabic route:** the AR text = the gazette's original text with the gazette's 27 amendment items applied by script (`work/pdpl/consolidate.py`). Every amended passage is copied verbatim from the amendment publication. The result was then compared word by word against OCR of SDAIA's consolidated PDF (`work/pdpl/cmp.py`), and every non-OCR-noise difference was checked against the page images.

**BOE (laws.boe.gov.sa) could not be used.** It refuses TCP connections from this host and from WebFetch. As a result, no BOE consolidated text or BOE English text was used.

## Counts
- 43 controls, all `level: "article"`, with `control_id` from Art-1 to Art-43 and `parent_id` null.
- The law has **no chapters** in any official version (EN or AR), so no chapter parents were created.
- The document states no totals of its own. The numbering 1–43 is continuous. Art. 32 was repealed by M/148: its description is "Repealed." in EN and "مُلغاة." in AR, both wordings taken from SDAIA's consolidated texts. The gazette amendment says only "إلغاء المادة (الثانية والثلاثين)".
- EN↔AR: all 43 articles have both languages. **No null title or description fields.** `framework.description`/`description_ar` are null because the law has no purpose/objective clause. `guidance`, `domain` and `applicability` are null for every article. `refs` is empty everywhere because the law contains no official mappings.
- Titles: "Article N" / "المادة <ordinal>". Each Arabic ordinal is the one the gazette prints as the heading.
- Art. 1 (definitions) is included verbatim.

## Amended version check
All 27 M/148 items are reflected in both languages:
- definitions 7, 8, 11 and 16
- the full replacement of Arts 4, 8, 10, 12, 15, 20, 29, 30, 33, 35, 37, 42 and 43
- Art 5 «صريحة» and Art 24 «الصريحة»
- the new Art 6(4)
- Arts 9(1), 11(4), 13 (preamble and para 1), 16 (preamble), 18(1) and 36(2)
- the repeal of Art 32

The EN text matches throughout, for example: Art 29 lists purposes A–D and conditions; Art 35 gives 2 years / SAR 3M; Arts 42 and 43 say "seven hundred and twenty" days.

## Artifact repairs applied
- EN: re-joined wrapped lines into one line per numbered paragraph or sub-item (`1-`, `a)`, `A.`). Stripped form feeds. Kept paragraph numbering exactly as printed, including the inconsistent spacing ("1-Law", "1- The Controller").
- AR: converted HTML `<br>`/`<strong>` to text, with one line per numbered paragraph. Two characters were Farsi yeh (ی, U+06CC) and were normalised to ي. "أ - " was normalised to "أ- ".
- AR: in Art 1 def. 5, the gazette breaks "ومن ذلك:\nعمليات الجمع…" across two lines. These were re-joined into one paragraph, matching SDAIA's layout.
- AR amendments: removed the « » quote marks that wrap the amended text in the amendment publication. In definition 11, removed a stray inner « ("البيانات الحساسة: «كل بيان"). The amendment for definition 16 cites "الفقرة (61)", which is a digit-reversal typo for 16. Article-level texts got their final period, which the gazette places outside the closing quote.

## Doubts / known divergences (please read)
Comparing the gazette consolidation with SDAIA's consolidated Arabic PDF shows a few wording variants. I kept the **gazette** wording, because the Official Gazette is the authoritative publication. SDAIA's PDF reads:
1. **Art 13 preamble:** "…بالعناصر الآتية **عند البدء في** جمع بياناته". The gazette amendment reads "عند جمع بياناته" (page 7 render).
2. **Art 10 opening:** "ولا **تجوز** كذلك مُعالجة". The gazette has "ولا يجوز". In **10(7)**, SDAIA has "إذا كان جمع البيانات أو معالجتها" with no "الشخصية" (page 6 render).
3. **Art 36(1):** "حتى لو ترتب عليها **تجاوز** الحد". The gazette's original text has "بتجاوز", which looks like a gazette typo (page 14 render).
4. **Art 36(2):** "ويكون **من بينهم** مختص فني". The gazette amendment has "ويكون منهم" (page 14 render).
5. Throughout, SDAIA's PDF adds diacritics (يُقصد، تُجرى، سواء for سواءً, etc.) and occasional commas, e.g. Art 1 def. 5 "والتعديل، والتحديث". The gazette text has fewer of these. None of these change the meaning.

If the reviewer prefers the SDAIA consolidated reading (the regulator's own consolidation), items 1–4 are the only substantive word changes needed. A BOE consolidated text could settle them, but BOE was unreachable from here.
- EN is SDAIA's official translation. Arabic is binding (`binding_language: "ar"`).
- Translator typos in the EN were kept verbatim, e.g. Art 29(1)C ends without a period, and Art 42 says "before issuing the Law".

## Spot-check (re-verified against page renders)
- **AR**, SDAIA PDF at 300 dpi, viewed with Read:
  - p2: Art 1 defs 1–11
  - p3: defs 12–19, Arts 2, 3
  - p6: Arts 10, 11
  - p7: Arts 12, 13, 14, 15(1–3)
  - p12: Arts 29(2)–(4), 30(1)–(4c)
  - p13: Arts 30(4d)–(5), 31, 32 (مُلغاة), 33(1)–(3)
  - p14: Arts 33(4), 34, 35, 36(1)–(2)

  All match the output apart from the variants listed above.
- **EN**, SDAIA 2025 PDF p13 at 110 dpi: Arts 32 (Repealed.), 33, 34, 35(1)–(2) match.
- OCR word-diff covering all 43 AR articles: 19 articles are identical after normalisation. Every other residual difference is OCR noise (stray ء, the SDAIA footer, dropped lines at page breaks), except the variants listed under Doubts.
