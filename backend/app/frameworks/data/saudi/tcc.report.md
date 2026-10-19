# NCA Telework Cybersecurity Controls (TCC-1:2021): extraction report

Output: `out/tcc.json` (short_name `nca-tcc-1-2021`)

## Sources (all official, nca.gov.sa)
I found both final documents. The links are in the HTML of https://nca.gov.sa/en/regulatory-documents/controls-list/tcc (and the `/ar/` variant), in the Next.js payload.

| Lang | URL | Local file | sha256 | Use |
|---|---|---|---|---|
| EN | https://nca.gov.sa/telework_cybersecurity_controls-en.pdf | src/tcc/telework_cybersecurity_controls-en.pdf (28 pp, created 2021-05-30) | be0a18f65b60e5a82ec5efb6814b2844f1545b512fc7bf56d903879c924393ef | EN text |
| AR | https://nca.gov.sa/Telework-Cybersecurity-Controls.pdf | src/tcc/tcc-ar-final.pdf (26 pp, created 2021-05-02, cover "TCC -1:2021") | fb034c1189650aa36f28402ef3825ba82e722a4ac4b7ab79797352800cbe831f | AR text |
| AR | https://nca.gov.sa/NCA_TCC-1-2021_Assessment_and_Compliance_Tool_v2.0.xlsx | src/tcc/NCA_TCC-1-2021_Assessment_and_Compliance_Tool_v2.0.xlsx | a7800661f5a94066c8f74efc3e4c2a069c15c90a86c72daa4e97c64790baaf48 | Cross-check only |

I did not use the implementation guide (GTCC) or the 2020 draft (`src/tcc-ar.pdf`, "مسودة"). The earlier `src/tcc-en.pdf` / `tcc-en2.pdf` are HTML error pages, not PDFs.

### Extraction routes
- **EN:** I used `pdftotext -layout`, transcribed the text into `work/tcc/en_data.py`, and checked it automatically. Every adjacent word pair of every string had to occur in the PDF text stream (`ver_en.py`). Everything passed. The only flags came from inline IDs and one line break after "processed/", and I checked both by hand.
- **AR:** The text layer of the AR PDF is broken by the fonts. ت, ج and ث come out as U+FFFD, letters around ligatures are reordered, and lam-alef is broken. Tesseract OCR could not finish because the machine was overloaded (load average around 100).
  - So I transcribed all AR text by reading 300 dpi page renders of PDF pages 12–20 (the `view/c*.png` crops), into `work/tcc/ar_data.py`.
  - **Check 1 (`ver_ar.py`, `ver_ar_seq.py`):** I compared each AR word with the PDF text layer as a sorted multiset of letters, with ت/ج/ث/U+FFFD treated as one class. Then I aligned the word sequences of all 82 items against the page streams using difflib. Result: full agreement, apart from 2 harmless splits in the text layer ("بنا ًء", "ف ّعال"). This check caught and fixed one slip of mine: "الفرعية" was missing in 2-8-1. A reverse-coverage check showed no Arabic words on pages 12–20 that the output doesn't account for, other than page labels, headers and footers. That check is how I found the source typo "السيراني" in 3-1-1, which my transcription had silently corrected; I reverted it.
  - **Check 2 (`xl_diff.py`):** 54 of the 63 AR control and subcontrol clauses are character-for-character identical to the official NCA xlsx. The other 9 differ because the xlsx wording differs from the PDF (listed below). In each of those 9, the PDF text layer confirms my PDF reading.
  - For the ت/ج/ث letters, the text layer fixes every other letter, so only one choice gives a real word. All 110 such words in the objectives (not covered by the xlsx) were read from the renders.

## Counts
| Level | Output | Stated in the document (EN p.9 "Introduction"; AR p.6) |
|---|---|---|
| domain | 3 | 3 Main Domains |
| subdomain | 16 | 16 Subdomains |
| control | 21 | 21 Main Controls |
| subcontrol | 42 | 42 Subcontrols |

## EN↔AR pairing
- All 82 items have title + title_ar.
- All subdomains, controls and subcontrols have description + description_ar. Domains have no description (by design).
- **No null fields.** framework.description and description_ar are the verbatim purpose sentence from the Executive Summary (EN p.8, AR p.5).

