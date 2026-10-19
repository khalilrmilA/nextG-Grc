# NCA CCC-2:2024 extraction report (`ccc2`, short_name `nca-ccc-2-2024`)

## Sources
| lang | URL | file | sha256 | extraction route |
|---|---|---|---|---|
| en | https://cdn.nca.gov.sa/api/files/public/upload/6d5408a3-d8e6-4e96-963b-2c7198e5b7c2_CCC-2-2024-EN-.pdf | src/ccc2-en.pdf (47 pp) | 9f2df2663c95473cbd1a874737b8f1caffd16a504a37ac210417a3910fc73ff6 | `pdftotext -layout` (good text layer), parsed by script; checked against page renders |
| ar | https://cdn.nca.gov.sa/api/files/public/upload/bd85b958-45a7-4b65-8eb1-cc1361c91233_CCC-2-2024-.pdf | src/ccc2-ar.pdf (43 pp) | 9f7b89a7ddc4fbdc1fa206aaa36681c312fe5bfd0dd8a02f2de75a2e47353fe6 | **No usable text layer** for the control tables (pp. 16–29 give only header/footer text, the body is drawn as outlines). Arabic was **transcribed manually from 300 dpi page renders** (read strip by strip), then **cross-checked word by word against three tesseract `-l ara` OCR passes** (raw 300 dpi `--psm 6`; binarised; cropped text column `--psm 4`). Every word of mine that OCR didn't confirm was checked again, with 500–600 dpi zooms where needed. |

