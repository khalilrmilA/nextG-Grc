# ECC-2:2024 (nca-ecc-2-2024) extraction report

## Sources
| lang | URL | file | sha256 | use |
|---|---|---|---|---|
| en | https://cdn.nca.gov.sa/api/files/public/upload/86e09090-44e4-481f-bc28-355673607654_ECC--2024-EN.pdf | src/ecc2-en.pdf | 146505199e5374d99302fc3d7e1fdc73b6e2f3292fefd535d5dd891294a81db1 | all EN text. Extracted with `pdftotext -bbox-layout` from the text layer |
| ar | https://cdn.nca.gov.sa/api/files/public/upload/29a9e86a-595f-4af9-8db5-88715a458a14_ECC-2-2024---NCA.pdf | src/ecc2-ar-b.pdf | 66165b9ec3347efced2270540e0fd00a4246107a7b3aba6a5482c7db24671230 | all AR text. Text layer after the ToUnicode repair below |
| ar | (2nd copy) | src/ecc2-ar.pdf | e7140df6da4874923719e31fb4f0159e725b05284e35c488962a8cc969f8df7f | not used. Its body text is drawn as images |
| en | https://nca.gov.sa/ecc-en.pdf (ECC-1:2018, newly downloaded) | src/ecc2/ecc1-en.pdf | 1f982db6ad581b3acbdd5f265bc93d88459e82dba38d367bf36e2d48ba3a568f | used only to build and check `ecc1_to_ecc2_idmap` |

No third-party mirrors were used. No OCR was used.

### Extraction route
- **Table cells.** Pages were rendered with `pdftoppm` and the table's horizontal and vertical rules were detected from the pixels. Words (with bbox) were assigned to cells, so that ID / Objective / Controls labels are split from clause text. A cell that runs over a page break is merged.
- **Arabic ToUnicode repair (main repair).** In the AR PDF the AdobeArabic and AdobeArabic-Bold fonts map 16 ligature glyphs to U+0000. pdftotext therefore silently drops letters, for example "السيبرا" for السيبراني and "اعت د" for اعتماد.
  - I patched a scratch copy of the PDF (`work/ecc2/ar-fixed.pdf`, never the source) so that those glyph codes map to the matching Unicode presentation ligatures:
    763=ني, 756=ما, 764=ير, 766=ين, 620=بم, 762=نى, 765=يم, 750=لم, 615=ئم, 761=نم, 629=ثر, 625=تم, 663=كي, 627=تى, 628=تي, 618=ئي.
  - Each code was identified from 3–6 word contexts (for example السيبرا_ / الإلكترو_ → ني) and confirmed on page renders.
  - After the patch, every AR token is a real word. A token-level cross-check against pdftotext's own (patched) output found no unknown tokens except the 7 repaired diacritic words listed below.
- **Arabic visual → logical order.** The bbox words are in visual order. I rebuilt logical order with my own inverse-bidi step:
  - Latin and number runs are kept left-to-right.
  - Brackets at RTL level are mirrored.
  - Curly quotes: a closing ” is kept with the Latin run that it follows, and an opening “ with the run that it precedes.
  - The result was then NFKC-normalised.

## Counts
| level | extracted EN | extracted AR | stated by the document |
|---|---|---|---|
| main domains | 4 | 4 | 4 |
| subdomains | 28 | 28 | 28 |
| main controls | 108 | 108 | 108 |
| subcontrols | 92 | 92 | 92 |

The stated totals are in EN "Introduction" (printed p.7, PDF p.10) and AR "المقدمة" (PDF p.9).

All counts match exactly. The EN and AR ID sequences are identical, so pairing is by ID. 232 rows; all 228 non-domain rows have both languages.

## Null fields
- Every `title`, `title_ar`, `description` and `description_ar` of subdomains, controls and subcontrols is filled.
- `description` / `description_ar` of the 4 domain rows are null on purpose (no objective text exists).
- `guidance` is null everywhere and `applicability` is null everywhere.
- `refs = []` everywhere. ECC-2 control text cites no other framework's control IDs. 4-2-3 cites ECC's own domains, and 2-8-3 cites the "National Cryptographic Standards" without control IDs.
- Only 1 control is over 480 chars (4-2-3, EN). Its title is truncated with "…" and the full text is in `description`.

## Normalisations / artifact repairs applied
1. The ToUnicode ligature repair (above).
2. Line re-joining.
   - EN: a line that ends in "-" right after a letter is joined with no space ("non-" + "disclosure", "cyber-" + "attacks", "up-to-" + "date"). The doc has no auto-hyphenation, so these hyphens are real.
3. Page headers and footers dropped by y-position: TLP, "Document classification", page numbers, and the "مقيد - محدود" stamp.
4. Arabic presentation forms NFKC-normalised.
   - The isolated tashkeel forms (U+FC5E–FC63, FE70–FE7F) have their NFKC leading space removed.
   - Seven words whose diacritic glyph was a separate PDF word were re-attached and checked on renders: بناءً (×7), المقرّة, المعرّف, فعّال / وفعّال, قِبَل, التصيّد.