## Artifact repairs applied
1. Line-break re-joining and de-hyphenation in EN (e.g. "cybersecu-/rity", "Mobile De-/vice"). Real hyphens are kept ("annually-updated", "sub-controls", "cyber-attacks").
2. AR is a visual transcription, so there were no NFKC or glyph-mapping fixes to make. The U+FFFD letters, the reordered letters ("السيرباين", "عىل") and the broken lam-alef in the text layer were only used as a check.
3. **Inline reference IDs in AR** (e.g. "الضابط ١-٣-١", "المكون الفرعي ١-٥"):
   - Written with Arabic-Indic digits, in logical order equal to the English ID. This is the xlsx convention, and it renders in RTL exactly as the PDF shows it.
   - In the text layer these IDs are digit-reversed Western digits (e.g. "5 - 1", "5-3-2-2"), and stray spaces were removed.
   - Plain numbers stay in Western digits as in the text layer and the xlsx: "12 شهراً", "(37140)", "1438/8/14هــ".
4. **Bidi parentheses in AR:** the text layer has "(()Distributed Denial of Service (DDoS" and similar. I wrote the logical form "(Distributed Denial of Service (DDoS))". The same applies to "(Mobile Device Management (MDM))" and "(User Behavior Analytics (UBA))".
5. The en dash in "(NCS – 1:2020)" in AR 2-7-1-1 is U+FFFD in the text layer. I took it from the render.

## Mappings (refs)
- **21 refs with basis "control text"** to `nca-ecc-1-2018`, one on each of the 21 main controls, exactly as the text cites them (e.g. 1-1-1→1-3-1, 1-2-1→subdomain 1-5, 2-2-2→2-2-3-5, 3-1-1→4-2-3).
- **1 internal ref:** 2-6-1-2→TCC 2-6-1-1, which the text cites.
- **16 subdomain refs, basis "Appendix A, Figure 5":**
  - The figure places each TCC subdomain in the cell of the ECC subdomain it extends. I checked this on the EN p.23 render.
  - The figure names the ECC subdomains but does not print their IDs. I took the IDs from the ECC-1:2018 numbering (names are unique).
  - The figure labels the cloud cell "4-1" although it is TCC 3-1. That is noted in the ref basis.
- **Not recorded:** 2-7-1-1 cites the National Cryptography Standards (NCS-1:2020), which is not in the short-name list.

## Spot-check (each verified against page renders; AR read on 300 dpi renders, EN p.18 rendered)
- **1-2-1-1** (EN p.14, AR p.12)
  - EN: Assessment of the cybersecurity risks for telework systems, once per year at least.
  - AR: تقييم مخاطر الأمن السيبراني لأنظمة العمل عن بعد، مرة واحدة سنوياً، على الأقل.
- **1-2-1-2** (EN p.14, AR p.12)
  - EN: Assessment of cybersecurity risks during planning and before permitting telework for any service or system.
  - AR: تقييم مخاطر الأمن السيبراني عند التخطيط وقبل السماح بالعمل عن بعد لأي خدمة أو نظام.
- **1-3-1** (EN p.14, AR p.13)
  - EN: In addition to the sub-controls within control 1-10-3 in the ECC, the cybersecurity awareness program must cover the awareness about the potential cyber risks and threats related to telework, including the following:
  - AR: بالإضافة للضوابط الفرعية ضمن الضابط ١-١٠-٣ في الضوابط الأساسية للأمن السيبراني، فإنه يجب أن يغطي برنامج التوعية بالأمن السيبراني المخاطر والتهديدات السيبرانية للعمل عن بعد والاستخدام الآمن للحد من هذه المخاطر والتهديدات، بما في ذلك:
- **1-3-1-3** (EN p.15, AR p.13)
  - EN: Protection of the stored data on the telework devices, and to be handled based on its classification.
  - AR: حماية البيانات التي يتم حفظها على الأجهزة المستخدمة للعمل عن بعد والتعامل معها حسب تصنيفها وإجراءات وسياسات الجهة.
- **2-2-1-2** (EN p.16, AR p.14)
  - EN: Restricting remote access for the same user from multiple computers at the same time (Concurrent Logins).
  - AR: تقييد إمكانية الوصول عن بعد لنفس المستخدم من أجهزة حاسبات متعددة في نفس الوقت (Concurrent Logins).
- **2-3-1-2** (EN p.17, AR p.15)
  - EN: Reviewing telework systems’ configurations and hardening at least once every year.
  - AR: مراجعة إعدادات الحماية لأنظمة العمل عن بعد والتحصين (Secure Configuration and Hardening)، مرة واحدة كل سنة على الأقل.
