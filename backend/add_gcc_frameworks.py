"""
Migration script: Add NCA ECC-2:2024 and other GCC/Middle East frameworks.
Run from the backend/ directory:
    python add_gcc_frameworks.py
"""

import sqlite3
import uuid
from datetime import datetime

DB_PATH = "grc_dev.db"
NOW = datetime.utcnow().isoformat()


def uid():
    return str(uuid.uuid4())


def insert_framework(cur, name, short_name, version, description, issuing_body, regions, industries):
    fid = uid()
    cur.execute(
        """INSERT INTO frameworks
           (id, name, short_name, version, description, issuing_body,
            applicable_regions, applicable_industries, status, is_builtin,
            tenant_id, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,'active',1,NULL,?,?)""",
        (fid, name, short_name, version, description, issuing_body,
         regions, industries, NOW, NOW),
    )
    return fid


def insert_control(cur, framework_id, control_id, title, description, category,
                   parent_id=None, sort_order=0, guidance="", tags="[]", is_mandatory=1):
    cur.execute(
        """INSERT INTO framework_controls
           (id, framework_id, control_id, title, description, guidance,
            category, parent_id, sort_order, mapped_controls, tags,
            is_mandatory, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (uid(), framework_id, control_id, title, description, guidance,
         category, parent_id, sort_order, "[]", tags, is_mandatory, NOW, NOW),
    )


# ─────────────────────────────────────────────────────────────
# ECC-2:2024  –  NCA Essential Cybersecurity Controls 2024
# ─────────────────────────────────────────────────────────────
ECC2_CONTROLS = {
    # Domain 1 – Cybersecurity Governance
    "1": {
        "title": "Cybersecurity Governance",
        "subdomains": {
            "1-1": {
                "title": "Cybersecurity Strategy",
                "controls": {
                    "1-1-1": "Develop a cybersecurity strategy aligned with the organization's business objectives and risk appetite",
                    "1-1-2": "Obtain senior management approval and sponsorship for the cybersecurity strategy",
                    "1-1-3": "Review and update the cybersecurity strategy periodically and when significant changes occur",
                },
            },
            "1-2": {
                "title": "Cybersecurity Management",
                "controls": {
                    "1-2-1": "Establish a cybersecurity management function with defined roles and responsibilities",
                    "1-2-2": "Designate a Chief Information Security Officer (CISO) or equivalent role",
                    "1-2-3": "Establish a cybersecurity steering committee or governance body",
                },
            },
            "1-3": {
                "title": "Cybersecurity Policies and Procedures",
                "controls": {
                    "1-3-1": "Develop and maintain a comprehensive cybersecurity policy framework",
                    "1-3-2": "Ensure cybersecurity policies are reviewed and approved by senior management",
                    "1-3-3": "Communicate cybersecurity policies to all relevant stakeholders",
                    "1-3-4": "Review and update cybersecurity policies at least annually",
                },
            },
            "1-4": {
                "title": "Cybersecurity Roles and Responsibilities",
                "controls": {
                    "1-4-1": "Define and document cybersecurity roles and responsibilities for all staff",
                    "1-4-2": "Integrate cybersecurity responsibilities into job descriptions and performance evaluations",
                },
            },
            "1-5": {
                "title": "Cybersecurity Risk Management",
                "controls": {
                    "1-5-1": "Establish and maintain a cybersecurity risk management framework",
                    "1-5-2": "Conduct periodic cybersecurity risk assessments",
                    "1-5-3": "Maintain a cybersecurity risk register with risk treatment plans",
                    "1-5-4": "Report cybersecurity risks to senior management regularly",
                },
            },
            "1-6": {
                "title": "Cybersecurity in IT Project Management",
                "controls": {
                    "1-6-1": "Integrate cybersecurity requirements into the IT project management lifecycle",
                    "1-6-2": "Conduct cybersecurity risk assessments for all significant IT projects",
                    "1-6-3": "Include cybersecurity acceptance criteria in project delivery gates",
                    "1-6-4": "Ensure cybersecurity testing is performed before system deployment",
                },
            },
            "1-7": {
                "title": "Compliance with Cybersecurity Standards, Laws and Regulations",
                "controls": {
                    "1-7-1": "Identify and comply with applicable cybersecurity laws, regulations, and standards including NCA regulations",
                },
            },
            "1-8": {
                "title": "Periodical Cybersecurity Review and Audit",
                "controls": {
                    "1-8-1": "Conduct periodic cybersecurity compliance reviews and audits",
                    "1-8-2": "Engage qualified internal or external auditors for cybersecurity assessments",
                    "1-8-3": "Track and remediate audit findings within agreed timelines",
                },
            },
            "1-9": {
                "title": "Cybersecurity in Human Resources",
                "controls": {
                    "1-9-1": "Perform background checks for employees and contractors with access to critical systems",
                    "1-9-2": "Include cybersecurity responsibilities in employment contracts and NDAs",
                    "1-9-3": "Conduct cybersecurity onboarding for all new employees",
                    "1-9-4": "Manage cybersecurity access rights during role changes",
                    "1-9-5": "Revoke access rights upon employment termination",
                    "1-9-6": "Conduct exit procedures to recover assets and handle knowledge transfer securely",
                },
            },
            "1-10": {
                "title": "Cybersecurity Awareness and Training Program",
                "controls": {
                    "1-10-1": "Establish a cybersecurity awareness and training program for all staff",
                    "1-10-2": "Deliver role-based cybersecurity training for staff with specific security responsibilities",
                    "1-10-3": "Conduct periodic phishing simulations and social engineering awareness exercises",
                    "1-10-4": "Track completion of cybersecurity training and report to management",
                    "1-10-5": "Review and update training content at least annually",
                },
            },
        },
    },
    # Domain 2 – Cybersecurity Defense
    "2": {
        "title": "Cybersecurity Defense",
        "subdomains": {
            "2-1": {
                "title": "Asset Management",
                "controls": {
                    "2-1-1": "Maintain a comprehensive and up-to-date inventory of all IT assets",
                    "2-1-2": "Classify assets based on criticality and sensitivity",
                    "2-1-3": "Assign ownership and custodianship to all assets",
                    "2-1-4": "Manage the full lifecycle of assets from procurement to disposal",
                    "2-1-5": "Implement secure disposal procedures for decommissioned assets",
                    "2-1-6": "Review and update the asset inventory at least annually",
                },
            },
            "2-2": {
                "title": "Identity and Access Management",
                "controls": {
                    "2-2-1": "Implement a formal access control policy and procedures",
                    "2-2-2": "Enforce the principle of least privilege and need-to-know for all access",
                    "2-2-3": "Implement multi-factor authentication for privileged and remote access",
                    "2-2-4": "Review and recertify user access rights periodically",
                },
            },
            "2-3": {
                "title": "Information System and Processing Facilities Protection",
                "controls": {
                    "2-3-1": "Implement hardening standards for all operating systems and applications",
                    "2-3-2": "Manage and apply security patches in a timely manner",
                    "2-3-3": "Deploy endpoint protection including anti-malware solutions",
                    "2-3-4": "Control the use of removable media and portable storage devices",
                },
            },
            "2-4": {
                "title": "Email Protection",
                "controls": {
                    "2-4-1": "Implement email filtering to detect and block malicious emails",
                    "2-4-2": "Configure email authentication protocols (SPF, DKIM, DMARC)",
                    "2-4-3": "Protect against phishing, spam, and email-borne malware",
                    "2-4-4": "Monitor and log email traffic for security events",
                },
            },
            "2-5": {
                "title": "Networks Security Management",
                "controls": {
                    "2-5-1": "Implement network segmentation to isolate critical systems",
                    "2-5-2": "Deploy and manage firewalls and intrusion prevention systems",
                    "2-5-3": "Secure wireless networks with strong encryption and authentication",
                    "2-5-4": "Monitor network traffic for anomalies and security events",
                },
            },
            "2-6": {
                "title": "Mobile Devices Security",
                "controls": {
                    "2-6-1": "Establish a mobile device management (MDM) policy and solution",
                    "2-6-2": "Enforce encryption and screen lock on all mobile devices",
                    "2-6-3": "Enable remote wipe capability for lost or stolen mobile devices",
                    "2-6-4": "Control the installation of applications on managed mobile devices",
                },
            },
            "2-7": {
                "title": "Data and Information Protection",
                "controls": {
                    "2-7-1": "Classify data based on sensitivity and apply appropriate protection controls",
                    "2-7-2": "Implement data loss prevention (DLP) controls for sensitive data",
                    "2-7-3": "Manage data retention and secure deletion according to policy",
                },
            },
            "2-8": {
                "title": "Cryptography",
                "controls": {
                    "2-8-1": "Establish a cryptography policy covering key algorithms and key management",
                    "2-8-2": "Encrypt sensitive data at rest using approved cryptographic algorithms",
                    "2-8-3": "Encrypt sensitive data in transit using secure protocols (TLS 1.2+)",
                    "2-8-4": "Implement formal cryptographic key management procedures",
                },
            },
            "2-9": {
                "title": "Backup and Recovery Management",
                "controls": {
                    "2-9-1": "Define and implement backup procedures for all critical systems and data",
                    "2-9-2": "Store backup copies securely offsite or in a separate network segment",
                    "2-9-3": "Test backup restoration procedures periodically",
                    "2-9-4": "Define and document recovery time objectives (RTO) and recovery point objectives (RPO)",
                },
            },
            "2-10": {
                "title": "Vulnerabilities Management",
                "controls": {
                    "2-10-1": "Conduct regular vulnerability assessments across all systems",
                    "2-10-2": "Prioritize and remediate vulnerabilities based on risk and criticality",
                    "2-10-3": "Subscribe to threat intelligence feeds and security advisories",
                    "2-10-4": "Track vulnerability remediation progress and report to management",
                },
            },
            "2-11": {
                "title": "Penetration Testing",
                "controls": {
                    "2-11-1": "Conduct penetration testing at least annually on critical systems",
                    "2-11-2": "Engage qualified internal or third-party testers for penetration tests",
                    "2-11-3": "Document and remediate findings from penetration tests",
                    "2-11-4": "Perform re-testing to validate remediation of critical findings",
                },
            },
            "2-12": {
                "title": "Cybersecurity Event Logs and Monitoring Management",
                "controls": {
                    "2-12-1": "Implement centralized logging for all critical systems and security devices",
                    "2-12-2": "Define and configure security event alerting thresholds",
                    "2-12-3": "Protect log integrity and ensure logs are retained per policy",
                    "2-12-4": "Review security logs and alerts regularly",
                },
            },
            "2-13": {
                "title": "Cybersecurity Incident and Threat Management",
                "controls": {
                    "2-13-1": "Establish and maintain a cybersecurity incident response plan",
                    "2-13-2": "Define incident classification, escalation, and notification procedures",
                    "2-13-3": "Report significant cybersecurity incidents to NCA within defined timelines",
                    "2-13-4": "Conduct post-incident reviews and implement lessons learned",
                },
            },
            "2-14": {
                "title": "Physical Security",
                "controls": {
                    "2-14-1": "Control physical access to data centers and server rooms",
                    "2-14-2": "Implement environmental controls (power, cooling, fire suppression) in facilities",
                    "2-14-3": "Monitor physical access using CCTV and access logs",
                    "2-14-4": "Conduct periodic reviews of physical access rights",
                },
            },
            "2-15": {
                "title": "Web Application Security",
                "controls": {
                    "2-15-1": "Follow secure development lifecycle (SDLC) practices for web applications",
                    "2-15-2": "Conduct security testing (SAST/DAST) for all web applications before deployment",
                    "2-15-3": "Deploy web application firewalls (WAF) for internet-facing applications",
                    "2-15-4": "Protect against OWASP Top 10 and other common web vulnerabilities",
                },
            },
        },
    },
    # Domain 3 – Cybersecurity Resilience
    "3": {
        "title": "Cybersecurity Resilience",
        "subdomains": {
            "3-1": {
                "title": "Cybersecurity Resilience Aspects of Business Continuity Management (BCM)",
                "controls": {
                    "3-1-1": "Integrate cybersecurity requirements into the Business Continuity Plan (BCP)",
                    "3-1-2": "Develop and test a Disaster Recovery Plan (DRP) for critical IT systems",
                    "3-1-3": "Conduct periodic BCM and DRP exercises that include cybersecurity scenarios",
                    "3-1-4": "Review and update BCM/DRP plans at least annually or after significant incidents",
                },
            },
        },
    },
    # Domain 4 – Third-Party and Cloud Computing Cybersecurity
    "4": {
        "title": "Third-Party and Cloud Computing Cybersecurity",
        "subdomains": {
            "4-1": {
                "title": "Third-Party Cybersecurity",
                "controls": {
                    "4-1-1": "Assess and manage cybersecurity risks associated with third-party suppliers",
                    "4-1-2": "Include cybersecurity requirements in contracts with third parties",
                    "4-1-3": "Monitor and review third-party cybersecurity compliance periodically",
                    "4-1-4": "Manage third-party access to organizational systems securely",
                },
            },
            "4-2": {
                "title": "Cloud Computing and Hosting Cybersecurity",
                "controls": {
                    "4-2-1": "Assess cybersecurity risks before adopting cloud services",
                    "4-2-2": "Ensure cloud service agreements include cybersecurity requirements",
                    "4-2-3": "Implement controls for data protection and sovereignty in cloud environments",
                    "4-2-4": "Monitor cloud environments for security events and misconfigurations",
                },
            },
        },
    },
}

# ─────────────────────────────────────────────────────────────
# UAE NESA National Information Assurance (IAS) Standard
# ─────────────────────────────────────────────────────────────
UAE_NESA_CONTROLS = {
    "IS-1": {
        "title": "Information Security Policy",
        "controls": {
            "IS-1.1": "Develop, approve, and communicate an information security policy",
            "IS-1.2": "Review information security policy at planned intervals",
            "IS-1.3": "Align information security policy with UAE national cybersecurity strategy",
        },
    },
    "IS-2": {
        "title": "Organization of Information Security",
        "controls": {
            "IS-2.1": "Define information security roles and responsibilities",
            "IS-2.2": "Establish an information security steering committee",
            "IS-2.3": "Maintain contact with UAE authorities and special interest groups",
            "IS-2.4": "Address information security in project management",
        },
    },
    "IS-3": {
        "title": "Human Resource Security",
        "controls": {
            "IS-3.1": "Screen candidates before employment per UAE regulations",
            "IS-3.2": "Communicate security responsibilities through employment terms",
            "IS-3.3": "Provide security awareness, education, and training",
            "IS-3.4": "Apply disciplinary process for security policy violations",
            "IS-3.5": "Terminate or change employment securely",
        },
    },
    "IS-4": {
        "title": "Asset Management",
        "controls": {
            "IS-4.1": "Inventory of assets — identify and document all information assets",
            "IS-4.2": "Ownership of assets — assign ownership to all assets",
            "IS-4.3": "Acceptable use of assets — define rules for acceptable use",
            "IS-4.4": "Return of assets — ensure return upon termination",
            "IS-4.5": "Classification of information — classify based on legal requirements and sensitivity",
            "IS-4.6": "Labeling of information — implement labeling procedures",
            "IS-4.7": "Handling of assets — develop handling procedures per classification",
            "IS-4.8": "Media handling — manage removable media securely",
            "IS-4.9": "Disposal of media — dispose of media securely",
        },
    },
    "IS-5": {
        "title": "Access Control",
        "controls": {
            "IS-5.1": "Access control policy — establish and document",
            "IS-5.2": "Access to networks and network services — control access",
            "IS-5.3": "User registration and de-registration procedures",
            "IS-5.4": "User access provisioning and periodic review",
            "IS-5.5": "Management of privileged access rights",
            "IS-5.6": "Management of secret authentication information",
            "IS-5.7": "Use of secret authentication information (passwords)",
            "IS-5.8": "Information access restriction based on access policy",
        },
    },
    "IS-6": {
        "title": "Cryptography",
        "controls": {
            "IS-6.1": "Policy on the use of cryptographic controls",
            "IS-6.2": "Key management — protect and manage cryptographic keys",
        },
    },
    "IS-7": {
        "title": "Physical and Environmental Security",
        "controls": {
            "IS-7.1": "Physical security perimeter — define and protect secure areas",
            "IS-7.2": "Physical entry controls — secure access to sensitive areas",
            "IS-7.3": "Securing offices, rooms, and facilities",
            "IS-7.4": "Protecting against external and environmental threats",
            "IS-7.5": "Equipment siting and protection",
            "IS-7.6": "Supporting utilities (power, HVAC, etc.)",
            "IS-7.7": "Cabling security — protect power and telecommunications cabling",
            "IS-7.8": "Equipment maintenance — maintain equipment to ensure availability",
            "IS-7.9": "Secure disposal or reuse of equipment",
            "IS-7.10": "Clear desk and clear screen policy",
        },
    },
    "IS-8": {
        "title": "Operations Security",
        "controls": {
            "IS-8.1": "Documented operating procedures",
            "IS-8.2": "Change management — control changes to systems",
            "IS-8.3": "Capacity management",
            "IS-8.4": "Separation of development, testing, and operational environments",
            "IS-8.5": "Controls against malware",
            "IS-8.6": "Information backup",
            "IS-8.7": "Event logging and monitoring",
            "IS-8.8": "Protection of log information",
            "IS-8.9": "Technical vulnerability management",
        },
    },
    "IS-9": {
        "title": "Communications Security",
        "controls": {
            "IS-9.1": "Network controls — manage and control networks",
            "IS-9.2": "Security of network services",
            "IS-9.3": "Segregation in networks",
            "IS-9.4": "Information transfer policies and procedures",
            "IS-9.5": "Agreements on information transfer",
            "IS-9.6": "Electronic messaging security",
            "IS-9.7": "Confidentiality or non-disclosure agreements",
        },
    },
    "IS-10": {
        "title": "System Acquisition, Development and Maintenance",
        "controls": {
            "IS-10.1": "Security requirements analysis and specification",
            "IS-10.2": "Securing application services on public networks",
            "IS-10.3": "Security in development and support processes",
            "IS-10.4": "System change control procedures",
            "IS-10.5": "Technical review of applications after operating platform changes",
            "IS-10.6": "Test data — protect and control test data",
        },
    },
    "IS-11": {
        "title": "Supplier Relationships",
        "controls": {
            "IS-11.1": "Information security policy for supplier relationships",
            "IS-11.2": "Addressing security within supplier agreements",
            "IS-11.3": "ICT supply chain security",
            "IS-11.4": "Monitoring and review of supplier services",
            "IS-11.5": "Managing changes to supplier services",
        },
    },
    "IS-12": {
        "title": "Information Security Incident Management",
        "controls": {
            "IS-12.1": "Responsibilities and procedures for incident management",
            "IS-12.2": "Reporting information security events",
            "IS-12.3": "Reporting information security weaknesses",
            "IS-12.4": "Assessment and decision on information security events",
            "IS-12.5": "Response to information security incidents",
            "IS-12.6": "Learning from information security incidents",
            "IS-12.7": "Collection of evidence",
        },
    },
    "IS-13": {
        "title": "Information Security Aspects of BCM",
        "controls": {
            "IS-13.1": "Planning information security continuity",
            "IS-13.2": "Implementing information security continuity",
            "IS-13.3": "Verify, review, and evaluate information security continuity",
            "IS-13.4": "Availability of information processing facilities",
        },
    },
    "IS-14": {
        "title": "Compliance",
        "controls": {
            "IS-14.1": "Identification of applicable laws and contractual requirements",
            "IS-14.2": "Intellectual property rights",
            "IS-14.3": "Protection of records",
            "IS-14.4": "Privacy and protection of personally identifiable information (UAE PDPL)",
            "IS-14.5": "Regulation of cryptographic controls",
            "IS-14.6": "Independent review of information security",
            "IS-14.7": "Compliance with security policies and standards",
        },
    },
}

# ─────────────────────────────────────────────────────────────
# Dubai DESC ISR (Information Security Regulation) v2
# ─────────────────────────────────────────────────────────────
DESC_ISR_CONTROLS = {
    "ISR-1": {
        "title": "Security Governance",
        "controls": {
            "ISR-1.1": "Establish an information security management framework aligned with DESC ISR",
            "ISR-1.2": "Define roles, responsibilities, and accountability for information security",
            "ISR-1.3": "Establish an information security steering committee with senior management representation",
            "ISR-1.4": "Conduct annual information security risk assessments",
        },
    },
    "ISR-2": {
        "title": "Security Risk Management",
        "controls": {
            "ISR-2.1": "Implement a risk management methodology aligned with international standards",
            "ISR-2.2": "Maintain a risk register with treatment plans and ownership",
            "ISR-2.3": "Report risk status to senior management quarterly",
        },
    },
    "ISR-3": {
        "title": "Security Policies and Procedures",
        "controls": {
            "ISR-3.1": "Develop a comprehensive set of information security policies",
            "ISR-3.2": "Review and update policies annually or after significant changes",
            "ISR-3.3": "Communicate policies to all employees and relevant stakeholders",
        },
    },
    "ISR-4": {
        "title": "Human Resources Security",
        "controls": {
            "ISR-4.1": "Pre-employment screening and background checks",
            "ISR-4.2": "Security awareness and training programs",
            "ISR-4.3": "Disciplinary process for security violations",
            "ISR-4.4": "Offboarding and access revocation procedures",
        },
    },
    "ISR-5": {
        "title": "Asset Management",
        "controls": {
            "ISR-5.1": "Maintain an inventory of information assets",
            "ISR-5.2": "Classify and label information assets",
            "ISR-5.3": "Secure handling and disposal of assets",
        },
    },
    "ISR-6": {
        "title": "Access Control",
        "controls": {
            "ISR-6.1": "Implement access control policy based on least privilege",
            "ISR-6.2": "Manage privileged access and administrative accounts",
            "ISR-6.3": "Enforce multi-factor authentication for critical systems",
            "ISR-6.4": "Review access rights regularly and revoke promptly upon termination",
        },
    },
    "ISR-7": {
        "title": "Physical and Environmental Security",
        "controls": {
            "ISR-7.1": "Protect data centers and server rooms with physical access controls",
            "ISR-7.2": "Implement environmental monitoring and controls",
            "ISR-7.3": "Secure offices and workspaces against unauthorized access",
        },
    },
    "ISR-8": {
        "title": "Operations Security",
        "controls": {
            "ISR-8.1": "Manage and document operational procedures",
            "ISR-8.2": "Implement change management controls",
            "ISR-8.3": "Deploy and maintain anti-malware solutions",
            "ISR-8.4": "Implement backup and recovery procedures",
            "ISR-8.5": "Manage technical vulnerabilities and patches",
        },
    },
    "ISR-9": {
        "title": "Network Security",
        "controls": {
            "ISR-9.1": "Implement network security architecture with segmentation",
            "ISR-9.2": "Deploy firewalls, IPS/IDS at network perimeters",
            "ISR-9.3": "Secure wireless network access",
            "ISR-9.4": "Monitor network traffic and security events",
        },
    },
    "ISR-10": {
        "title": "Incident Management",
        "controls": {
            "ISR-10.1": "Establish an incident response plan and team",
            "ISR-10.2": "Define incident classification, reporting, and escalation procedures",
            "ISR-10.3": "Report significant incidents to DESC within required timelines",
            "ISR-10.4": "Conduct post-incident reviews and implement improvements",
        },
    },
    "ISR-11": {
        "title": "Business Continuity and Disaster Recovery",
        "controls": {
            "ISR-11.1": "Develop and maintain a Business Continuity Plan (BCP)",
            "ISR-11.2": "Develop and maintain a Disaster Recovery Plan (DRP)",
            "ISR-11.3": "Test BCP/DRP at least annually",
            "ISR-11.4": "Ensure RTO/RPO objectives are defined and achievable",
        },
    },
    "ISR-12": {
        "title": "Third-Party and Cloud Security",
        "controls": {
            "ISR-12.1": "Assess and manage third-party security risks",
            "ISR-12.2": "Include security requirements in third-party contracts",
            "ISR-12.3": "Evaluate cloud service providers against DESC requirements",
            "ISR-12.4": "Ensure data sovereignty and residency requirements are met within UAE/Dubai",
        },
    },
    "ISR-13": {
        "title": "Compliance and Audit",
        "controls": {
            "ISR-13.1": "Conduct periodic compliance assessments against DESC ISR",
            "ISR-13.2": "Engage independent auditors for information security reviews",
            "ISR-13.3": "Report compliance status to DESC as required",
            "ISR-13.4": "Manage and remediate audit findings within agreed timelines",
        },
    },
}

# ─────────────────────────────────────────────────────────────
# Qatar NIA Cybersecurity Framework
# ─────────────────────────────────────────────────────────────
QATAR_NIA_CONTROLS = {
    "QCF-1": {
        "title": "Identify",
        "controls": {
            "QCF-1.1": "Asset Management — identify and prioritize all organizational assets",
            "QCF-1.2": "Business Environment — understand organization's mission and critical functions",
            "QCF-1.3": "Governance — establish cybersecurity policies and governance structures",
            "QCF-1.4": "Risk Assessment — identify and prioritize cybersecurity risks",
            "QCF-1.5": "Risk Management Strategy — establish risk tolerance and management approach",
            "QCF-1.6": "Supply Chain Risk Management — manage third-party cybersecurity risks",
        },
    },
    "QCF-2": {
        "title": "Protect",
        "controls": {
            "QCF-2.1": "Identity Management and Access Control — limit access to assets",
            "QCF-2.2": "Awareness and Training — provide cybersecurity awareness to personnel",
            "QCF-2.3": "Data Security — protect data at rest and in transit",
            "QCF-2.4": "Information Protection Processes and Procedures",
            "QCF-2.5": "Maintenance — maintain security of industrial control and information systems",
            "QCF-2.6": "Protective Technology — deploy technical security solutions",
        },
    },
    "QCF-3": {
        "title": "Detect",
        "controls": {
            "QCF-3.1": "Anomalies and Events — detect anomalous activity",
            "QCF-3.2": "Security Continuous Monitoring — monitor information systems",
            "QCF-3.3": "Detection Processes — maintain detection processes and procedures",
        },
    },
    "QCF-4": {
        "title": "Respond",
        "controls": {
            "QCF-4.1": "Response Planning — maintain and execute incident response plans",
            "QCF-4.2": "Communications — coordinate response activities with stakeholders",
            "QCF-4.3": "Analysis — ensure adequate response and recovery from incidents",
            "QCF-4.4": "Mitigation — contain incidents and mitigate effects",
            "QCF-4.5": "Improvements — incorporate lessons learned into response strategies",
        },
    },
    "QCF-5": {
        "title": "Recover",
        "controls": {
            "QCF-5.1": "Recovery Planning — execute and maintain recovery plans",
            "QCF-5.2": "Improvements — improve recovery plans based on lessons learned",
            "QCF-5.3": "Communications — coordinate restoration activities with stakeholders",
        },
    },
    "QCF-6": {
        "title": "Qatar-Specific Requirements",
        "controls": {
            "QCF-6.1": "Compliance with Qatar National Cybersecurity Strategy",
            "QCF-6.2": "Data residency — ensure sensitive data is stored within Qatar where required",
            "QCF-6.3": "Report significant cybersecurity incidents to NIA within required timelines",
            "QCF-6.4": "Participate in national cybersecurity exercises and information sharing",
        },
    },
}

# ─────────────────────────────────────────────────────────────
# Bahrain ISR (Information Security Regulation by CBB)
# ─────────────────────────────────────────────────────────────
BAHRAIN_ISR_CONTROLS = {
    "BH-ISR-1": {
        "title": "Information Security Governance",
        "controls": {
            "BH-ISR-1.1": "Establish information security governance structure per CBB requirements",
            "BH-ISR-1.2": "Define and document information security strategy",
            "BH-ISR-1.3": "Assign CISO or equivalent role with appropriate authority",
            "BH-ISR-1.4": "Report information security status to board and senior management",
        },
    },
    "BH-ISR-2": {
        "title": "Risk Management",
        "controls": {
            "BH-ISR-2.1": "Implement an information security risk management framework",
            "BH-ISR-2.2": "Conduct annual risk assessments covering all critical systems",
            "BH-ISR-2.3": "Maintain a risk register and treatment plan",
            "BH-ISR-2.4": "Review and update risk assessments when significant changes occur",
        },
    },
    "BH-ISR-3": {
        "title": "Security Controls",
        "controls": {
            "BH-ISR-3.1": "Implement access control based on least privilege principle",
            "BH-ISR-3.2": "Deploy multi-factor authentication for remote and privileged access",
            "BH-ISR-3.3": "Manage cryptographic controls and key management",
            "BH-ISR-3.4": "Implement network security including segmentation and monitoring",
            "BH-ISR-3.5": "Manage vulnerabilities and apply security patches timely",
        },
    },
    "BH-ISR-4": {
        "title": "Incident Response",
        "controls": {
            "BH-ISR-4.1": "Establish and maintain an incident response capability",
            "BH-ISR-4.2": "Report significant cybersecurity incidents to CBB",
            "BH-ISR-4.3": "Conduct post-incident analysis and implement lessons learned",
        },
    },
    "BH-ISR-5": {
        "title": "Business Continuity",
        "controls": {
            "BH-ISR-5.1": "Develop BCP/DRP for critical information systems",
            "BH-ISR-5.2": "Test BCP/DRP at least annually",
            "BH-ISR-5.3": "Ensure critical systems meet RTO and RPO objectives",
        },
    },
    "BH-ISR-6": {
        "title": "Third-Party Management",
        "controls": {
            "BH-ISR-6.1": "Assess cybersecurity risks of third-party service providers",
            "BH-ISR-6.2": "Include security requirements in outsourcing agreements",
            "BH-ISR-6.3": "Monitor and audit third-party security performance",
        },
    },
    "BH-ISR-7": {
        "title": "Audit and Compliance",
        "controls": {
            "BH-ISR-7.1": "Conduct periodic internal security audits",
            "BH-ISR-7.2": "Engage external auditors for independent security reviews",
            "BH-ISR-7.3": "Report compliance status to CBB as required",
        },
    },
}


def framework_exists(cur, short_name):
    cur.execute("SELECT id FROM frameworks WHERE short_name=?", (short_name,))
    return cur.fetchone() is not None


def add_ecc2(cur):
    if framework_exists(cur, "nca-ecc-2024"):
        print("ECC-2:2024 already exists, skipping.")
        return
    fid = insert_framework(
        cur,
        name="KSA Essential Cybersecurity Controls (ECC-2:2024)",
        short_name="nca-ecc-2024",
        version="2:2024",
        description=(
            "The second edition of the NCA Essential Cybersecurity Controls (ECC-2:2024) "
            "covers four domains: Cybersecurity Governance, Cybersecurity Defense, "
            "Cybersecurity Resilience, and Third-Party and Cloud Computing Cybersecurity. "
            "It contains 28 subdomains and over 100 controls applicable to government and critical "
            "national infrastructure entities in the Kingdom of Saudi Arabia."
        ),
        issuing_body="National Cybersecurity Authority (NCA) - Kingdom of Saudi Arabia",
        regions='["Saudi Arabia", "GCC"]',
        industries='["Government", "Critical National Infrastructure", "Finance", "Energy", "Telecommunications"]',
    )
    sort = 0
    for domain_id, domain in ECC2_CONTROLS.items():
        cat = domain["title"]
        for sub_id, sub in domain["subdomains"].items():
            sub_title = f"{sub_id} {sub['title']}"
            for ctrl_id, ctrl_title in sub["controls"].items():
                insert_control(
                    cur,
                    framework_id=fid,
                    control_id=ctrl_id,
                    title=ctrl_title,
                    description=ctrl_title,
                    category=f"Domain {domain_id}: {cat} | {sub_id}: {sub['title']}",
                    sort_order=sort,
                )
                sort += 1
    print(f"Added ECC-2:2024 with {sort} controls.")


def add_uae_nesa(cur):
    if framework_exists(cur, "uae-nesa-ias"):
        print("UAE NESA IAS already exists, skipping.")
        return
    fid = insert_framework(
        cur,
        name="UAE National Information Assurance (NESA IAS)",
        short_name="uae-nesa-ias",
        version="2.0",
        description=(
            "The UAE National Electronic Security Authority (NESA) Information Assurance "
            "Standard (IAS) provides a comprehensive set of security controls for UAE "
            "government and critical infrastructure organizations. Based on ISO/IEC 27001 "
            "and tailored to the UAE regulatory environment."
        ),
        issuing_body="National Electronic Security Authority (NESA) - United Arab Emirates",
        regions='["UAE", "GCC"]',
        industries='["Government", "Critical Infrastructure", "Finance", "Telecommunications"]',
    )
    sort = 0
    for cat_id, cat in UAE_NESA_CONTROLS.items():
        for ctrl_id, ctrl_title in cat["controls"].items():
            insert_control(
                cur,
                framework_id=fid,
                control_id=ctrl_id,
                title=ctrl_title,
                description=ctrl_title,
                category=f"{cat_id}: {cat['title']}",
                sort_order=sort,
            )
            sort += 1
    print(f"Added UAE NESA IAS with {sort} controls.")


def add_desc_isr(cur):
    if framework_exists(cur, "dubai-desc-isr"):
        print("Dubai DESC ISR already exists, skipping.")
        return
    fid = insert_framework(
        cur,
        name="Dubai Information Security Regulation (DESC ISR)",
        short_name="dubai-desc-isr",
        version="2.0",
        description=(
            "The Dubai Electronic Security Centre (DESC) Information Security Regulation "
            "establishes mandatory information security requirements for government entities "
            "and critical infrastructure operators in the Emirate of Dubai."
        ),
        issuing_body="Dubai Electronic Security Centre (DESC) - Emirate of Dubai",
        regions='["Dubai", "UAE", "GCC"]',
        industries='["Government", "Critical Infrastructure", "Finance"]',
    )
    sort = 0
    for cat_id, cat in DESC_ISR_CONTROLS.items():
        for ctrl_id, ctrl_title in cat["controls"].items():
            insert_control(
                cur,
                framework_id=fid,
                control_id=ctrl_id,
                title=ctrl_title,
                description=ctrl_title,
                category=f"{cat_id}: {cat['title']}",
                sort_order=sort,
            )
            sort += 1
    print(f"Added Dubai DESC ISR with {sort} controls.")


def add_qatar_nia(cur):
    if framework_exists(cur, "qatar-nia-csf"):
        print("Qatar NIA CSF already exists, skipping.")
        return
    fid = insert_framework(
        cur,
        name="Qatar National Cybersecurity Framework (NIA CSF)",
        short_name="qatar-nia-csf",
        version="1.0",
        description=(
            "The Qatar National Information Assurance (NIA) Cybersecurity Framework "
            "is based on the NIST CSF and tailored to Qatari national requirements. "
            "It covers five core functions: Identify, Protect, Detect, Respond, and Recover, "
            "with additional Qatar-specific requirements for critical national infrastructure."
        ),
        issuing_body="National Information Assurance (NIA) - Qatar",
        regions='["Qatar", "GCC"]',
        industries='["Government", "Critical Infrastructure", "Finance", "Energy"]',
    )
    sort = 0
    for cat_id, cat in QATAR_NIA_CONTROLS.items():
        for ctrl_id, ctrl_title in cat["controls"].items():
            insert_control(
                cur,
                framework_id=fid,
                control_id=ctrl_id,
                title=ctrl_title,
                description=ctrl_title,
                category=f"{cat_id}: {cat['title']}",
                sort_order=sort,
            )
            sort += 1
    print(f"Added Qatar NIA CSF with {sort} controls.")


def add_bahrain_isr(cur):
    if framework_exists(cur, "bahrain-cbb-isr"):
        print("Bahrain CBB ISR already exists, skipping.")
        return
    fid = insert_framework(
        cur,
        name="Bahrain CBB Information Security Regulation (ISR)",
        short_name="bahrain-cbb-isr",
        version="1.0",
        description=(
            "The Central Bank of Bahrain (CBB) Information Security Regulation (ISR) "
            "sets mandatory cybersecurity requirements for financial institutions operating "
            "in the Kingdom of Bahrain, covering governance, risk management, security controls, "
            "incident response, and third-party management."
        ),
        issuing_body="Central Bank of Bahrain (CBB) - Kingdom of Bahrain",
        regions='["Bahrain", "GCC"]',
        industries='["Finance", "Banking", "Insurance"]',
    )
    sort = 0
    for cat_id, cat in BAHRAIN_ISR_CONTROLS.items():
        for ctrl_id, ctrl_title in cat["controls"].items():
            insert_control(
                cur,
                framework_id=fid,
                control_id=ctrl_id,
                title=ctrl_title,
                description=ctrl_title,
                category=f"{cat_id}: {cat['title']}",
                sort_order=sort,
            )
            sort += 1
    print(f"Added Bahrain CBB ISR with {sort} controls.")


def main():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    try:
        add_ecc2(cur)
        add_uae_nesa(cur)
        add_desc_isr(cur)
        add_qatar_nia(cur)
        add_bahrain_isr(cur)
        conn.commit()
        print("\nDone. All frameworks committed.")
    except Exception as e:
        conn.rollback()
        print(f"Error: {e}")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
