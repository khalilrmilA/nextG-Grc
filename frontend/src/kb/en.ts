import type { KbArticle } from "./types";

// English Knowledge Base. One article per app module; `id` is the route segment
// so the header "?" button can open the article for the current page.
// Inline markup allowed in strings: **bold** and `code`.
export const kbEn: KbArticle[] = [
  // ───────────────────────────── Overview ─────────────────────────────
  {
    id: "dashboard",
    route: "/dashboard",
    group: "overview",
    title: "Dashboard",
    summary: "Your home page: a live overview of compliance, risks, audit findings and policy attestation across every module.",
    keywords: ["home", "overview", "KPI", "score", "posture", "executive summary", "widgets"],
    sections: [
      {
        heading: "What it’s for",
        body: "The dashboard gathers the key numbers from across the platform in one place. Until a primary framework is chosen it shows a welcome card with a **Select Frameworks** button. After that, it shows **Your Frameworks** (one card per framework), the compliance action plan, the recommendations dashboard and platform KPIs such as open risks, average compliance, open audit findings and policy attestation. Executives and CISOs also see an **Executive summary** with a weighted security posture score and top risks.",
      },
      {
        heading: "How to drill into a framework",
        steps: [
          "Click a card under **Your Frameworks**.",
          "Review the Overall Score, Controls Covered, Open Gaps, Missing Docs and Cert Readiness.",
          "Use **Quick Actions** (Run Analysis, View Gap Report, Upload Documents, Generate Policies) to jump straight into the work.",
          "If no assessment exists yet, click **New Assessment** or **Start Assessment**.",
        ],
      },
      {
        heading: "How to customise and export",
        steps: [
          "Click **Customize** to show, hide or reorder sections and KPIs, then save the layout.",
          "Pick a refresh interval (Off to 1 hour) or click **Refresh** to update now.",
          "Click **Export** and choose PDF or Excel to download the dashboard.",
        ],
      },
      {
        heading: "Tips",
        tips: [
          "Only admins, CISOs, compliance managers and policy managers see the **Add Framework** card.",
          "Charts can be saved as an image with **Export as image**.",
        ],
      },
    ],
  },
  {
    id: "getting-started",
    route: "/dashboard",
    group: "start",
    title: "Getting started with GRC Eye",
    summary: "A quick tour for your first login: how the menus work, how to switch language, where to find help, and what to set up in your first week.",
    keywords: ["onboarding", "first login", "tour", "navigation", "menu", "sidebar", "language", "help", "arabic", "french"],
    sections: [
      {
        heading: "Your first login",
        body: "Sign in with the email and temporary password your administrator sent you. If two-factor login is turned on for your account, you will also be asked for a 6-digit code from your authenticator app. On your first visits a short guided tour points out the main areas. A read-only banner appears at the top if your account has viewer access.",
      },
      {
        heading: "Finding your way: the sidebar",
        body: "The left sidebar is organised into collapsible menus, one per domain: **Overview**, **Asset Management**, **Risk Management**, **Exposure Management**, **Compliance Management**, **Control Management**, **Audit Management**, **Policies & Documents**, **Third-Party Management**, **Governance** and **Reports & Support**. Click a menu name to open or close it. You only see the pages your role allows. A greyed-out item with a lock means that module is not enabled for your organisation. At the bottom you will find **Documentation** (this site), **Settings** and **Help**.",
      },
      {
        heading: "Language and help",
        steps: [
          "Click the language button (flag and code) in the header and choose **EN**, **FR** or **AR**. Arabic switches the whole layout to right-to-left.",
          "Click the **?** icon next to the language button at any time. It opens this documentation at the guide for the page you are on. Inside the documentation, press **Ctrl K** to search every guide.",
          "Use the bell icon to see your notifications, and the floating AI Assistant button for quick questions.",
        ],
      },
      {
        heading: "Recommended first week",
        steps: [
          "**Assets**: register your main systems, applications and data, with an owner and CIA valuation.",
          "**Risks**: add your key risks in the Risk Register and score likelihood and impact.",
          "**Frameworks and compliance**: choose your framework(s), then create a compliance assessment and run the AI analysis.",
          "**Controls**: record the controls you already have in Applied Controls and follow up the gaps in the Action Plan.",
          "**Policies**: create or generate your core policies and send them for attestation.",
          "**Reports**: download an Executive Summary to share progress.",
        ],
      },
    ],
  },
  {
    id: "analytics",
    route: "/analytics",
    group: "overview",
    title: "Analytics & Dashboards",
    summary: "Per-module KPIs across the whole risk programme, with filters and Excel/CSV/PDF export.",
    keywords: ["KPI", "metrics", "charts", "export", "excel", "csv", "heatmap", "trend", "statistics"],
    sections: [
      {
        heading: "What it’s for",
        body: "Analytics shows one tile per module (Assets, Vulnerabilities, Threats, Risks, Controls, Governance, Audit, Recommendations) with totals, severity counts and breakdowns by type, status, category or priority. The Risks view includes a 5×5 likelihood × impact heatmap. Available if your organisation has the Elite Pack enabled. Each tile is shown only to the roles it is meant for; others see “Restricted view”.",
      },
      {
        heading: "How to filter and drill down",
        steps: [
          "Use the **Filters** bar to choose a Period (last 30 days to all time) and a Severity.",
          "Click the expand icon on a tile to open a focused view of that module.",
          "Click **Reset filters** to go back to the full picture.",
        ],
      },
      {
        heading: "How to export data",
        steps: [
          "In **Report export**, choose a dataset: Risk register, Vulnerabilities, Asset inventory, Applied controls, Audits or Threat library.",
          "Click **Excel** or **CSV** to download it.",
          "To export a single tile, use its export menu (PDF or Excel), or save a chart with **Export as image**.",
        ],
      },
      {
        heading: "Tips",
        tips: [
          "Filters are kept in the page address, so you can bookmark or share a filtered view.",
          "Set an auto-refresh interval if you keep the page open on a screen.",
        ],
      },
    ],
  },

  // ──────────────────────── Asset & Risk Management ────────────────────────
  {
    id: "assets",
    route: "/assets",
    group: "assets",
    title: "Asset Inventory",
    summary: "The register of your primary and support assets, with CIA valuation, ownership, status and lifecycle.",
    keywords: ["inventory", "CMDB", "server", "application", "database", "CIA", "owner", "lifecycle", "end-of-life"],
    sections: [
      {
        heading: "What it’s for",
        body: "Assets are the foundation for risks, vulnerabilities, incidents and compliance scope. Each asset has a type (server, application, database, cloud service, data, process, person and more), a class (**primary** or **support**), a criticality, a business owner and a confidentiality/integrity/availability rating from 1 to 5.",
      },
      {
        heading: "How to add an asset",
        steps: [
          "Click **New Asset**.",
          "Enter the **Name** and **Business owner** (both required), then choose Type, Class and Criticality.",
          "Rate Confidentiality, Integrity and Availability (1–5) and add a business value.",
          "Set the status (operational, degraded, out of service…) and lifecycle stage (acquisition, in use, maintenance, retired), then save.",
        ],
      },
      {
        heading: "How to find assets",
        steps: [
          "Use **Search assets…** and the Criticality, Class and Status filters.",
          "Use the columns menu to show or hide columns.",
          "Click **Dashboard** to show charts such as the breakdown by status.",
        ],
      },
      {
        heading: "Tips",
        tips: [
          "A banner warns you when assets are approaching or past end-of-life.",
          "Map assets to departments and business processes in **Asset Cartography**.",
        ],
      },
    ],
  },
  {
    id: "asset-graph",
    route: "/asset-graph",
    group: "assets",
    title: "Asset Cartography",
    summary: "An interactive map linking your organisation’s entities, business processes and the assets that support them.",
    keywords: ["map", "graph", "entity", "department", "business process", "dependencies", "cartography"],
    sections: [
      {
        heading: "What it’s for",
        body: "Asset Cartography shows who depends on what. Org entities (departments, branches), business processes and assets are drawn as connected rings, so you can see the impact of an asset on the business. The entities and processes you create here can also be used to filter risks and scope compliance assessments. Available if your organisation has this module enabled.",
      },
      {
        heading: "How to build the map",
        steps: [
          "In **Org Entities**, click **+** and enter an entity name, type (e.g. department, branch) and optional parent.",
          "In **Business Processes**, click **+**, enter a process name, choose its entity, criticality and owner, and link the assets that support it.",
          "Click a node on the graph to highlight its direct connections.",
        ],
      },
      {
        heading: "Tips",
        tips: [
          "Use **All entities** and **All asset types** to focus the graph; **Clear filters** resets it.",
          "Deleting an entity detaches its children rather than deleting them.",
        ],
      },
    ],
  },
  {
    id: "risks",
    route: "/risks",
    group: "risk",
    title: "Risk Register",
    summary: "Your central list of risks, scored by likelihood × impact, with a heat map, risk appetite and target validation.",
    keywords: ["risk", "register", "heatmap", "likelihood", "impact", "appetite", "residual", "inherent", "export"],
    sections: [
      {
        heading: "What it’s for",
        body: "The Risk Register records each risk with a category, status, likelihood and impact (1–5). The score and severity are calculated for you. A 5×5 **Risk Heat Map** shows where risks sit; click a cell to filter the list.",
      },
      {
        heading: "How to add a risk",
        steps: [
          "Click **New Risk**.",
          "Enter the **Risk Title** and a description, then choose a Category and Status (Identified, Assessed, Treatment Planned, Treatment In Progress, Treated or Accepted — a risk is closed later, from **Edit**).",
          "Set Likelihood and Impact with the sliders and watch the score update.",
          "Add tags (comma-separated) and save.",
        ],
      },
      {
        heading: "How to set appetite and validate a target",
        steps: [
          "Click a risk to open its detail.",
          "In **Risk Appetite**, click **Edit** to set the appetite threshold and the target likelihood and impact.",
          "When the target is within appetite, click **Validate target** and add optional calculation notes.",
        ],
      },
      {
        heading: "How to edit, close, reopen or delete a risk",
        steps: [
          "Click a risk, then **Edit**. The same form as creation opens, with residual and target likelihood/impact, owner, review date, linked controls and department / process.",
          "To close a risk, set its status to **Closed** and save. To reopen it, choose another status: a **Reason for reopening** is required and is kept in the history.",
          "**Delete** (CISO only) asks for confirmation. A closed or accepted risk cannot be deleted — it records a decision; reopen it first if it was created in error.",
          "Open the **History** tab to see who changed what and when; **Show changes** lists every field that moved.",
        ],
      },
      {
        heading: "Tips",
        tips: [
          "Only CISOs and risk managers can validate a target, and validation is blocked while the target is still over appetite.",
          "Use **Export CSV** to download the register.",
          "The detail view includes an **AI Risk Analysis** panel for a quick second opinion.",
        ],
      },
    ],
  },
  {
    id: "risk-scenarios",
    route: "/risk-scenarios",
    group: "risk",
    title: "Risk Scenarios",
    summary: "Describe how a threat could exploit a vulnerability on an asset, and assess current versus target risk with a treatment decision.",
    keywords: ["scenario", "threat", "vulnerability", "asset", "treatment", "priority", "EBIOS", "version history"],
    sections: [
      {
        heading: "What it’s for",
        body: "A risk scenario links threats, vulnerabilities, assets, past incidents and applied controls into one story. You rate current and target probability and impact, pick a treatment (Mitigate, Accept, Transfer, Avoid or Untreated) and record how confident you are (Strength of Knowledge).",
      },
      {
        heading: "How to create a scenario",
        steps: [
          "Click **Add Scenario**.",
          "Enter a name and description, then link the relevant threats, vulnerabilities, assets, incidents and applied controls.",
          "Set current and target probability and impact (1–5), the treatment and the strength of knowledge.",
          "Add the threat actor, a justification and a **Next review date**, then save.",
        ],
      },
      {
        heading: "How to prioritise and track changes",
        steps: [
          "Click **Prioritisation criteria** to set the asset criticality weight, regulatory exposure weight and the alert threshold. Scenarios above the threshold notify owners and the CISO.",
          "Sort the list by **Priority** to see what matters most.",
          "Open **Version History**, click **Snapshot now**, and use **Compare** to see what changed between two versions.",
        ],
      },
      {
        heading: "How to edit or delete a scenario",
        steps: [
          "Click the pencil on a row to edit it: re-score current and target probability/impact, change the treatment or the linked threats, vulnerabilities, assets, incidents and controls. The linked register entry is re-scored too.",
          "Click the bin to delete a scenario (risk managers and CISOs). Its final state is kept in the activity log. The risk-register entry it created is deleted with it — or closed with the reason **Scenario deleted** when a treatment plan, an acceptance or a control still cites it.",
          "The actions (History, Edit, Delete) stay pinned at the end of each row while the table scrolls sideways. Editing the probability or impact saves a version of the linked risk first, so its **History** shows the change.",
        ],
      },
      {
        heading: "Tips",
        tips: [
          "You can start a scenario directly from an incident with **Create risk scenario from this incident**.",
          "An **Overdue** badge shows scenarios past their review date.",
        ],
      },
    ],
  },
  {
    id: "risk-cartography",
    route: "/risk-cartography",
    group: "risk",
    title: "Risk Cartography",
    summary: "Build your own risk maps with custom grid size, axis labels, colour zones and manual positions, and export them as PDF.",
    keywords: ["risk map", "heatmap", "matrix", "zones", "grid", "PDF", "cartography"],
    sections: [
      {
        heading: "What it’s for",
        body: "Risk Cartography lets you create several independent risk maps, for example one per department or per category, each with its own grid and colours. One map can be marked as the default.",
      },
      {
        heading: "How to create a map",
        steps: [
          "Click **New Cartography**.",
          "On **General**, enter a name, a description and a scope (All Risks, By Control, By Category or By Tag).",
          "On **Grid**, choose a preset (3×3, 4×4, 5×5) or custom size, and label the likelihood and impact axes.",
          "On **Risk Zones**, name each zone, set its min/max score and colour, then save.",
        ],
      },
      {
        heading: "How to adjust and share",
        steps: [
          "Open a map and click **Edit Positions**, select a risk, then click a cell to move it.",
          "Use **Reset to original position** to undo a manual move.",
          "Click **Export PDF** to download the map.",
        ],
      },
      {
        heading: "Tips",
        tips: ["Moved risks are marked **Overridden**, so readers know the position was set by hand."],
      },
    ],
  },
  {
    id: "risk-treatment",
    route: "/risk-treatment",
    group: "risk",
    title: "Risk Treatment",
    summary: "Record the treatment decision for each risk (mitigate, accept, transfer, avoid) with schedule, cost and progress tracking.",
    keywords: ["treatment plan", "mitigate", "accept", "transfer", "avoid", "insurance", "budget", "due date"],
    sections: [
      {
        heading: "What it’s for",
        body: "Each treatment plan is tied to a risk and optionally to risk scenarios. It tracks the chosen option, progress, due date and estimated cost, and flags plans that are overdue, at risk or over budget. Available if your organisation has the Elite Pack enabled.",
      },
      {
        heading: "How to create a treatment plan",
        steps: [
          "Click **New treatment** and choose the risk.",
          "Link risk scenarios if relevant and choose the option: Mitigate, Accept, Transfer or Avoid.",
          "Enter a description, progress %, due date and estimated cost.",
          "For **Transfer**, say who the risk is transferred to (e.g. an insurance policy). Every option needs a justification (for **Accept**, the acceptance justification).",
        ],
      },
      {
        heading: "How to update a plan",
        steps: [
          "Click **Supersede** on the plan.",
          "Change the details and describe **What changed in this new plan?**",
          "Save. The old plan is kept in **Version history**.",
        ],
      },
      {
        heading: "Tips",
        tips: ["Switch to **By responsible** to see each owner’s plans, average progress and budget overruns."],
      },
    ],
  },

  // ──────────────────────── Vulnerability & Threats ────────────────────────
  {
    id: "vulnerabilities",
    route: "/vulnerabilities",
    group: "exposure",
    title: "Vulnerabilities",
    summary: "Track and remediate security vulnerabilities, from manual entries, scanner imports and automatic scanner connectors through to closure.",
    keywords: ["CVE", "CVSS", "scan", "scanner", "nessus", "tenable", "qualys", "openvas", "import", "connector", "EASM", "patch"],
    sections: [
      {
        heading: "What it’s for",
        body: "This page lists every known vulnerability with its reference (e.g. a CVE), severity, CVSS score, status and remediation due date. Statuses run from pending validation and validated, through open and in remediation, to mitigated, accepted, closed or false positive. KPI tiles show the total, open, in-remediation count and average CVSS.",
      },
      {
        heading: "How to add and manage a vulnerability",
        steps: [
          "Click **Add Vulnerability** and enter the Reference ID and Name, then severity, CVSS score, source (pen test, scan, manual, bug bounty) and affected systems.",
          "Click a row to open it. Update the status, severity, CVSS or remediation due date and click **Save**.",
          "For items waiting for review, a CISO clicks **Validate**.",
          "In **Impact Score**, pick the operational context (internet-facing, production, internal…) and click **Recalculate**, or **Override manually** with a justification. Link the risk scenarios this impact feeds.",
        ],
      },
      {
        heading: "Importing scanner results",
        steps: [
          "Click **Import scan**.",
          "Choose the scanner: Generic CSV, OpenVAS, Qualys or Nessus / Tenable.",
          "Upload the file (`.csv`, `.nessus` or `.xml`). Findings are parsed, duplicates are skipped and findings are matched to your assets automatically. XML reports are recognised from their content, so an OpenVAS / Greenbone XML report is read as OpenVAS.",
          "Read the result message, which shows how many findings were imported, matched and skipped.",
        ],
        tips: ["Not sure of the format? Use **Download a sample OpenVAS CSV to try it**."],
      },
      {
        heading: "Scanner connectors",
        steps: [
          "Click **Connectors**, then **Add connector**.",
          "Give it a name and choose the tool. **Tenable.io**, **Nessus (Professional / Manager)** and **Qualys VM** pull findings automatically. Enter the scanner’s base URL, then the access and secret keys (Tenable.io, Nessus) or the API username and password (Qualys VM).",
          "To pull on a schedule, tick **Automatic sync** and choose **Daily**, **Weekly** or **Monthly**, then click **Add**.",
          "On the connector’s row, click **Test** to check that the scanner can be reached and the credentials are accepted (nothing is imported), then **Sync now** to pull findings. Every run is recorded.",
          "Each row shows the last sync time and its status (or **Never synced**). You can turn **Automatic sync** on or off and change its frequency directly on the row.",
        ],
        tips: [
          "Nessus needs an edition with API access, such as Nessus Manager. If your edition does not allow it, export the scan as `.nessus` and use **Import scan**.",
          "OpenVAS / Greenbone is file import only: it cannot be pulled over the network. Export the report as XML or CSV and use **Import scan**.",
          "**EASM (External Attack Surface)** connectors pull findings from your external attack surface platform: enter its Base URL, API key, authentication style and findings endpoint path, then click **Test** — it shows how the platform’s fields were mapped, with a preview. Newly discovered domains and IPs are created as assets (tagged `easm`); assign them an owner during review.",
        ],
      },
      {
        heading: "Tips",
        tips: [
          "Creating, editing and deleting vulnerabilities is limited to CISOs, risk managers and admins; scanner imports to CISOs and security analysts.",
          "Scanner import, connectors and impact scoring are Elite Pack features.",
        ],
      },
    ],
  },
  {
    id: "cve",
    route: "/cve",
    group: "exposure",
    title: "CVE Knowledge Base",
    summary: "Search the public NVD CVE catalogue, keep it up to date, and decide which CVEs are relevant to your environment.",
    keywords: ["CVE", "NVD", "CWE", "KEV", "exploited", "CISA", "triage", "advisory", "patch"],
    sections: [
      {
        heading: "What it’s for",
        body: "The CVE Knowledge Base is a searchable copy of the NVD catalogue, enriched with the MITRE CWE flaw types and the CISA list of actively exploited vulnerabilities (KEV). You can triage each CVE as pertinent, to watch or non pertinent for your organisation. Available if your organisation has the Elite Pack enabled.",
      },
      {
        heading: "How to search and triage",
        steps: [
          "Type a CVE id or keyword in **Search CVE id or description…**.",
          "Narrow down with flaw type (CWE), CVSS minimum, published date, **Actively exploited** and relevance, then click **Search**.",
          "Set relevance directly in the table with the **Triage…** dropdown.",
          "Open the full sheet to read the attack vector, known workarounds, attack patterns and fixes, then record your relevance, internal notes and linked assets and click **Save**.",
        ],
      },
      {
        heading: "How to refresh the catalogue",
        steps: ["Click **Sync from NVD** to pull the last 7 days of CVEs and update the CWE catalogue. Only security analysts and CISOs can sync."],
      },
      {
        heading: "Tips",
        tips: ["An **Exploited** badge marks CVEs on the CISA KEV list; the sheet shows their remediation due date."],
      },
    ],
  },
  {
    id: "threats",
    route: "/threats",
    group: "exposure",
    title: "Threat Library",
    summary: "A catalogue of threats — built-in, MITRE ATT&CK and live feeds — that you adopt into your own register and profile.",
    keywords: ["threat", "MITRE", "ATT&CK", "CISA", "SANS", "feed", "threat intelligence", "threat profile"],
    sections: [
      {
        heading: "What it’s for",
        body: "The Threat Library combines a built-in catalogue, the MITRE ATT&CK techniques and threats fetched automatically every 24 hours from CISA KEV, SANS ISC and supply-chain sources. New feed items wait in **Pending Review** until someone approves them. Threats you own can be linked to risk scenarios.",
      },
      {
        heading: "How to add or adopt threats",
        steps: [
          "Click **Add Threat** and enter a reference, name, description, category, threat actors and MITRE ATT&CK IDs.",
          "For a built-in threat, open it and click **Add to my register**.",
          "Click **Import MITRE ATT&CK** once to load 700+ techniques, or **Fetch Now** to check the feeds immediately.",
          "In **Pending Review**, click **Approve** or **Reject** (or **Approve All**). In **Threat watch**, send useful items **To register** or **Dismiss** them.",
        ],
      },
      {
        heading: "How to build a threat profile",
        steps: [
          "Open a threat you own and click **Add Profile**.",
          "Describe origin, objectives, mode of operation, conditions and aggravating factors, and set frequency, probability, severity and threat family. Link assets and vulnerabilities.",
          "When complete, a CISO or risk manager clicks **Validate profile**, and later **Record a review**.",
        ],
      },
      {
        heading: "Tips",
        tips: [
          "Use the **Review overdue** filter to find profiles that need attention.",
          "Adding threats and approving feed items is limited to security analysts and CISOs.",
        ],
      },
    ],
  },
  {
    id: "incidents",
    route: "/incidents",
    group: "exposure",
    title: "Incidents",
    summary: "Record security incidents, update them through their lifecycle, and turn them into risk scenarios.",
    keywords: ["incident", "breach", "malware", "phishing", "outage", "notification", "security event", "edit", "status", "lifecycle", "timeline", "root cause", "post-mortem"],
    sections: [
      {
        heading: "What it’s for",
        body: "The incident register lists each security incident with its category (data breach, unauthorised access, malware, phishing, denial of service, insider threat, physical security, system outage, policy violation, other), severity and status (Open, Investigating, Contained, Resolved, Closed, Post-mortem). KPI tiles show totals, open, investigating and critical incidents.",
      },
      {
        heading: "How to report an incident",
        steps: [
          "Click **Report Incident**.",
          "Enter the title and description, then choose the category and severity.",
          "Link the affected vulnerabilities and assets, and list any other affected systems.",
          "Tick **Breach notification required** if the incident must be reported to an authority, then save.",
        ],
      },
      {
        heading: "How to open and update an incident",
        steps: [
          "Click an incident’s row to open its detail window. The header shows who reported it, when it was created and when it was last updated.",
          "The status pills show the lifecycle in order: Open, Investigating, Contained, Resolved, Closed, Post-mortem. Click a pill, or click **Move to** followed by the next status, to change it. The change is saved immediately, and moving to Contained or Resolved fills in that date for you if it is still empty.",
          "Update the sections you need: **Overview** (title, description, category, severity, assignee, tags), **Timeline** (detected, contained and resolved dates), **Scope & impact** (linked assets and vulnerabilities, affected systems, affected users, financial impact, data types, business impact), **Response & resolution** (containment actions, root cause, remediation actions, lessons learned, post-mortem URL) and **Breach notification** (date the notification was sent and regulatory reference).",
          "Click **Save**. The button is active only once something has changed, and only the fields you changed are saved.",
          "To remove the incident, click **Delete**, then confirm with **Delete** in the red bar (or **Cancel**). Deletion is permanent.",
        ],
      },
      {
        heading: "How to learn from an incident",
        steps: ["Click the **Create risk scenario from this incident** icon on the row, or the button of the same name at the bottom of the incident window. A pre-filled scenario opens in Risk Scenarios for you to complete."],
      },
      {
        heading: "Tips",
        tips: [
          "Use the search box and the severity and status filters to find incidents quickly.",
          "Reporting, editing and deleting incidents is limited to security analysts, CISOs and admins. Everyone else can still open an incident, but sees it read-only.",
        ],
      },
    ],
  },

  // ──────────────────────── Compliance & Controls ────────────────────────
  {
    id: "compliance",
    route: "/compliance",
    group: "compliance",
    title: "Compliance Assessments",
    summary: "Assess your organisation against a framework: upload documents, let AI analyse each control, review gaps and plan remediation.",
    keywords: ["assessment", "gap analysis", "ISO 27001", "SOC 2", "evidence", "AI analysis", "SoA", "traceability", "score"],
    sections: [
      {
        heading: "What it’s for",
        body: "Each assessment measures one framework over a chosen scope (whole organisation, an entity, a process or assets). The AI reads your documents, rates every control and produces a compliance score and a gap report. The page lists your assessments with filters for In Progress, Under Review, Completed and Draft, and a dashboard you can export to Excel or PDF.",
      },
      {
        heading: "How to run an assessment",
        steps: [
          "Click **New Assessment**, give it a name, choose the framework, scope and compliance scale, then **Create Assessment**.",
          "On **Upload & Analyze**, drop your policies and evidence (PDF, DOCX, XLSX, XLS, TXT — up to 10 MB each).",
          "Click **Run AI Analysis**. It usually takes 1–5 minutes and ends with your compliance score.",
          "Use **Document Checklist** to see which mandatory documents are still missing.",
        ],
      },
      {
        heading: "How to review results and gaps",
        steps: [
          "On **Results**, open a control to read the AI assessment. Use **Override status** if you disagree, add a justification, assign an owner or **Generate policy**.",
          "On **Gap Report**, **Accept Gap** or **Reject Gap**, or **Accept All Critical**. Accepted gaps become actions in the Action Plan.",
          "Click **Generate 90-Day Plan** for a remediation roadmap, and **Traceability Matrix** to see requirement-to-evidence links.",
          "Use **Export CSV**, **Full Report**, **DdA / SoA** or **Share** to share results.",
        ],
      },
      {
        heading: "Human decisions, owners and evidence validity",
        steps: [
          "A new assessment lists every requirement from the start, so you can assess by hand before any AI run.",
          "A status set by a person is marked **Reviewed**. Re-running the AI never changes it and never removes evidence: the AI's opinion appears as **AI suggests …** with an **Accept** button. Before a re-run, the Upload tab says how many decisions will be kept.",
          "Compliance managers act on every requirement; a control owner assesses and uploads evidence only for the requirements assigned to them (**Only requirements I own**).",
          "When uploading evidence, set **Valid until**. Badges show expired or soon-expiring proof, a requirement whose only evidence has expired is flagged, and reminders go out 30, 7 and 0 days before expiry.",
          "CISOs and compliance managers can open **Deleted files** to download any removed evidence, document or contract version.",
          "Whoever uploaded a piece of evidence can remove it (bin icon) or change its **Valid until** date afterwards (calendar icon); compliance managers and CISOs can do so for any evidence.",
          "A **draft** assessment nobody has worked on can be deleted. Once it carries recorded work (a person’s status, evidence, actions, an auditor engagement or comments) delete is refused — **archive** it instead.",
        ],
      },
      {
        heading: "Tips",
        tips: [
          "Evidence you attach to one control is shared automatically with equivalent controls in other frameworks; see the **Cross-Framework** tab.",
          "Choose **Show to auditor** or **Hide from auditor** on each file in the checklist.",
          "Mandatory controls cannot be set to Not applicable.",
        ],
      },
    ],
  },
  {
    id: "framework",
    route: "/framework",
    group: "compliance",
    title: "Frameworks",
    summary: "Browse the built-in standards and regulations, customise them into your own editable copy, import or build custom frameworks, or create one from scratch.",
    keywords: ["framework", "standard", "regulation", "ISO", "NIST", "GDPR", "NIS2", "DORA", "customize", "clone", "import", "builder", "crosswalk", "from scratch", "internal policy", "referential"],
    sections: [
      {
        heading: "What it’s for",
        body: "The framework library holds the built-in standards, regulations and laws plus any custom frameworks your organisation owns. Open a framework to read its controls, mandatory flags and equivalences in other frameworks. Built-in frameworks are read-only and shared; your custom copies are fully editable.",
      },
      {
        heading: "How to customise a built-in framework",
        steps: [
          "Click **Customize** on a built-in framework card. An editable copy is created in your workspace.",
          "On the edit page, rename the framework, edit or delete controls, or **Add control** (from scratch or imported from another framework).",
          "Add translations for control titles and descriptions if needed.",
          "Use **Compare with the source** to see what changed, and **Re-sync from the source** to pick up updates while keeping your edits.",
        ],
      },
      {
        heading: "How to build or import a custom framework",
        steps: [
          "Click **Build Custom Framework** and fill in the name, version, industry, region and a description of the use case.",
          "Browse controls from existing frameworks and select the ones you need.",
          "Click **Get AI Suggestions** for extra controls, or **Add Your Own Control**, then **Save Framework**.",
          "Or click **Import Framework** to load a CSV, Excel or YAML file. Tick **Validate without importing** to test the file first.",
        ],
      },
      {
        heading: "How to create a framework from scratch",
        steps: [
          "Click **Create from scratch** (next to **Import Framework** and **Build Custom Framework**).",
          "In **Framework details**, enter the name, short name, version, description and issuing body, choose the **Source type** (Standard, Regulation, Law or Internal policy) and the applicable regions and industries, then click **Save details**.",
          "In **Add control**, enter the control’s reference and title, then optionally its category, **Domain**, **Requirement type** (Requirement, Recommendation or Control measure), description and implementation guidance.",
          "Under **Mapped controls**, list equivalent controls in other frameworks (e.g. `ISO27001:A.5.1, PCI-DSS:1.1`), add tags, tick **Mandatory** if the control cannot be set to Not applicable, and add **Requirements** with a must / should / may level.",
          "Click **Add control**, and repeat for each control of your framework.",
        ],
        tips: ["Use **Create from scratch** to type in your own standard, regulation or internal policy. Use **Build Custom Framework** to assemble a framework from controls that already exist in the library."],
      },
      {
        heading: "Tips",
        tips: [
          "Select controls in a framework and click **Generate with AI** to draft matching policies.",
          "Re-importing a file updates controls with the same reference instead of duplicating them.",
          "Choose your primary framework in **Settings → Framework**.",
        ],
      },
    ],
  },
  {
    id: "requirements",
    route: "/requirements",
    group: "compliance",
    title: "Requirements Referential",
    summary: "One searchable register of every requirement from your standards, regulations, laws and internal policies, with applicability decisions.",
    keywords: ["requirement", "applicability", "not applicable", "SoA", "register", "regulation", "law"],
    sections: [
      {
        heading: "What it’s for",
        body: "The Requirements Referential puts all requirements from all your sources in one list, so you can decide once whether each one applies to you. Requirements without a decision are treated as applicable.",
      },
      {
        heading: "How to record an applicability decision",
        steps: [
          "Search or filter by register, framework, source, domain, type or applicability.",
          "Click a requirement to open its detail, including equivalences and the internal policies that cover it.",
          "Choose **Applicable**, **Not applicable** or **Partially applicable**, and the perimeter (whole organisation, a department or a business process).",
          "Add a justification (required for Not applicable) and a review date, then **Save the decision**.",
        ],
      },
      {
        heading: "Tips",
        tips: ["Use **Open in its register** to jump to the source framework."],
      },
    ],
  },
  {
    id: "action-plan",
    route: "/action-plan",
    group: "compliance",
    title: "Compliance Action Plan",
    summary: "A prioritised to-do board built from all your accepted compliance gaps, tracked from To Do to Done.",
    keywords: ["action plan", "remediation", "kanban", "to do", "gap", "corrective", "preventive", "overdue"],
    sections: [
      {
        heading: "What it’s for",
        body: "When you accept a gap in a compliance assessment, an action appears here. The board shows every action across all assessments in four columns: To Do, In Progress, Done and Cancelled, with an overall progress bar and counts of overdue and blocker items.",
      },
      {
        heading: "How to work through actions",
        steps: [
          "Filter by framework, priority or nature (corrective or preventive).",
          "Drag a card between columns, or use **Start**, **Mark as Done** and **Reopen**.",
          "Open a card to edit the owner, priority, dates, recurrence and notes, and to attach evidence files.",
        ],
      },
      {
        heading: "Tips",
        tips: [
          "Cards marked **BLOCKER** or **(Overdue)** need attention first.",
          "Completing an action can close the related requirement automatically.",
        ],
      },
    ],
  },
  {
    id: "control-effectiveness",
    route: "/control-effectiveness",
    group: "controls",
    title: "Control Effectiveness",
    summary: "Score how well each applied control really works, on five criteria, and follow up the ones found ineffective.",
    keywords: ["effectiveness", "control testing", "evaluation", "four-eyes", "performance", "assurance"],
    sections: [
      {
        heading: "What it’s for",
        body: "Each evaluation scores a control from 0 to 2 on five criteria: Formalism, Control type, Timing, Traceability and Four-eyes principle. The total gives a performance level: performant (8 or more), moderately performant (5–7) or not performant. Available if your organisation has the Elite Pack enabled.",
      },
      {
        heading: "How to evaluate a control",
        steps: [
          "Click **New evaluation** and choose the control.",
          "Score the five criteria.",
          "Say what the evaluation is based on (internal audit, technical test, performance indicator, document review or interview) and add an evidence reference and notes.",
          "Set the next evaluation date and save.",
        ],
      },
      {
        heading: "Tips",
        tips: ["Controls declared ineffective appear in a follow-up list until an action plan is recorded."],
      },
    ],
  },
  {
    id: "applied-controls",
    route: "/applied-controls",
    group: "controls",
    title: "Applied Controls",
    summary: "The register of security controls you have in place or planned, with cost, effort, progress, expiry and sign-off.",
    keywords: ["control", "safeguard", "measure", "implementation", "cost", "sign-off", "expiry", "NIST CSF"],
    sections: [
      {
        heading: "What it’s for",
        body: "Applied controls are the real measures your organisation operates. Each one has a status (planned, in progress, implemented, not applicable, deprecated), cost, progress, expiry date and a sign-off (pending, validated, rejected). Controls can be linked to risk scenarios.",
      },
      {
        heading: "How to add a control",
        steps: [
          "Click **Add Control**.",
          "Enter the reference, name, category and description.",
          "Add effort, cost, recurring cost, ETA and expiry date, and link the risk scenarios it reduces.",
          "Save. An authorised reviewer then clicks **Validate** or **Reject** (with a reason).",
        ],
      },
      {
        heading: "Tips",
        tips: [
          "The **Controls needing attention** panel lists expired, expiring, rejected, never-assessed or unsigned controls.",
          "Deleting a control asks for a justification, and every change is kept in the change history.",
          "A sign-off is flagged when the control was edited after it was signed.",
        ],
      },
    ],
  },
  {
    id: "security-exceptions",
    route: "/security-exceptions",
    group: "controls",
    title: "Exceptions & Waivers",
    summary: "Request, approve and track formal exceptions to security rules and risk acceptances, with compensating controls and expiry dates.",
    keywords: ["exception", "waiver", "risk acceptance", "approval", "compensating control", "expiry"],
    sections: [
      {
        heading: "What it’s for",
        body: "When a rule cannot be met, record an exception instead of ignoring it. Exceptions have a type (risk, control, vulnerability, requirement, asset), severity, justification, compensating controls and an expiration date. Statuses are pending approval, approved, rejected, expired and revoked. A second tab tracks **Risk Acceptances**.",
      },
      {
        heading: "How to request an exception",
        steps: [
          "On **Exceptions**, click **New Exception**.",
          "Enter the title, justification and expiration date (required), plus the description, severity, type and compensating controls.",
          "Save. The exception waits in pending approval.",
          "A CISO opens it and clicks **Approve** or **Reject** (with a reason).",
        ],
      },
      {
        heading: "How to record a risk acceptance",
        steps: [
          "Open the **Risk Acceptances** tab and click **New Risk Acceptance**.",
          "Enter the name, justification and expiration date, then save for approval.",
        ],
      },
      {
        heading: "How risk acceptances work",
        steps: [
          "Click **New Risk Acceptance**, give a name, justification and expiry date, and pick the **Risks accepted** and **Risk scenarios accepted**.",
          "Another CISO approves it (you cannot decide on your own request). On approval each covered risk moves to **Accepted**.",
          "**Reject** or **Revoke** both ask for a reason. Revoking (or the expiry date passing) returns each risk to the status it had before, unless another active acceptance still covers it.",
          "The requester can **Withdraw** their own pending request (a reason is required). Nothing was approved, so no risk changes; the request stays in the register as Withdrawn.",
          "Expiry is applied every day by the automatic check, even if nobody opens this page: an expired acceptance hands its risks back on its own.",
        ],
      },
      {
        heading: "Tips",
        tips: [
          "Four-eyes rule: the person who requested an exception cannot approve it.",
          "Items past their date show an **Expired** badge.",
        ],
      },
    ],
  },

  // ──────────────────────────────── Audit ────────────────────────────────
  {
    id: "audits",
    route: "/audits",
    group: "audit",
    title: "Audits",
    summary: "Plan and run internal, external, certification and regulatory audits: plan, findings, evidence, report approval and release.",
    keywords: ["audit", "finding", "non-conformity", "auditor", "evidence", "audit report", "engagement"],
    sections: [
      {
        heading: "What it’s for",
        body: "Each audit moves through Planning, Fieldwork, Review, Reporting and Closed. An audit can use a framework or an evaluation grid, a perimeter (entities, processes, systems), a lead auditor and a cadence (one-off, annual, every six months — recurring audits are re-planned automatically when closed).",
      },
      {
        heading: "How to create and run an audit",
        steps: [
          "Click **New Audit**, fill in title, type, dates, scope, framework or evaluation grid, lead auditor and cadence, then save.",
          "Open the audit. On **Audit plan**, click **Generate with AI** or write the plan, then **Save the plan**.",
          "On **Findings**, click **New finding** and record type (major or minor non-conformity, observation, improvement opportunity), severity, control, recommendation, owner and due date.",
          "Upload supporting files on **Evidence**, and discuss on **Exchanges** (internal or shared).",
        ],
      },
      {
        heading: "How to produce the report",
        steps: [
          "On **Report**, click **Generate the report**, then **Submit for approval**.",
          "A different person clicks **Approve** or **Reject** (with a reason).",
          "Once approved, download the PDF and click **Release the report** to send it to recipients.",
        ],
      },
      {
        heading: "Tips",
        tips: [
          "Use **Add Auditor** and the **Auditor Accounts** tab to create auditor accounts and assign them to compliance assessments. Auditors sign in to their own Auditor Portal.",
          "Closing a finding requires a note; closed findings cannot be deleted.",
        ],
      },
    ],
  },
  {
    id: "recommendations",
    route: "/recommendations",
    group: "audit",
    title: "Recommendation Tracking",
    summary: "Follow every recommendation issued by an audit until it is effectively closed.",
    keywords: ["recommendation", "audit follow-up", "remediation", "overdue", "closure rate"],
    sections: [
      {
        heading: "What it’s for",
        body: "This page tracks audit recommendations with an owner, due date, priority and progress. Statuses are Pending, In progress, Closed, Rejected and Overdue. KPIs show totals, overdue items and the closure rate, with a dashboard by severity, status and owner.",
      },
      {
        heading: "How to track a recommendation",
        steps: [
          "Recommendations are created inside an audit, on its **Recommendations** tab, with an owner, due date, priority and linked finding.",
          "Update progress with **Edit** as work advances.",
          "Click **Close the recommendation** and add a closure note when it is done.",
          "Click **Refresh statuses** to recalculate statuses from linked actions.",
        ],
      },
      {
        heading: "How to plan actions for a recommendation",
        steps: [
          "Click **Add action** on an open recommendation (CISO). The action is linked to the recommendation's finding.",
          "Its progress feeds the recommendation (e.g. 0/1) and it appears in the **Action Plan** section of the audit report.",
        ],
      },
      {
        heading: "Tips",
        tips: ["Filter by status, owner or audit, or tick **Overdue only** before a follow-up meeting."],
      },
    ],
  },
  {
    id: "audit-grids",
    route: "/audit-grids",
    group: "audit",
    title: "Evaluation Grids",
    summary: "Design your own audit checklists with sections, points to evaluate and a custom conformity scale.",
    keywords: ["evaluation grid", "checklist", "audit template", "conformity scale", "questionnaire"],
    sections: [
      {
        heading: "What it’s for",
        body: "An evaluation grid is the checklist an auditor works through. You can build one from scratch or seed it from a framework, and define the conformity levels used to rate each point. Only admins, CISOs and compliance managers can manage grids.",
      },
      {
        heading: "How to build a grid",
        steps: [
          "Click **New grid** and enter a name and purpose.",
          "Optionally use **Seed from a framework** to copy its controls as editable lines.",
          "Click **Add a line** and enter the reference, point to evaluate and guidance.",
          "Adjust the conformity levels (label in EN/FR/AR, colour, weight, and whether the level opens a gap). **Restore the default levels** returns to Compliant / Partially compliant / Non-compliant / Not applicable.",
        ],
      },
      {
        heading: "Tips",
        tips: ["Select the grid when you create an audit to use it instead of the framework controls."],
      },
    ],
  },

  // ─────────────────────────── Policies & Documents ───────────────────────────
  {
    id: "policies",
    route: "/policies",
    group: "documents",
    title: "Policies",
    summary: "Manage your policies through review, approval and publication, with version history and staff attestations.",
    keywords: ["policy", "procedure", "approval", "version", "attestation", "acknowledgement", "review cycle"],
    sections: [
      {
        heading: "What it’s for",
        body: "Each policy has a category, owner, review cycle (every 6 months, annually or every 2 years), effective and expiration dates and linked controls. Statuses are Draft, In Review, Approved, Published and Retired; overdue reviews are flagged.",
      },
      {
        heading: "How to create and approve a policy",
        steps: [
          "Click **New Policy**, fill in the details and save.",
          "On **Content**, write the text or use **Write with AI**, then **Save New Version** with a change summary.",
          "On **Overview**, use the **Approval Workflow**: **Submit for Review**; once another person has approved the version, **Approve**, then **Publish**.",
        ],
      },
      {
        heading: "How to collect attestations",
        steps: [
          "Open the **Attestations** tab.",
          "Click **Request Attestation**, pick users and a due date, then **Send** — or use **Send to All Users**.",
          "Requests can be sent only once the policy is approved or published and its current version has been approved by a second person. Sending again to someone who already has a pending request does not create a duplicate.",
          "Track each person as Pending, Acknowledged or Overdue.",
        ],
      },
      {
        heading: "Approval rules and retirement",
        steps: [
          "A version cannot be approved by the person who wrote it. In **Version History**, another policy manager or CISO opens the current version and clicks **Approve this version**.",
          "**Approve** and **Publish** appear only once the current version carries that second approval. Adding or restoring a version sends an approved or published policy back to review.",
          "Only the moves allowed from the current status are offered (e.g. **Back to review**, **Retire**). Retiring asks for confirmation and keeps versions and acknowledgements; a retired policy can be revived as a draft.",
          "Employees acknowledge the policies assigned to them from **My Policies**; the **Attestations** tab updates each time you open it. Reminders go out for review dates and overdue acknowledgements.",
        ],
      },
      {
        heading: "How periodic review works",
        steps: [
          "When a policy is published, its **Next review** date is set to today plus its review cycle (unless you chose a date yourself in **Edit details**).",
          "When the date passes, the policy shows **Review due** in the register and on its Overview.",
          "A policy manager or CISO clicks **Mark as reviewed** on the Overview and writes a comment (what was checked, what was decided). The next review moves forward by the cycle, the reminders stop, and the review appears in the **Review history** and the activity log.",
          "**Edit details** changes the title, description, category, owner, review cycle, next review date, effective / expiration dates and department / process — without changing the policy’s status.",
        ],
      },
      {
        heading: "Tips",
        tips: [
          "**Restore version** in Version History brings back an earlier text.",
          "Use **Export PDF** to share a policy outside the platform.",
          "Need a first draft? Click **Open Generator**.",
        ],
      },
    ],
  },
  {
    id: "my-policies",
    route: "/my-policies",
    group: "overview",
    title: "My Policies",
    summary: "The policies you are asked to read and accept, with their text and due date.",
    keywords: ["my policies", "acknowledge", "attestation", "accept", "read"],
    sections: [
      {
        heading: "What it’s for",
        body: "Every user — whatever their role — finds here the policies a manager asked them to acknowledge: pending ones first (overdue ones flagged), then those already accepted.",
      },
      {
        heading: "How to acknowledge a policy",
        steps: [
          "Open **My Policies** from the sidebar.",
          "Auditors find the same list under **My Policies** in the auditor portal.",
          "Click a policy to read the version you were asked to accept.",
          "Click **I have read and accept this policy**. The date is recorded and the policy manager sees it in the Attestations tab.",
        ],
      },
      {
        heading: "Tips",
        tips: [
          "You receive a reminder when an acknowledgement is past its due date.",
        ],
      },
    ],
  },
  {
    id: "policy-generator",
    route: "/policy-generator",
    group: "documents",
    title: "Doc Generator",
    summary: "Generate policies, procedures and plans with AI, tailored to your organisation. Each document is saved as a single versioned policy.",
    keywords: ["AI", "generate", "template", "policy template", "procedure", "BCP", "DRP", "incident response", "SoA"],
    sections: [
      {
        heading: "What it’s for",
        body: "The Doc Generator writes GRC documents for you in four groups: Foundation documents (e.g. information security policy, ISMS scope, SoA), Security policies (access control, acceptable use, passwords, BYOD…), Procedures & standards (incident response, change, backup…) and Plans (BCP, DRP, incident response plan, risk treatment plan).",
      },
      {
        heading: "How to generate a document",
        steps: [
          "Choose the document type.",
          "Fill in your organisation context: company name, size, industry, country, target frameworks, and optionally target controls and special requirements.",
          "Click **Generate Document**. When it finishes, the document is saved automatically, once, as a draft policy. You will find it under **Previously Generated** and in Policies.",
          "Review the result, and edit it if needed. Clicking **Regenerate** for the same document adds a new version to that draft instead of creating another policy.",
          "Click **Save as Draft** to save your edits as a new version of the same policy. The button is greyed out while nothing has changed since the last save.",
          "Click **Approve & Save** to approve the current version and mark the policy as approved. Your name is recorded as the approver.",
        ],
      },
      {
        heading: "How to continue a previous document",
        steps: [
          "In **Previously Generated**, click a document to open its current version.",
          "Edit it, then click **Save as Draft** or **Approve & Save**. Your changes are added as a new version of that document, not saved as a copy.",
        ],
      },
      {
        heading: "Tips",
        tips: [
          "Each generated document produces a single policy with its own version history, so saving several times never creates duplicates. Choosing a different document type starts a new policy.",
          "Approving requires the policy manager or CISO role (or admin).",
          "Use **Copy** or **Download PDF** to reuse the text elsewhere.",
          "Always have an owner review AI output before approving it.",
        ],
      },
    ],
  },
  {
    id: "ocr",
    route: "/ocr",
    group: "documents",
    title: "Document Capture (OCR)",
    summary: "Turn scanned documents and images into searchable text or searchable PDFs.",
    keywords: ["OCR", "scan", "text recognition", "PDF", "image", "searchable PDF", "extract"],
    sections: [
      {
        heading: "What it’s for",
        body: "Document Capture reads PDF, PNG, JPEG and TIFF files and extracts their text in French, English or Arabic. PDFs that already contain text are read directly; each page shows whether it used the text layer or OCR. Available if your organisation has the Elite Pack enabled.",
      },
      {
        heading: "How to extract text",
        steps: [
          "Drag a file onto the page or browse for it.",
          "Choose the document language.",
          "Click **Extract text**.",
          "Use **Copy**, **Download .txt**, **Text PDF** or **Searchable PDF** (the original scan with selectable text).",
        ],
      },
      {
        heading: "Tips",
        tips: ["Clear, straight scans give much better results. Size and page limits apply."],
      },
    ],
  },

  // ─────────────────────────────── Third Parties ───────────────────────────────
  {
    id: "vendors",
    route: "/vendors",
    group: "third_parties",
    title: "3rd Parties (TPRM)",
    summary: "Manage third-party risk: vendor register, prescreen questionnaire, AI contract review with CISO approval, collaboration and risk cartography.",
    keywords: ["vendor", "supplier", "third party", "TPRM", "contract", "DPA", "questionnaire", "due diligence", "e-signature"],
    sections: [
      {
        heading: "What it’s for",
        body: "The register lists every third party with its risk tier (Critical, High, Medium, Low), status, risk score, DPA, contract expiry and services. KPIs highlight the average risk score, missing DPAs and vendors under review.",
      },
      {
        heading: "How to add a third party",
        steps: [
          "Click **Add 3rd Party** and enter the company details, services, tier, status, DPA and contract expiry. You can attach the contract for AI review.",
          "Click **Next: Questionnaire** and answer the 15 prescreen questions on security, compliance and operations.",
          "Click **Analyze with AI**, review the AI insights (risk level, strengths, concerns, red flags) and the suggested risk score, then click **Save 3rd Party**.",
          "If the AI service is unavailable, click **Retry**, or **Continue without AI score**: the answers are saved unscored, you set the risk score yourself, and you can run **Reassess** later. If a later step fails, **Save** again finishes the onboarding without creating a second third party.",
        ],
      },
      {
        heading: "How contract approval works",
        steps: [
          "Upload a contract. The AI analyses it (status **AI Analyzing**, then **Ready for CISO**).",
          "The CISO clicks **Contract Review**, opens the contract, reads the AI findings and clicks **Approve Contract** or **Reject Contract** (comments required to reject).",
          "Once approved, the contract moves to **Ready to send** at the top of **Contract Review**; click **Send to Vendor** there (vendor managers and CISOs). A decision is final for that version — upload a new version to start a new review.",
          "Use **Start Collaboration with Vendor** to negotiate: share a link, work on issues and a plan together, chat, **Mark Agreed**, then both sides sign the agreement by typing their full name.",
        ],
      },
      {
        heading: "How to maintain and offboard a third party",
        steps: [
          "Open a third party and click **Edit** to change its profile, risk tier, status, contract expiry or contact details.",
          "**Upload contract** adds a new contract version: it goes through the same AI review, CISO review and send-to-vendor flow. Set the new contract expiry at the same time — it drives the expiry alerts.",
          "On the **Assessments** tab, **Reassess** runs the prescreen questionnaire again. Every prescreen and approved AI analysis is kept there; the risk score follows the latest one.",
          "**Offboard** ends the relationship with an effective date and a reason (offboarding in progress, or inactive). **Delete** is refused once a contract carries a CISO decision or a signature — offboard instead.",
        ],
      },
      {
        heading: "Tips",
        tips: [
          "Open a vendor’s **Risk Cartography** tab and click **AI Risk Assessment** for a multi-dimension risk view.",
          "The Overview tab warns you when a DPA is missing.",
        ],
      },
    ],
  },

  // ─────────────────────────────── Governance ───────────────────────────────
  {
    id: "governance",
    route: "/governance",
    group: "governance",
    title: "Governance",
    summary: "Define who is responsible for what (RACI), keep a governance document repository with access control, and run steering committees.",
    keywords: ["RACI", "responsibility", "committee", "steering", "document repository", "charter", "minutes"],
    sections: [
      {
        heading: "What it’s for",
        body: "Governance brings together three things: a RACI matrix of activities and decisions, a repository for governance documents (charters, minutes, procedures, plans…) and your steering committees. Available if your organisation has the Elite Pack enabled.",
      },
      {
        heading: "How to fill in the RACI matrix",
        steps: [
          "Enter an **Activity / decision** and choose R, A, C or I.",
          "Choose the responsible party **By role** (or a custom role) or **By group**, and the module, then click **Add**.",
          "Use **Preview role** to see all responsibilities of a role.",
        ],
      },
      {
        heading: "How to manage documents and committees",
        steps: [
          "Click **New document**, enter title, typology, module, access level and content.",
          "Use **Manage access** to grant view, edit or validate rights to a user or role.",
          "Click **New committee** and set its name, cadence, members, next meeting and linked policies and documents.",
        ],
      },
    ],
  },
  {
    id: "regulatory",
    route: "/regulatory",
    group: "governance",
    title: "Regulatory Updates",
    summary: "Track new and changing regulations, their impact and deadlines, with AI proposals to review.",
    keywords: ["regulation", "regulatory change", "law", "deadline", "GDPR", "NIS2", "horizon scanning"],
    sections: [
      {
        heading: "What it’s for",
        body: "Each update records the regulation, source, impact (critical to informational), effective date and deadline. Statuses move from new to under review, action required, and finally implemented or not applicable.",
      },
      {
        heading: "How to track updates",
        steps: [
          "Click **Fetch Latest (AI)** to get proposed updates, then **Approve** or **Reject** each one in **AI Proposals — Pending Your Review**.",
          "Or click **Add Update** and enter the title, source, regulation, impact, dates, URL and description.",
          "Click a row to see details and update its status.",
        ],
      },
      {
        heading: "Tips",
        tips: ["CISOs and admins can click **Draft framework control** to turn an update into a new control in a customised framework."],
      },
    ],
  },
  {
    id: "archiving",
    route: "/archiving",
    group: "governance",
    title: "Archiving & Retention",
    summary: "Archive records with a retention period, consult them without restoring, export the archive, and automate archiving with rules.",
    keywords: ["archive", "retention", "purge", "records management", "export", "integrity"],
    sections: [
      {
        heading: "What it’s for",
        body: "Archiving takes a snapshot of a record (risk, policy, audit, control, assessment, document, vulnerability) with a retention period. You can consult the snapshot, including child findings and evidence files with an integrity check, without restoring it. Available if your organisation has the Elite Pack enabled.",
      },
      {
        heading: "How to archive and export",
        steps: [
          "Click **Archive record**, choose the entity type and record, set the retention in days and give a reason.",
          "Click **Consult** on any archived record to view it read-only.",
          "Use **Export**, **CSV** or **PDF** to download the archive.",
        ],
      },
      {
        heading: "How to automate with rules",
        steps: [
          "In **Archiving rules**, click **New rule**.",
          "Choose the entity, retention and criteria (for example `status=closed AND age_days>365`).",
          "Tick **Start enabled** and save. The table shows the last and next run.",
        ],
      },
      {
        heading: "Tips",
        tips: ["Only administrators can **Purge expired** records, and must type PURGE to confirm."],
      },
    ],
  },
  {
    id: "webhooks",
    route: "/webhooks",
    group: "governance",
    title: "Webhooks",
    summary: "Send real-time event notifications from GRC Eye to your other tools.",
    keywords: ["webhook", "integration", "API", "notification", "events", "SIEM", "Slack", "Teams"],
    sections: [
      {
        heading: "What it’s for",
        body: "A webhook sends a message to an address you choose whenever selected events happen, such as a risk created, an incident resolved, an audit finding added or a policy published. Only tenant administrators can manage webhooks.",
      },
      {
        heading: "How to add a webhook",
        steps: [
          "Click **Add Webhook**.",
          "Enter the webhook URL and a description.",
          "Tick at least one event (you can select a whole module at once), then **Create Webhook**.",
          "Click **Test** to send a test ping and check the response.",
        ],
      },
      {
        heading: "Tips",
        tips: ["Webhooks cannot be edited; delete and recreate one to change its events."],
      },
    ],
  },

  // ─────────────────────────────── Reports & Support ───────────────────────────────
  {
    id: "reports",
    route: "/reports",
    group: "reporting",
    title: "Reports",
    summary: "Generate, preview and download PDF reports, and schedule them to be emailed automatically.",
    keywords: ["report", "PDF", "executive summary", "weekly report", "schedule", "email", "download"],
    sections: [
      {
        heading: "What it’s for",
        body: "Five PDF reports are available: Executive Summary, Risk Register Report, Compliance Report, 3rd Party Risk Report and Audit Report. They are built live and cover the last 7 days. Each generated report is kept in a history with an integrity fingerprint.",
      },
      {
        heading: "How to get a report",
        steps: [
          "Click **Preview** on a report card to view it in the page.",
          "Click **Download** to save the PDF.",
          "Use the history button to find earlier versions.",
        ],
      },
      {
        heading: "How to schedule a report",
        steps: [
          "In **Automated Reports**, click **New Schedule**.",
          "Enter a name, report type, frequency (daily, weekly, monthly), time and day.",
          "Add recipient emails, tick **Enabled** and save. Use **Run now** to send it immediately.",
        ],
        tips: ["Scheduled reports are an Elite Pack feature."],
      },
    ],
  },
  {
    id: "support",
    route: "/support",
    group: "reporting",
    title: "Support",
    summary: "Open support tickets, follow replies and chat live with the support team.",
    keywords: ["help", "ticket", "support request", "contact", "live chat", "bug"],
    sections: [
      {
        heading: "What it’s for",
        body: "Support lets you submit and track requests to the GRC Eye team. Tickets move through Open, In Progress, Waiting User, Resolved and Closed.",
      },
      {
        heading: "How to open a ticket",
        steps: [
          "Click **New Ticket**.",
          "Enter a title, a clear description and a priority (Low, Medium, High, Urgent), then **Submit Ticket**.",
          "Open the ticket to read replies and answer with **Send**.",
        ],
      },
      {
        heading: "Tips",
        tips: [
          "When support starts a live chat, click **Accept** to join it.",
          "A **New reply** badge and a bell notification tell you when support has answered.",
        ],
      },
    ],
  },

  // ─────────────────────────────── Account ───────────────────────────────
  {
    id: "settings",
    route: "/settings",
    group: "account",
    title: "Settings",
    summary: "Your profile, workspace frameworks, notification preferences, password and security, AI access and appearance.",
    keywords: ["settings", "profile", "password", "notifications", "theme", "dark mode", "LDAP", "Active Directory", "sessions"],
    sections: [
      {
        heading: "What’s in Settings",
        body: "**Profile** shows your name and email (managed by your administrator). **Framework** sets your primary and secondary frameworks. **Notifications** controls email and in-app alerts per event. **Security** lets you change your password, set up or turn off two-factor login (turning it off asks for a current code from your app) and revoke active sessions. **AI Access** shows your monthly AI usage. **Appearance** changes theme, accent colour, font size and density on this browser.",
      },
      {
        heading: "How to change your password",
        steps: [
          "Open **Settings → Security**.",
          "Enter your current password and the new one twice.",
          "Click **Update password**.",
        ],
      },
      {
        heading: "How to set your frameworks",
        steps: [
          "Open **Settings → Framework**.",
          "Choose one primary framework and any secondary ones, then save.",
        ],
        tips: ["Only admins, CISOs, compliance managers and policy managers can change workspace frameworks."],
      },
      {
        heading: "Tips",
        tips: ["Tenant admins can connect a company directory (AD/LDAP) in the **Directory** tab so staff sign in with their company account."],
      },
    ],
  },
  {
    id: "mfa-setup",
    route: "/mfa-setup",
    group: "account",
    title: "Two-factor login",
    summary: "Protect your account with a 6-digit code from an authenticator app in addition to your password.",
    keywords: ["MFA", "2FA", "two-factor", "TOTP", "authenticator", "security", "login code"],
    sections: [
      {
        heading: "What it’s for",
        body: "Two-factor login means a stolen password is not enough to get into your account. After you enter your password you will also be asked for a code from an authenticator app such as Google Authenticator or Microsoft Authenticator. You can also reach this from **Settings → Security**.",
      },
      {
        heading: "How to turn it on",
        steps: [
          "Click **Enable 2FA**.",
          "Scan the QR code with your authenticator app (or copy the secret key into it).",
          "Enter the 6-digit code shown in the app and click **Verify & enable**.",
        ],
      },
      {
        heading: "How signing in works",
        steps: [
          "Enter your email and password as usual.",
          "On the **Two-factor verification** screen, enter the current 6-digit code and click **Verify**.",
          "If the code is refused, wait for the next code and try again, or click **Back to sign in**.",
        ],
      },
      {
        heading: "How to turn it off",
        steps: [
          "Where it says **Two-factor authentication is enabled**, click **Disable**.",
          "Enter the current 6-digit code from your authenticator app and click **Turn off two-factor**. Click **Cancel** to keep it on.",
          "If the code is refused as invalid or expired, wait for the next code in the app and try again.",
        ],
      },
      {
        heading: "Tips",
        tips: ["Two-factor can only be turned off with a valid code from your app. If you lose your phone, ask your administrator for help regaining access."],
      },
    ],
  },
  {
    id: "company-admin",
    route: "/company-admin",
    group: "account",
    title: "Team Management",
    summary: "Invite team members, assign roles and organise people into groups. For tenant administrators only.",
    keywords: ["users", "team", "invite", "roles", "permissions", "groups", "reset password", "deactivate"],
    sections: [
      {
        heading: "What it’s for",
        body: "Team Management is where your organisation’s administrator creates accounts and decides what each person can see and do. Only tenant administrators can open it; the link is at the bottom of the sidebar.",
      },
      {
        heading: "How to invite a member",
        steps: [
          "Click **Invite Member**.",
          "Enter first name, last name and email, and choose one or more roles (e.g. CISO, Risk Manager, Compliance Manager, Auditor, Viewer).",
          "Click **Create Account** and copy the temporary password. It is shown only once — send it to the person securely.",
        ],
      },
      {
        heading: "How to manage access",
        steps: [
          "Use the row actions to edit roles, reset a password, activate or deactivate, or delete a user.",
          "On **Groups**, click **Create Group**, add members and choose the roles the group grants.",
          "Use **Custom Rules** in a user’s roles to exclude a role they would otherwise get from a group.",
        ],
      },
      {
        heading: "Tips",
        tips: ["The **Role Access Reference** explains what each role can do; the **Activity Logs** tab shows what each member has done."],
      },
    ],
  },
];