Other official files found on the NCA AR CCC page (https://nca.gov.sa/ar/regulatory-documents/controls-list/ccc/), saved in `src/ccc2/`: the CSP and CST implementation guidelines (AR). They're out of scope (implementation guides) and have the same broken text layer, so I didn't use them for any text. I found no second official Arabic copy of the controls document. No third-party mirrors were used.

## Counts vs the document's own totals (Figure 1, EN p.7 / AR p.6)
| level | extracted | stated |
|---|---|---|
| domain | 4 | 4 main domains |
| subdomain | 24 | 24 subdomains |
| control | 55 (CSP 37, CST 18) | CSP 37 + CST 18 main controls |
| subcontrol | 120 (CSP 94, CST 26) | CSP 94 + CST 26 subcontrols |

Total 203 records. All counts match exactly.

## EN↔AR pairing
- All 203 records have both `title` and `title_ar`. Subdomains have `description`/`description_ar` (Objective / الهدف). Controls and subcontrols have the full clause in both languages. No clause is longer than 480 chars, so nothing is truncated.
- **Null fields:** none apart from the by-design nulls (`description`/`description_ar` on the 4 domains, and `guidance*` everywhere).
- IDs: the official EN IDs are used (`1-1-P-1`, `1-1-T-1-1` …). The AR document writes them with Arabic-Indic digits, م (مقدم الخدمة = P) and ش (المشترك = T). These were normalised and paired by ID. `applicability` = "CSP" for -P- and "CST" for -T- (null for domain/subdomain).
- ECC references inside Arabic clauses are kept in the text as Arabic-Indic digits in logical order (e.g. "١-٩-٣"). A script confirmed that the set of ECC IDs cited in every AR main control equals the set in its EN counterpart.

## Mappings (`refs`)
36 main controls carry refs, taken from the clause text ("In addition to … ECC control X" / "ECC Subdomain 1-5" / "ECC Subcontrol 2-8-3-2"). The refs sit on the main control that states them; subcontrols have none. `2-1-P-1`/`2-1-T-1` cite "ECC control 2-1", which is a subdomain and is recorded as `2-1`.

**Which ECC version? This is a doubt; please read.** I recorded the refs as `nca-ecc-1-2018`:
- The clauses never name an ECC version.
- The EN Executive Summary refers to "ECC-1: 2018" (text carried over from CCC-1).
- The **AR "الأهداف" section says CCC-2 extends "ECC – 2: 2024"**.
- But the cited IDs only make sense in ECC-1 numbering:
  - CCC 1-3-P/T-1 cites "ECC control 1-7-1" for legislative/regulatory compliance. ECC-2 deleted ECC-1's 1-7-1, and ECC-2's 1-7-1 is the old 1-7-2 (international agreements).
  - CCC 2-6-P/T-1 says "In addition to Subcontrols in the ECC control 2-7-3". ECC-1's 2-7-3 had subcontrols. ECC-2's 2-7-3 is a periodic-review control with no subcontrols, and the ECC-2 change table deletes the old 2-7-3.

  Evidence: ECC-2 EN Appendix C.

So the version attribution is my analysis, not a regulator statement. It is spelled out in each ref's `basis`. Every other cited ID (1-4-1, 1-5, 1-9-3/4/5, 2-1, 2-2-3, 2-3-3, 2-5-3 … 2-15-3, 2-8-3-2, 3-1-3, 4-1-2, 4-1-3) exists with the same meaning in both ECC versions. Re-tag them to `nca-ecc-2-2024` if you prefer to follow the AR intro.

## Artifact repairs applied
- EN: line re-joining. Removed page furniture ("Document classification: Public", "TLP: White", running title, page numbers, the stray "مقيد - محدود" header that appears on every EN page). Joined line-end hyphenation with no space ("up-" + "to-date", "know-" + "how", "third-" + "parties").
- AR: the text was transcribed, not extracted. Whitespace was normalised. Bidi-display parentheses were rebuilt into logical order by counting paren glyphs (e.g. 1-4-P-1-2 "(Cloud Technology Stack (CTS))", 2-2-P-1-12, 2-3-P-1-10, 2-4-P-1-3).
- Not "fixed" (kept verbatim as printed): EN "third- party" (2-2-P-1-6, printed with a gap), "Screen looking" (2-5-P-1-3), "may affecting", "Systsmes"/"Mulit-Factor"/"Audit Trial" in AR English glosses, AR "تطبييقها" (2-15-T-4, confirmed by OCR), AR "و معلومات" (2-6-T-1), AR "جميع الأحداث أحداث" (2-11-T-1-2), AR "الزام" without hamza (4-1-P-1-3), AR "سرَية" with a fatha (2-2-T-1-2).

## Spot-check (re-verified against page renders, pdftoppm; EN pages verified on render of p.21, AR on 300–600 dpi crops)
- **1-1-P-1-1** (EN pdf p.17, AR pdf p.16)  
  EN: Cybersecurity roles and RACI assignment for all stakeholders of the cloud services including the Authorizing Official's roles and responsibilities.  
  AR: أدوار الأمن السيبراني، وتكليفات المسؤولية والمحاسبة والاستشارة والتبليغ (RACI) لكل أصحاب العلاقة في خدمات الحوسبة السحابية، بما في ذلك أدوار ومسؤوليات صاحب الصلاحية.
- **1-4-P-1-2** (EN pdf p.18, AR pdf p.17)  
  EN: Screening or vetting candidates of personnel working inside the Kingdom who have access to Cloud Technology Stack, periodically.  
  AR: إجراء المسح الأمني للعاملين داخل المملكة الذين لهم حق الوصول إلى الأنظمة التقنية السحابية (Cloud Technology Stack (CTS)) دورياً.
- **2-2-P-1-12** (EN pdf p.21, AR pdf p.20)  
  EN: Assurance of restricted and controlled access to storage systems and means (such as Storage Area Network (SAN)).  
  AR: التحكم بالوصول لأنظمة ووسائل التخزين (مثل الشبكة الخاصة بالتخزين Storage Area Network (SAN)).
- **2-2-T-1-2** (EN pdf p.21, AR pdf p.20)  
  EN: Confidentiality of cloud user identification, cloud credential and cloud access rights information, including the requirement on users to keep them private (for employed, third party and CST personnel).  
  AR: سرَية هوية المستخدم والحسابات والصلاحيات، بما في ذلك الطلب من المستخدمين حفظ خصوصيتها (للعاملين، والأطراف الخارجية، والمستخدمين من جهة المشترك).
- **2-3-P-1-10** (EN pdf p.22, AR pdf p.21)  
  EN: Modern technologies, such as Endpoint Detection and Response (EDR) technologies, to ensure that the information servers and devices of CSP’s information processing systems and devices of are ready for rapid response to incidents.  
  AR: استخدام التقنيات الحديثة، مثل تقنيات (Endpoint Detection and Response (EDR))، لضمان جاهزية خوادم وأجهزة المعلومات الخاصة بأنظمة وأجهزة معالجة المعلومات لدى مقدمي الخدمات، للاستجابة السريعة للحوادث.
- **2-6-T-1** (EN pdf p.24, AR pdf p.22)  
  EN: In addition to Subcontrols in the ECC control 2-7-3, the CST shall cover the following additional Subcontrols for cybersecurity requirements for protecting CST’s data and information in cloud computing, as a minimum:  
  AR: بالإضافة للضوابط الفرعية ضمن الضابط ٢-٧-٣ في الضوابط الأساسية للأمن السيبراني، يجب أن تغطي متطلبات الأمن السيبراني الخاصة بحماية بيانات و معلومات المشتركين في الحوسبة السحابية، بحد أدنى مايلي:
- **2-11-T-1-2** (EN pdf p.26, AR pdf p.24)  
  EN: Monitoring shall include all activated cybersecurity logs on the cloud services of the CST.  
  AR: أن تشمل عملية المراقبة جميع الأحداث أحداث الأمن السيبراني المفعلة على الخدمات السحابية الخاصة بالمشترك.
- **2-15-T-4** (EN pdf p.28, AR pdf p.26)  
  EN: Cybersecurity requirements for key management within the CST shall be applied and reviewed periodically.  
  AR: يجب مراجعة متطلبات الأمن السيبراني الخاصة بإدارة المفاتيح لدى المشتركين، ومراجعة تطبييقها، دورياً.
- **2-17-P-4** (EN pdf p.29, AR pdf p.27)  
  EN: Cybersecurity requirements for usage of information and data media within the CSP shall be applied and reviewed periodically.  
  AR: يجب مراجعة متطلبات الأمن السيبراني لاستخدام وسائط المعلومات والبيانات المادية لدى مقدمي الخدمات، ومراجعة تطبيقها، دورياً.
- **4-1-P-1-3** (EN pdf p.31, AR pdf p.29)  
  EN: Third-party providers compliant with law and regulatory requirements relevant to their scope.  
  AR: الزام الأطراف الخارجية بالمتطلبات التنظيمية، والتشريعية ذات الصلة بنطاق عملهم.

## Notes / doubts
1. **Arabic is a manual transcription from images** (no text layer). Every word was cross-checked against OCR, and the remaining disagreements were re-read at high zoom. Invisible encoding choices can't be confirmed from an image: tanween position "ـًا" vs "ـاً" (written as it appears: e.g. "وفقًا" in most objectives, "وفقاً" in 2-10, "دورياً" in clauses), presence of a space before "،" or around "“…”", and straight vs curly quotes in 4-1's objective. Treat these as possibly differing at the code-point level from NCA's source file.
2. "سرَية" (2-2-T-1-2): a fatha-like mark sits above ر at 600 dpi. I kept it. It could be a misplaced kasra/shadda in the source.
3. Domain 4 names differ between the language versions: EN "Third-Party Cybersecurity" vs AR heading "الأمن السيبراني المتعلق بالأطراف الخارجية والحوسبة السحابية (Third-Party and Cloud Computing Cybersecurity)". Each language is kept as printed in the controls section.
4. Some AR wording differs in scope from the EN. For example, the 1-5 objective mentions "مقدمي الخدمات والمشتركين" in its last phrase, and 4-1-P-1-4 is phrased as an obligation ("يجب على الطرف الخارجي…"). These are faithful to each document, not translations of each other.
5. Annex A (control levels 1–4, mandatory/optional per control, with footnoted exceptions) was **not** encoded; `applicability` only carries CSP/CST. Note that the EN Annex A footnotes are misnumbered relative to their markers (e.g. footnote 3 refers to 2-5-P-1-2).
6. Annex D (changes vs CCC-1:2020) was ignored for controls as instructed. It records the deletion of former CSP subcontrols 2-3-P-1-10 and 2-3-P-1-11 (data localisation → NDMO/SDAIA) and the renaming of the term "Confidential Data" to "Sensitive Data". The current 2-3-P-1-10 (EDR) is a different control under the same number.
7. `framework.description` (EN) is the first paragraph of "Objectives". `description_ar` is the first two paragraphs of "الأهداف" (AR p.10, verified on render). They aren't sentence-for-sentence equivalents.