- **2-5-1** (EN p.17, AR p.16)
  - EN: In addition to the sub-controls within control 2-6-3 in the ECC, cybersecurity requirements for mobile device security related to telework systems shall include at least the following:
  - AR: بالإضافة للضوابط الفرعية ضمن الضابط ٢-٦-٣ في الضوابط الأساسية للأمن السيبراني، يجب أن تغطي متطلبات الأمن السيبراني الخاصة بأمن الأجهزة المحمولة للعمل عن بعد في الجهة، بحد أدنى، مايلي:
- **2-7-1-1** (EN p.18, AR p.17)
  - EN: The use of updated and secure methods and algorithms for encryption over the entire network connection used for telework, according to the Advanced level within the National Cryptography Standards (NCS 1:2020).
  - AR: استخدام طرق وخوارزميات محدثة وآمنة للتشفير على كامل الاتصال الشبكي المستخدم للعمل عن بعد وفقاً للمستوى المتقدم (Advanced) ضمن المعايير الوطنية للتشفير (NCS – 1:2020).
- **2-11-1-1** (EN p.19, AR p.19)
  - EN: Activating cybersecurity events logs on all technical components of telework systems.
  - AR: تفعيل سجلات الأحداث (Event Logs) الخاصة بالأمن السيبراني على الأصول التقنية وأنظمة العمل عن بعد.
- **2-12-1-3** (EN p.20, AR p.19)
  - EN: Addressing and implementing the recommendations and alerts for cyber security incidents and threats issued by the Sector regulator or by the National Cybersecurity Authority (NCA).
  - AR: تنفيذ وتطبيق التوصيات والتنبيهات الخاصة بحوادث وتهديدات الأمن السيبراني الصادرة من مشرف القطاع أو الهيئة الوطنية للأمن السيبراني.

## Doubts and quirks of the official documents (kept verbatim, not corrected)
- **EN 2-7 Objective is wrong in the official PDF.** It repeats the 2-7-1 control clause ("In addition to the sub-controls within control 2-8-3 …"), confirmed on the EN p.18 render. The AR objective is a proper one ("ضمان الاستخدام السليم والفعال للتشفير…"). I kept the EN text verbatim. You may prefer to null `description` for 2-7, or to flag it in the UI.
- **The EN and AR versions differ in substance in places.** The AR version is binding.
  - 2-3-1-1: EN says "at least once every three months"; AR says "مرة واحدة شهريا" (monthly).
  - 2-8-1-1: AR adds "وتوصي الهيئة بأن يتم عمل النسخ الاحتياطية، لأنظمة العمل عن بعد مرة واحدة كل أسبوع" (NCA recommends weekly backups). EN has no such sentence.
  - 2-7-1: AR says "الخاصة بالتشفير لدى المشتركين".
  - The texts are kept as each language states them.
- **Typos in the source, kept as they are:**
  - AR 3-1-1: "للأمن السيراني" (missing ب; the xlsx has the same typo).
  - AR 2-10 objective: "المعروفةالتي" (no space).
  - AR 1-3-1-5 and 2-3-1-3: "إعدادت".
  - EN 1-3-1-8: "To Communicate … If a".
  - EN domain 3 heading: "Third Party And Cloud Computing Cybersecurity". Figure 1 and the AR page heading show "Third-Party and Cloud Computing Cybersecurity". I used the heading on the controls page.
- **EN subdomain names follow the controls pages.** Figure 1 and Figure 5 use slightly different names: "Networks Security Management" (controls page: "Network Security Management"), "Mobile Devices Security" ("Mobile Device Security"), and "Cybersecurity Event Logs …" ("Cybersecurity Events Logs …").
- **Appendix A Figure 4 legend** mentions "organizations' highly sensitive social media accounts". This looks like a copy-paste from another NCA document; it has no effect on the data.
- **The xlsx assessment tool (v2.0) is not a faithful copy of the PDF.** It uses "تشمل … ما يأتي" instead of "تغطي … بحد أدنى، مايلي" in 1-1-1, 1-2-1 and 2-1-1, and different wording in 2-7-1. I never used it as a text source.
- **OCR (tesseract) could not be completed** because of machine load. The third route was the xlsx plus the PDF text layer instead. Every AR string agrees with the text layer word for word (with ت/ج/ث counted as one letter), and every one was read on the renders.