5. Word-internal kashida (tatweel U+0640) removed. It is justification stretching, e.g. التشـــريعية → التشريعية, بـاسم → باسم. The word-final tatweel in "هـ" (Hijri) is kept.
6. IDs normalised.
   - EN prints subcontrol IDs with dots ("1.5.3.1") and one subdomain as "1.7". All are emitted with hyphens ("1-5-3-1", "1-7"), the convention of the doc's own Figure 4 and of Appendix C.
   - AR Arabic-Indic digits are converted to Western digits in IDs only. Arabic-Indic digits are left untouched inside AR text (e.g. "١٢ شهر").
7. The Symbol-font bullet U+F0B7 was replaced by "•". This only occurs in `appendix_c_other_rows`.
8. Content kept verbatim (no repair applied):
   - AR subdomain titles from 2-1 onward and the AR domain headings include the English gloss in parentheses exactly as printed, e.g. "إدارة الأصول (Asset Management)".
   - Source typos are kept, e.g. the mismatched quotes in AR 2-2-3-3 (“Least Privilege") and "BYOD” in EN 2-6.

## Spot-check (re-verified against page renders)
Checked visually against renders of: AR PDF pp.15, 16, 20, 21, 22, 23, 26 and EN PDF pp.18, 30, 46. All 10 matched, word for word.

| id | EN (PDF page) | AR (PDF page) |
|---|---|---|
| 2-4-3 | p24 | p20 |
| 1-9-3-1 | p20 | p17 |
| 2-5-4 | p25 | p21 |
| 2-14-3-4 | p30 | p24 (cell continues from p23) |
| 1-5-1 | p18 | p16 |
| 1-5-3-4 | p18 | p16 |
| 2-11-2 | p28 | p22 |
| 1-6-3 | p19 | p16 |
| 2-5-3-2 | p24 | p20 |
| 2-12-3-5 | p29 | p23 |

## ECC-1 → ECC-2
- **`ecc1_to_ecc2`** — 20 control-level rows taken verbatim from Appendix (C), table 4, EN and AR. Each row has: ecc1, ecc2, change / change_ar, section, previous text, updated text, rationale, `in_en_appendix` / `in_ar_appendix`, and `ecc2_basis`.
  - Appendix "Section" numbers are ECC-1 numbers. For example, the "Control 1-7-2" modification has updated text identical to ECC-2 1-7-1.
  - `ecc2` for modification rows was resolved by matching the updated text against the ECC-2 controls; all matches are 1.00 except 2-8-3 at 0.72, where the appendix's EN updated text embeds the subcontrol list.
  - Additions: ecc1 = null (2-5-3-9). Deletions: ecc2 = null (1-7-1, 2-7-3, 4-2-3-3, main domain 5).
  - **The EN and AR appendices differ.** The AR appendix has three extra modification rows that the EN appendix lacks: 1-9-5, the objective of 2-8, and 2-10-3-4. These rows have EN fields null. The AR rationale of the 2-8 row is blank in the source.
- **`appendix_c_other_rows`** — the 14 non-control rows (scope, applicability, terms, abbreviations), verbatim.
  - The AR side of the "Terms and Definitions" rows contains bidi-scrambled English fragments, e.g. `"-One-Time "Password`. They are lower quality and not used by anything.
- **`ecc1_to_ecc2_idmap`** — 254 entries, one for every ECC-1 ID in the official ECC-1 EN document (5 domains / 29 subdomains / 114 controls / 105 subcontrols), plus the 2-5-3-9 addition. **Basis:**
  - From Appendix C: all deletions (1-7-1, 2-7-3 with its subcontrols 2-7-3-1..3, 4-2-3-3, all of domain 5, which moves to OTCC) and the modifications.
  - **Derived, not stated by NCA:** NCA nowhere states that numbering was kept. The rest is derived from the ID sets.
    - The ECC-2 ID set is exactly the ECC-1 ID set minus the deletions above, with two renumberings: 1-7-2→1-7-1 (from the Appendix) and 2-7-4→2-7-3 (inferred). Plus the 2-5-3-9 addition.
    - 2-7-4→2-7-3 is **not in the appendix**. It is inferred because both are the 2-7 periodic-review control (EN similarity 0.71).
    - The other 211 same-ID pairs are marked "derived". I read every pair with low text similarity (< 0.5): all are the same requirement reworded (must→shall, organization→entity, expanded wording). Rewordings that are not listed in Appendix C exist, e.g. 1-8-1, 1-10-4, 2-3-3-1 and 2-12-3-2 changed substantively without an appendix row.

## Doubts
- Appendix C is incomplete as a change log. EN and AR list different rows, and several substantive rewordings are not listed at all. Treat it as NCA's partial change list, not a full diff.
- Bidi reconstruction of mixed Arabic/Latin lines is heuristic. All mixed-script control lines were checked by eye on renders (2-2-3, 2-4-3, 2-5-3, 2-6, 3-1, 4-1), but an unusual quote or bracket placement elsewhere could still be off by one character's position.
- The EN Executive Summary and Introduction still speak of developing "ECC-1:2018" (a leftover in the source). The AR version correctly says ECC-2:2024 was updated. `framework.description` uses the Objectives paragraph, which is the same in both.
