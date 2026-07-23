"""
Migration: enrich the built-in IEC 62443 (OT/IACS) and TISAX (automotive / VDA ISA 6.0)
frameworks with their full, authentic control catalogues.

  * IEC 62443 - 259 controls across the series parts 2-1 (asset-owner security
    program), 2-4 (service-provider requirements), 3-2 (zone & conduit risk assessment),
    3-3 (the seven foundational requirements / 51 system requirements, SL 1-4),
    4-1 (secure product development lifecycle) and 4-2 (component requirements).
  * TISAX - 74 controls covering the VDA ISA 6.0 Information Security catalogue
    (chapters 1-7) plus the Prototype Protection and Data Protection modules.

Idempotent: upserts framework metadata and upserts each control by
(framework_id, control_id); controls no longer in the catalogue are removed. Because the
two frameworks already ship (in a simplified form) inside grc_dev.db, this script UPDATES
them in place rather than creating duplicates. Safe to re-run.

Run from the backend/ directory:
    python add_ot_auto_frameworks.py
"""
import sqlite3
import uuid
from datetime import datetime

DB_PATH = "grc_dev.db"
NOW = datetime.utcnow().isoformat()


def uid():
    return str(uuid.uuid4())


FRAMEWORK_META = {
    "iec-62443": {
        "name": "IEC 62443 - Industrial Automation and Control Systems Security",
        "version": "2023",
        "description": 'The IEC 62443 series specifies cybersecurity requirements for operational technology (OT) and industrial automation and control systems (IACS) across their full lifecycle. This catalogue covers the security program for asset owners (2-1) and service providers (2-4), zone-and-conduit security risk assessment for system design (3-2), the seven foundational requirements and system security requirements with security levels SL 1-4 (3-3), the secure product development lifecycle (4-1), and the technical security requirements for IACS components (4-2).',
        "issuing_body": "IEC (International Electrotechnical Commission)",
        "regions": '["global"]',
        "industries": '["manufacturing", "energy", "critical-infrastructure", "utilities", "oil-and-gas", "transportation"]',
    },
    "TISAX": {
        "name": "TISAX - Trusted Information Security Assessment Exchange",
        "version": "6.0",
        "description": 'TISAX (Trusted Information Security Assessment Exchange), governed by the ENX Association on behalf of the German automotive industry association (VDA), enables mutual recognition of information security assessments across the automotive supply chain. This catalogue implements the VDA ISA 6.0 assessment criteria: the Information Security criteria (chapters 1-7), the Prototype Protection module, and the Data Protection module (processing of personal data on behalf per GDPR Art. 28).',
        "issuing_body": "ENX Association / VDA (German Association of the Automotive Industry)",
        "regions": '["europe", "global"]',
        "industries": '["automotive", "manufacturing"]',
    },
}

# Each control: (control_id, title, description, category, mandatory)
IEC_62443_CONTROLS = [
    ('SP.ORG.1', 'Establish and maintain a security program', 'The asset owner defines, documents, and maintains a formal IACS cybersecurity program (CSMS) with a stated scope covering the industrial automation and control systems it operates.', '62443-2-1 | Organizational security & governance', True),
    ('SP.ORG.2', 'Management sponsorship and accountability', 'Senior management visibly sponsors the program, assigns cybersecurity roles and responsibilities, and provides the resources and authority needed to sustain it.', '62443-2-1 | Organizational security & governance', True),
    ('SP.ORG.3', 'Security policies and procedures', 'A hierarchy of IACS security policies, standards, and operating procedures is issued, communicated to affected staff, and reviewed on a defined cycle.', '62443-2-1 | Organizational security & governance', True),
    ('SP.RISK.1', 'Risk assessment methodology', 'The organization adopts a documented, repeatable method for identifying and rating cybersecurity risk to IACS, including criteria for likelihood and consequence.', '62443-2-1 | Risk assessment & management', True),
    ('SP.RISK.2', 'Perform high-level and detailed risk assessments', 'Initial high-level and subsequent detailed risk assessments are conducted across the IACS to identify threats, vulnerabilities, and potential impact to operations and safety.', '62443-2-1 | Risk assessment & management', True),
    ('SP.RISK.3', 'Risk treatment and acceptance', 'Assessed risks are prioritized and treated through selected countermeasures, with residual risk formally accepted by an accountable owner and periodically re-evaluated.', '62443-2-1 | Risk assessment & management', True),
    ('SP.ASSET.1', 'IACS asset inventory', 'A current inventory of IACS hardware, software, and network components is maintained, capturing attributes needed for security decisions such as criticality and location.', '62443-2-1 | Asset & configuration management', True),
    ('SP.ASSET.2', 'Zone and conduit partitioning', 'The IACS is segmented into security zones and conduits based on risk, and the partitioning model is documented and kept consistent with the physical and logical architecture.', '62443-2-1 | Asset & configuration management', True),
    ('SP.ASSET.3', 'Configuration and change management', 'Baseline configurations are defined and changes to IACS components follow a controlled process with review, testing, and approval to preserve security posture.', '62443-2-1 | Asset & configuration management', True),
    ('SP.ASSET.4', 'Patch and vulnerability management', 'Vulnerabilities affecting IACS components are tracked and remediated through a managed process that evaluates and schedules patches while protecting operational availability.', '62443-2-1 | Asset & configuration management', True),
    ('SP.ACC.1', 'Account and identity management', 'User, service, and shared accounts on IACS are provisioned, reviewed, and revoked through a governed lifecycle tied to individual accountability where feasible.', '62443-2-1 | Access & account management', True),
    ('SP.ACC.2', 'Authorization and least privilege', 'Access rights to IACS assets are granted according to role and business need, enforcing least privilege and separation of duties for sensitive functions.', '62443-2-1 | Access & account management', True),
    ('SP.ACC.3', 'Authentication and remote access control', 'Users and devices are authenticated commensurate with risk, and remote or external connections to the IACS are restricted, brokered, and monitored.', '62443-2-1 | Access & account management', True),
    ('SP.PHY.1', 'Physical and environmental security', 'Physical access to IACS equipment, cabling, and control rooms is controlled and monitored, and environmental protections guard critical assets against loss of power, climate, or physical tampering.', '62443-2-1 | Physical & environmental security', True),
    ('SP.NET.1', 'Network segmentation and boundary protection', 'Boundary defenses separate IACS networks from enterprise and untrusted networks, permitting only explicitly required communications across conduits.', '62443-2-1 | Network & communication security', True),
    ('SP.NET.2', 'Secure communications', 'Communications carrying sensitive control or configuration data are protected against unauthorized disclosure and modification using appropriate integrity and confidentiality controls.', '62443-2-1 | Network & communication security', False),
    ('SP.NET.3', 'Malware defense and portable media control', 'Protections against malicious code are deployed on suitable IACS hosts and the use of portable media and transient devices is governed to limit infection pathways.', '62443-2-1 | Network & communication security', True),
    ('SP.EVT.1', 'Security monitoring and logging', 'Security-relevant events on IACS are logged, retained, and monitored to enable timely detection of anomalous or unauthorized activity.', '62443-2-1 | Event & incident management', True),
    ('SP.EVT.2', 'Incident response and reporting', 'A documented incident response capability defines how IACS security events are reported, triaged, contained, eradicated, and closed, including escalation paths.', '62443-2-1 | Event & incident management', True),
    ('SP.CONT.1', 'Business continuity and disaster recovery', 'Continuity and recovery plans address disruption of IACS, defining recovery objectives, roles, and procedures to restore operations after an incident or failure.', '62443-2-1 | Continuity & recovery', True),
    ('SP.CONT.2', 'Backup and restoration', 'Critical IACS configurations, software, and data are backed up on a defined schedule, protected, and periodically tested for successful restoration.', '62443-2-1 | Continuity & recovery', True),
    ('SP.PER.1', 'Personnel screening and responsibilities', 'Personnel with IACS access are screened proportionate to risk and their security responsibilities are defined in role descriptions and terms of employment.', '62443-2-1 | Personnel & awareness', False),
    ('SP.PER.2', 'Security awareness and training', 'Staff and contractors receive role-appropriate cybersecurity awareness and training so they can carry out their IACS security duties competently.', '62443-2-1 | Personnel & awareness', True),
    ('SP.SUP.1', 'Supplier and service-provider security', 'Security expectations are defined for product suppliers and service providers, embedded in agreements, and verified across the engagement lifecycle.', '62443-2-1 | Supplier/service-provider management', True),
    ('SP.SUP.2', 'Third-party access and oversight', 'Access granted to integrators, vendors, and maintenance providers is controlled, time-bound, and supervised, with their activities logged and reviewed.', '62443-2-1 | Supplier/service-provider management', False),
    ('SP.AUD.1', 'Compliance monitoring and internal audit', 'The organization periodically audits conformance of the IACS security program against its policies and applicable requirements, recording findings for action.', '62443-2-1 | Audit & review', True),
    ('SP.AUD.2', 'Management review and continual improvement', 'Management reviews program performance using audit results, incidents, and metrics, driving corrective actions and ongoing improvement of the security program.', '62443-2-1 | Audit & review', True),
    ('SP.01.01', 'Documented staffing capability', 'The service provider maintains documentation describing how personnel assigned to automation solution activities are identified, qualified, and allocated to security-relevant tasks.', '62443-2-4 | Solution staffing / Personnel', True),
    ('SP.01.02', 'Security competency and training', 'Personnel performing integration or maintenance work possess and can demonstrate the cybersecurity skills, training records, and role-specific competencies needed for their assigned responsibilities.', '62443-2-4 | Solution staffing / Personnel', True),
    ('SP.01.03', 'Background verification of personnel', "The provider applies a defined process for screening and background checking staff granted access to the asset owner's automation solution or sensitive information.", '62443-2-4 | Solution staffing / Personnel', True),
    ('SP.02.01', 'Security assurance process', 'The provider defines and follows a repeatable assurance process that verifies security requirements are satisfied throughout integration and maintenance engagements.', '62443-2-4 | Assurance', True),
    ('SP.02.02', 'Independent security review', 'Security-relevant deliverables and configurations undergo review by personnel independent of those who produced them, with findings tracked to closure.', '62443-2-4 | Assurance', False),
    ('SP.02.03', 'Security requirement traceability', 'The provider maintains traceability from agreed security requirements through design, implementation, and verification for the delivered solution.', '62443-2-4 | Assurance', True),
    ('SP.03.01', 'Network segmentation capability', 'The provider is able to design and implement zone-and-conduit segmentation that isolates control networks from other networks according to the agreed security architecture.', '62443-2-4 | Architecture', True),
    ('SP.03.02', 'Boundary protection at conduits', 'Traffic crossing zone boundaries is controlled using firewalls or equivalent mechanisms configured to permit only necessary communication.', '62443-2-4 | Architecture', True),
    ('SP.03.03', 'Least-functionality hardening', 'Delivered components are hardened by disabling unnecessary services, ports, and functions and documenting the resulting secure configuration baseline.', '62443-2-4 | Architecture', True),
    ('SP.03.04', 'Defense-in-depth design', 'The architecture incorporates layered, complementary security controls so that failure of any single control does not expose the whole solution.', '62443-2-4 | Architecture', False),
    ('SP.04.01', 'Secure wireless deployment', 'When wireless technology is used, the provider deploys it with strong authentication and encryption and isolates wireless segments from critical control functions.', '62443-2-4 | Wireless', True),
    ('SP.04.02', 'Wireless inventory and monitoring', 'Wireless access points and devices in the solution are inventoried and configured to support detection of unauthorized or rogue wireless activity.', '62443-2-4 | Wireless', False),
    ('SP.05.01', 'SIS separation and integrity', 'For safety instrumented systems, the provider maintains separation from basic control functions and protects safety logic against unauthorized modification.', '62443-2-4 | SIS / Safety systems', True),
    ('SP.05.02', 'Controlled SIS access', 'Access to configure, program, or bypass safety instrumented systems is restricted to authorized personnel and logged for accountability.', '62443-2-4 | SIS / Safety systems', True),
    ('SP.06.01', 'Configuration baseline management', 'The provider establishes and maintains approved configuration baselines for all delivered automation components and tracks deviations from them.', '62443-2-4 | Configuration management', True),
    ('SP.06.02', 'Change control process', 'Changes to the solution are requested, assessed for security impact, approved, tested, and documented before being applied to production systems.', '62443-2-4 | Configuration management', True),
    ('SP.06.03', 'Asset and component inventory', 'An accurate inventory of hardware, software, and firmware versions comprising the automation solution is maintained and kept current.', '62443-2-4 | Configuration management', True),
    ('SP.07.01', 'Secure remote access architecture', 'Remote access to the solution is provided through controlled, encrypted channels that terminate in a protected zone rather than directly on control equipment.', '62443-2-4 | Remote access', True),
    ('SP.07.02', 'Remote access authentication', 'Remote sessions require strong, preferably multi-factor authentication and are restricted to explicitly authorized users and purposes.', '62443-2-4 | Remote access', True),
    ('SP.07.03', 'Remote session monitoring and termination', 'Remote access sessions are monitored, time-limited, and can be terminated or disabled promptly when no longer required.', '62443-2-4 | Remote access', True),
    ('SP.08.01', 'Security event logging capability', 'The provider configures components to generate security-relevant event and audit records covering access, configuration changes, and anomalies.', '62443-2-4 | Event / Log management', True),
    ('SP.08.02', 'Log collection and retention', 'Event logs are centrally collected, protected against tampering, and retained for a duration agreed with the asset owner.', '62443-2-4 | Event / Log management', True),
    ('SP.08.03', 'Time synchronization', 'System clocks across solution components are synchronized to a common reference so that logged events can be correlated reliably.', '62443-2-4 | Event / Log management', False),
    ('SP.09.01', 'Account provisioning and least privilege', 'User and service accounts are created, granted least-privilege access, and periodically reviewed in line with agreed access-control policy.', '62443-2-4 | Account management', True),
    ('SP.09.02', 'Default and shared credential handling', 'Default credentials are changed and use of shared accounts is minimized, controlled, and justified where technically unavoidable.', '62443-2-4 | Account management', True),
    ('SP.09.03', 'Timely account revocation', 'Accounts are promptly disabled or removed when personnel change roles, leave, or no longer require access to the solution.', '62443-2-4 | Account management', True),
    ('SP.10.01', 'Malware protection deployment', 'The provider deploys and configures anti-malware or equivalent protective measures appropriate to each component of the automation solution.', '62443-2-4 | Malware protection', True),
    ('SP.10.02', 'Malware definition and update management', 'Malware protection signatures and engines are updated through a controlled process that is validated for compatibility before deployment to control systems.', '62443-2-4 | Malware protection', True),
    ('SP.11.01', 'Patch assessment and qualification', 'The provider evaluates available security patches for applicability and tests them for compatibility with the solution before recommending or applying them.', '62443-2-4 | Patch management', True),
    ('SP.11.02', 'Controlled patch deployment', 'Approved patches are deployed following the change-control process, with rollback provisions and documentation of the patch state of each component.', '62443-2-4 | Patch management', True),
    ('SP.12.01', 'Backup capability', 'The provider implements and documents backup procedures that capture configurations, programs, and data needed to restore the automation solution.', '62443-2-4 | Backup / Restore', True),
    ('SP.12.02', 'Restore verification', 'Backups are periodically tested through restoration to confirm they are complete, usable, and protected against unauthorized modification.', '62443-2-4 | Backup / Restore', True),
    ('ZCR 1', 'Identify the System under Consideration', 'Define and document the boundary, perimeter and access points of the System under Consideration (SUC), together with the assets, connected systems, data flows and functions it contains.', '62443-3-2 | Zones & Conduits', True),
    ('ZCR 2', 'Initial cyber security risk assessment', 'Conduct a high-level risk assessment of the SUC to gauge worst-case unmitigated consequences, giving an early view of risk before any zoning or detailed analysis.', '62443-3-2 | Zones & Conduits', True),
    ('ZCR 3', 'Partition the SUC into zones and conduits', 'Group the assets of the SUC into security zones and interconnecting conduits according to shared security requirements, criticality and function.', '62443-3-2 | Zones & Conduits', True),
    ('ZCR 3.1', 'Establish zones and conduits', 'Define each zone and conduit with documented boundaries, contained assets, communication paths and governing security characteristics.', '62443-3-2 | Zones & Conduits', True),
    ('ZCR 3.2', 'Separate business and IACS assets', 'Place business/IT assets and industrial automation and control system assets into distinct zones so that their differing security needs are not co-mingled.', '62443-3-2 | Zones & Conduits', True),
    ('ZCR 3.3', 'Separate safety-related assets', 'Assign safety instrumented and other safety-related functions to their own zones, isolated from non-safety assets to protect their integrity.', '62443-3-2 | Zones & Conduits', True),
    ('ZCR 3.4', 'Separate temporarily connected devices', 'Group temporarily connected devices and portable media into dedicated zones that reflect their intermittent presence and elevated exposure.', '62443-3-2 | Zones & Conduits', True),
    ('ZCR 3.5', 'Separate wireless devices', 'Group assets that communicate over wireless links into their own zones, recognising the additional exposure introduced by wireless connectivity.', '62443-3-2 | Zones & Conduits', True),
    ('ZCR 3.6', 'Separate devices connected via external networks', 'Isolate assets reachable through untrusted or external networks into distinct zones so that external exposure is contained.', '62443-3-2 | Zones & Conduits', True),
    ('ZCR 4', 'Risk comparison', "Compare the initial (unmitigated) cyber security risk against the organisation's tolerable risk to decide whether a detailed risk assessment is required; where initial risk does not exceed tolerable risk a detailed assessment may be omitted with justification.", '62443-3-2 | Zones & Conduits', True),
    ('ZCR 5', 'Perform a detailed cyber security risk assessment', 'Where initial risk exceeds tolerable risk, carry out a per-zone and per-conduit detailed assessment covering threats, vulnerabilities, consequence, likelihood, unmitigated and residual risk, and additional countermeasures.', '62443-3-2 | Zones & Conduits', True),
    ('ZCR 5.6', 'Determine the target security level (SL-T)', 'Assign a target security level to each zone and conduit derived from the risk analysis, expressing the required protection across the seven foundational requirements.', '62443-3-2 | Zones & Conduits', True),
    ('ZCR 6', 'Document cyber security requirements, assumptions and constraints', 'Record the derived security requirements, assumptions and constraints for the SUC in a Cyber Security Requirements Specification (CSRS), including zone and conduit definitions and target security levels.', '62443-3-2 | Zones & Conduits', True),
    ('ZCR 7', 'Asset owner approval', 'Obtain formal asset owner review and sign-off on the zone and conduit partitioning, the risk assessment results and the resulting CSRS.', '62443-3-2 | Zones & Conduits', True),
    ('SR 1.1', 'Human User Identification and Authentication', 'The control system must identify and authenticate every human operator before granting them access, so that individual users can be reliably distinguished at all interfaces they use.', '62443-3-3 | FR1 Identification & Authentication Control', True),
    ('SR 1.2', 'Software Process and Device Identification and Authentication', 'Automated software processes and connected devices must be identified and authenticated before they are permitted to interact with the control system.', '62443-3-3 | FR1 Identification & Authentication Control', True),
    ('SR 1.3', 'Account Management', 'The system must support administration of all accounts, including creating, activating, modifying, disabling and removing them throughout their lifecycle.', '62443-3-3 | FR1 Identification & Authentication Control', True),
    ('SR 1.4', 'Identifier Management', 'Identifiers assigned to users, groups, roles and devices must be managed so that each is unique, traceable and controlled over its lifetime.', '62443-3-3 | FR1 Identification & Authentication Control', True),
    ('SR 1.5', 'Authenticator Management', 'Authenticators such as passwords, tokens and keys must be initialized, distributed, protected, changed and revoked under defined management procedures.', '62443-3-3 | FR1 Identification & Authentication Control', True),
    ('SR 1.6', 'Wireless Access Management', 'Users, processes and devices connecting over wireless links must be identified and authenticated, and their wireless access must be governed and monitored.', '62443-3-3 | FR1 Identification & Authentication Control', True),
    ('SR 1.7', 'Strength of Password-Based Authentication', 'Where passwords are used, the system must enforce configurable complexity, length and lifetime rules to ensure adequate authentication strength.', '62443-3-3 | FR1 Identification & Authentication Control', True),
    ('SR 1.8', 'Public Key Infrastructure Certificates', 'When public key infrastructure is relied upon, certificates must be issued, validated and managed in accordance with recognized PKI practices.', '62443-3-3 | FR1 Identification & Authentication Control', True),
    ('SR 1.9', 'Strength of Public Key Authentication', 'Public-key-based authentication must validate certificate chains, check status and bind identities so that the authentication provides sufficient assurance.', '62443-3-3 | FR1 Identification & Authentication Control', True),
    ('SR 1.10', 'Authenticator Feedback', 'During the authentication exchange the system must obscure feedback of secret authenticator information to prevent it being observed or exploited.', '62443-3-3 | FR1 Identification & Authentication Control', True),
    ('SR 1.11', 'Unsuccessful Login Attempts', 'The system must limit consecutive failed authentication attempts and take a defined protective action once the configured threshold is exceeded.', '62443-3-3 | FR1 Identification & Authentication Control', True),
    ('SR 1.12', 'System Use Notification', 'Before access is granted the system must be able to display a configurable usage notification or warning banner to the user.', '62443-3-3 | FR1 Identification & Authentication Control', True),
    ('SR 1.13', 'Access via Untrusted Networks', 'Any access into the control system that originates from untrusted networks must be monitored and controlled, with connections requiring explicit approval.', '62443-3-3 | FR1 Identification & Authentication Control', True),
    ('SR 2.1', 'Authorization Enforcement', 'The system must enforce assigned privileges for every authenticated user, process or device so that permitted actions are restricted according to role and policy.', '62443-3-3 | FR2 Use Control', True),
    ('SR 2.2', 'Wireless Use Control', 'Usage rights and restrictions must be enforced for users and devices communicating over wireless connections.', '62443-3-3 | FR2 Use Control', True),
    ('SR 2.3', 'Use Control for Portable and Mobile Devices', 'The system must govern the use of portable and mobile devices, including controlling how they connect and what actions they may perform.', '62443-3-3 | FR2 Use Control', True),
    ('SR 2.4', 'Mobile Code', 'Execution of mobile code must be controlled and restricted according to policy to prevent unauthorized or malicious code from running.', '62443-3-3 | FR2 Use Control', True),
    ('SR 2.5', 'Session Lock', 'After a defined period of inactivity the system must lock an interactive session and require re-authentication before use can resume.', '62443-3-3 | FR2 Use Control', True),
    ('SR 2.6', 'Remote Session Termination', 'The system must be able to terminate a remote session automatically after inactivity or on demand by an authorized operator.', '62443-3-3 | FR2 Use Control', True),
    ('SR 2.7', 'Concurrent Session Control', 'The number of simultaneous sessions permitted per user, interface or account must be limitable to a configured maximum.', '62443-3-3 | FR2 Use Control', True),
    ('SR 2.8', 'Auditable Events', 'The system must generate audit records for security-relevant events, capturing sufficient detail to support later review and investigation.', '62443-3-3 | FR2 Use Control', True),
    ('SR 2.9', 'Audit Storage Capacity', 'Adequate capacity must be provided for audit record storage, with mechanisms to reduce the risk of exceeding available space.', '62443-3-3 | FR2 Use Control', True),
    ('SR 2.10', 'Response to Audit Processing Failures', 'The system must alert appropriate personnel and take defined action when audit logging fails or storage is exhausted, while preventing loss of essential operations.', '62443-3-3 | FR2 Use Control', True),
    ('SR 2.11', 'Timestamps', 'Audit records and events must carry reliable timestamps drawn from a trusted, synchronized time source to support accurate correlation.', '62443-3-3 | FR2 Use Control', True),
    ('SR 2.12', 'Non-Repudiation', 'The system must be able to establish attribution so that a human user cannot credibly deny having performed a recorded action.', '62443-3-3 | FR2 Use Control', True),
    ('SR 3.1', 'Communication Integrity', 'The control system shall protect the integrity of information transmitted over communication channels, detecting unauthorized changes to messages in transit.', '62443-3-3 | FR3 System Integrity', True),
    ('SR 3.2', 'Malicious Code Protection', 'Mechanisms shall guard against, detect, report, and remediate malicious code entering or executing on control system components, with the protection kept current.', '62443-3-3 | FR3 System Integrity', True),
    ('SR 3.3', 'Security Functionality Verification', 'The system shall provide the ability to verify that intended security functions are operating correctly, with testing performed during commissioning and at scheduled intervals.', '62443-3-3 | FR3 System Integrity', True),
    ('SR 3.4', 'Software and Information Integrity', 'The system shall detect, record, and report unauthorized modification of stored software and configuration or information at rest.', '62443-3-3 | FR3 System Integrity', True),
    ('SR 3.5', 'Input Validation', 'The system shall validate the syntax, range, and content of inputs used as control-relevant data or process parameters before acting on them.', '62443-3-3 | FR3 System Integrity', True),
    ('SR 3.6', 'Deterministic Output', 'Outputs shall be forced to a predefined safe state when normal operation cannot be maintained, ensuring predictable behavior on failure.', '62443-3-3 | FR3 System Integrity', True),
    ('SR 3.7', 'Error Handling', 'The system shall identify and manage error conditions in a way that avoids exposing sensitive information and does not compromise safe or secure operation.', '62443-3-3 | FR3 System Integrity', True),
    ('SR 3.8', 'Session Integrity', 'The system shall protect the integrity of active communication sessions, including invalidating and terminating sessions on defined conditions such as inactivity or logout.', '62443-3-3 | FR3 System Integrity', True),
    ('SR 3.9', 'Protection of Audit Information', 'Audit records and audit tools shall be safeguarded against unauthorized access, modification, and deletion, both while in use and in storage.', '62443-3-3 | FR3 System Integrity', True),
    ('SR 4.1', 'Information Confidentiality', 'The system shall protect the confidentiality of information designated as sensitive, whether at rest or in transit over communication channels.', '62443-3-3 | FR4 Data Confidentiality', True),
    ('SR 4.2', 'Information Persistence', 'The system shall provide the ability to purge sensitive information from components before they are released, reused, or decommissioned so residual data is not recoverable.', '62443-3-3 | FR4 Data Confidentiality', True),
    ('SR 4.3', 'Use of Cryptography', 'Where cryptography is employed, it shall follow recognized security practices for algorithm selection, key generation, and key management.', '62443-3-3 | FR4 Data Confidentiality', True),
    ('SR 5.1', 'Network Segmentation', 'The control system shall provide the capability to logically segment networks from other networks and to isolate itself from untrusted external networks. This supports zone-and-conduit architecture by keeping distinct network groups separated.', '62443-3-3 | FR5 Restricted Data Flow', True),
    ('SR 5.2', 'Zone Boundary Protection', 'The control system shall provide the capability to monitor and control communications crossing zone boundaries, enforcing a defined data-flow policy and denying network traffic by default while permitting only explicitly authorized flows.', '62443-3-3 | FR5 Restricted Data Flow', True),
    ('SR 5.3', 'General-Purpose Person-to-Person Communication Restrictions', 'The control system shall provide the capability to prevent general-purpose person-to-person messaging (such as email or instant messaging) from reaching systems and devices within the control network.', '62443-3-3 | FR5 Restricted Data Flow', True),
    ('SR 5.4', 'Application Partitioning', 'The control system shall provide the capability to separate data, applications and services based on criticality, so that lower-criticality functions do not adversely affect higher-criticality control operations.', '62443-3-3 | FR5 Restricted Data Flow', True),
    ('SR 6.1', 'Audit Log Accessibility', 'The control system shall provide the capability for authorized humans and tools to access audit logs on a read-only basis, enabling timely review and analysis of recorded security events.', '62443-3-3 | FR6 Timely Response to Events', True),
    ('SR 6.2', 'Continuous Security Monitoring', 'The control system shall provide the capability to continuously monitor all security mechanisms and detect, characterize and report security breaches or anomalous events in a timely manner using commonly accepted tools and methods.', '62443-3-3 | FR6 Timely Response to Events', True),
    ('SR 7.1', 'Denial-of-Service Protection', 'The control system shall provide the capability to maintain essential operations in a degraded mode during and after a denial-of-service event that limits or floods communications or processing resources.', '62443-3-3 | FR7 Resource Availability', True),
    ('SR 7.2', 'Resource Management', 'The control system shall provide the capability to limit the use of resources by security functions to prevent resource exhaustion and to protect against the depletion of shared processing, memory or bandwidth capacity.', '62443-3-3 | FR7 Resource Availability', True),
    ('SR 7.3', 'Control System Backup', 'The control system shall provide the capability to conduct backups of user-level and system-level information, including configuration and state, without affecting normal plant operations.', '62443-3-3 | FR7 Resource Availability', True),
    ('SR 7.4', 'Control System Recovery and Reconstitution', 'The control system shall provide the capability to recover and reconstitute to a known secure state following a disruption or failure, restoring operations without compromise.', '62443-3-3 | FR7 Resource Availability', True),
    ('SR 7.5', 'Emergency Power', 'The control system shall provide the capability to switch to and from an emergency power supply without affecting the existing security state or causing an unwanted loss of protection.', '62443-3-3 | FR7 Resource Availability', True),
    ('SR 7.6', 'Network and Security Configuration Settings', 'The control system shall provide the capability to be configured according to recommended network and security settings and to generate a report identifying any deviations from the approved configuration baseline.', '62443-3-3 | FR7 Resource Availability', True),
    ('SR 7.7', 'Least Functionality', 'The control system shall provide the capability to restrict operation to only essential functions, ports, protocols and services, prohibiting or limiting the use of unnecessary capabilities.', '62443-3-3 | FR7 Resource Availability', True),
    ('SR 7.8', 'Control System Component Inventory', 'The control system shall provide the capability to report a current inventory of its components and associated attributes, supporting availability management and configuration control.', '62443-3-3 | FR7 Resource Availability', True),
    ('SM-1', 'Documented development process', 'The supplier maintains a documented, repeatable secure development lifecycle process that governs all product engineering activities.', '62443-4-1 | Practice 1 – Security Management', True),
    ('SM-2', 'Assignment of security responsibilities', 'Roles, responsibilities and accountability for the security tasks within the development process are clearly identified and assigned.', '62443-4-1 | Practice 1 – Security Management', True),
    ('SM-3', 'Scope of applicability', 'The process defines which products, versions and components the secure development lifecycle applies to.', '62443-4-1 | Practice 1 – Security Management', True),
    ('SM-4', 'Personnel security competence', 'Personnel performing security-relevant activities possess demonstrated expertise, kept current through appropriate training.', '62443-4-1 | Practice 1 – Security Management', True),
    ('SM-5', 'Tailoring the process scope', 'Any tailoring or scoping-out of process activities is justified and documented so that residual risk is understood.', '62443-4-1 | Practice 1 – Security Management', True),
    ('SM-6', 'Integrity of work products', 'Mechanisms protect the integrity of development artifacts and configuration items throughout their lifecycle.', '62443-4-1 | Practice 1 – Security Management', True),
    ('SM-7', 'Protection of the development environment', 'The environments used to develop, build and manage the product are safeguarded against tampering and unauthorized access.', '62443-4-1 | Practice 1 – Security Management', True),
    ('SM-8', 'Safeguarding of private keys', 'Private keys used for signing or authentication of products are generated, stored and used under strict protective controls.', '62443-4-1 | Practice 1 – Security Management', True),
    ('SM-9', 'Security of externally sourced components', 'Security requirements are defined for third-party and open-source components incorporated into the product.', '62443-4-1 | Practice 1 – Security Management', True),
    ('SM-10', 'Custom components from external suppliers', 'Components custom-built by outside suppliers are held to the same secure development expectations as internally developed code.', '62443-4-1 | Practice 1 – Security Management', True),
    ('SM-11', 'Handling of identified security issues', 'A defined method exists to assess and address security-related issues discovered in the product or its components.', '62443-4-1 | Practice 1 – Security Management', True),
    ('SM-12', 'Verification of process execution', 'Evidence is produced and reviewed to confirm that the required lifecycle activities were actually carried out before release.', '62443-4-1 | Practice 1 – Security Management', True),
    ('SM-13', 'Continuous process improvement', 'The secure development process is periodically evaluated and refined based on lessons learned and evolving threats.', '62443-4-1 | Practice 1 – Security Management', True),
    ('SR-1', 'Product security context', 'The intended operating environment, users and interfaces of the product are documented to frame its security needs.', '62443-4-1 | Practice 2 – Specification of security requirements', True),
    ('SR-2', 'Threat model', 'A threat model identifying assets, entry points, threats and mitigations is produced and kept current for the product.', '62443-4-1 | Practice 2 – Specification of security requirements', True),
    ('SR-3', 'Derivation of security requirements', 'Security requirements are derived from the security context, threat model, and applicable regulatory and standards obligations.', '62443-4-1 | Practice 2 – Specification of security requirements', True),
    ('SR-4', 'Content of security requirements', 'Security requirements specify capabilities, security levels and constraints in a complete, testable manner.', '62443-4-1 | Practice 2 – Specification of security requirements', True),
    ('SR-5', 'Review of security requirements', 'Security requirements are reviewed by relevant stakeholders for completeness, correctness and consistency.', '62443-4-1 | Practice 2 – Specification of security requirements', True),
    ('SD-1', 'Secure-by-design principles', 'The product design applies recognized secure design principles such as least privilege, minimal attack surface and secure defaults.', '62443-4-1 | Practice 3 – Secure by design', True),
    ('SD-2', 'Defense-in-depth design', 'The design incorporates layered, complementary security measures so no single failure compromises the product.', '62443-4-1 | Practice 3 – Secure by design', True),
    ('SD-3', 'Security design review', 'The design is reviewed to confirm it satisfies the security requirements and correctly mitigates modeled threats.', '62443-4-1 | Practice 3 – Secure by design', True),
    ('SD-4', 'Secure design best practices', 'Established design best practices are applied and the rationale for security-relevant design decisions is documented.', '62443-4-1 | Practice 3 – Secure by design', True),
    ('SI-1', 'Secure implementation review', 'Implementation is reviewed against the secure design and security requirements to detect deviations and weaknesses.', '62443-4-1 | Practice 4 – Secure implementation', True),
    ('SI-2', 'Secure coding standards', 'Development follows defined secure coding standards that address common vulnerability classes and unsafe constructs.', '62443-4-1 | Practice 4 – Secure implementation', True),
    ('SVV-1', 'Security requirements testing', 'Testing verifies that each security requirement has been correctly and completely implemented in the product.', '62443-4-1 | Practice 5 – Security verification and validation testing', True),
    ('SVV-2', 'Threat mitigation testing', 'Tests confirm that the mitigations identified in the threat model function as intended against the corresponding threats.', '62443-4-1 | Practice 5 – Security verification and validation testing', True),
    ('SVV-3', 'Vulnerability testing', 'The product undergoes vulnerability testing including static analysis, dynamic analysis and known-vulnerability scanning.', '62443-4-1 | Practice 5 – Security verification and validation testing', True),
    ('SVV-4', 'Penetration testing', 'Penetration testing is performed to identify exploitable weaknesses under realistic adversarial conditions.', '62443-4-1 | Practice 5 – Security verification and validation testing', True),
    ('SVV-5', 'Independence of testers', 'Security verification and validation is carried out with a level of tester independence appropriate to the target security level.', '62443-4-1 | Practice 5 – Security verification and validation testing', True),
    ('DM-1', 'Receiving security issue reports', 'A defined channel and process exists for receiving notifications of potential security issues from internal and external sources.', '62443-4-1 | Practice 6 – Management of security-related issues', True),
    ('DM-2', 'Reviewing reported issues', 'Reported security issues are reviewed to determine whether they are genuine and relevant to the product.', '62443-4-1 | Practice 6 – Management of security-related issues', True),
    ('DM-3', 'Assessing issue severity', 'Confirmed security issues are assessed for impact and severity to prioritize their treatment.', '62443-4-1 | Practice 6 – Management of security-related issues', True),
    ('DM-4', 'Addressing security issues', 'Security issues are remediated or mitigated, and residual risk from unresolved issues is documented and communicated.', '62443-4-1 | Practice 6 – Management of security-related issues', True),
    ('DM-5', 'Disclosure of security issues', 'Security issues and their fixes are disclosed to affected users and stakeholders through a defined disclosure process.', '62443-4-1 | Practice 6 – Management of security-related issues', True),
    ('DM-6', 'Periodic review of issue management', 'The security issue management process is periodically reviewed to confirm issues are being handled effectively and on time.', '62443-4-1 | Practice 6 – Management of security-related issues', True),
    ('SUM-1', 'Qualification of security updates', 'Security updates are tested and qualified to confirm they resolve the issue without introducing regressions or new risk.', '62443-4-1 | Practice 7 – Security update management', True),
    ('SUM-2', 'Documentation of security updates', 'Each security update is accompanied by documentation describing the addressed issues and any installation impacts.', '62443-4-1 | Practice 7 – Security update management', True),
    ('SUM-3', 'Updates for dependencies and platforms', 'Security updates for third-party dependencies and underlying operating systems used by the product are identified and documented.', '62443-4-1 | Practice 7 – Security update management', True),
    ('SUM-4', 'Secure delivery of updates', 'Security updates are distributed through mechanisms that protect their authenticity and integrity in transit.', '62443-4-1 | Practice 7 – Security update management', True),
    ('SUM-5', 'Timely release of updates', 'Security updates are made available within timeframes commensurate with the severity of the underlying issue.', '62443-4-1 | Practice 7 – Security update management', True),
    ('SG-1', 'Product defense-in-depth guidance', "User documentation describes the product's built-in defense-in-depth architecture and security capabilities.", '62443-4-1 | Practice 8 – Security guidelines', True),
    ('SG-2', 'Expected environmental protections', "Guidance states the security measures the operating environment must provide to complement the product's own protections.", '62443-4-1 | Practice 8 – Security guidelines', True),
    ('SG-3', 'Hardening guidelines', 'Documentation provides instructions for securely configuring and hardening the product for deployment.', '62443-4-1 | Practice 8 – Security guidelines', True),
    ('SG-4', 'Secure decommissioning guidance', 'Guidance explains how to securely remove or dispose of the product and sanitize any sensitive data it holds.', '62443-4-1 | Practice 8 – Security guidelines', True),
    ('SG-5', 'Secure operation guidance', 'Documentation describes how to operate and maintain the product securely throughout its service life.', '62443-4-1 | Practice 8 – Security guidelines', True),
    ('SG-6', 'Account management guidance', 'Guidance covers managing user accounts, credentials and privileges, including default account handling.', '62443-4-1 | Practice 8 – Security guidelines', True),
    ('SG-7', 'Review of security guidelines', 'The security guideline documentation is reviewed for accuracy, completeness and consistency with the product before release.', '62443-4-1 | Practice 8 – Security guidelines', True),
    ('CR 1.1', 'Human user identification and authentication', 'The component must identify and authenticate every human user before granting access, on all interfaces through which humans interact with it.', '62443-4-2 | FR1 Identification & Authentication Control', True),
    ('CR 1.2', 'Software process and device identification and authentication', 'The component must identify and authenticate software processes and devices that request access, so machine-to-machine interactions are trusted.', '62443-4-2 | FR1 Identification & Authentication Control', True),
    ('CR 1.3', 'Account management', 'Supports management of all account types applicable to the component: create, enable, modify, disable and remove.', '62443-4-2 | FR1 Identification & Authentication Control', True),
    ('CR 1.4', 'Identifier management', 'Enables administration of user, group, role and device identifiers, including preventing reuse of retired identifiers.', '62443-4-2 | FR1 Identification & Authentication Control', True),
    ('CR 1.5', 'Authenticator management', 'Provides secure handling of authenticators, including initial content, default-credential changes, and protection against unauthorized disclosure or modification.', '62443-4-2 | FR1 Identification & Authentication Control', True),
    ('CR 1.6', 'Wireless access management', 'Identifies and authenticates users, processes and devices connecting over wireless links.', '62443-4-2 | FR1 Identification & Authentication Control', True),
    ('CR 1.7', 'Strength of password-based authentication', 'Enforces configurable password composition and lifetime rules to give password authentication adequate strength.', '62443-4-2 | FR1 Identification & Authentication Control', True),
    ('CR 1.8', 'Public key infrastructure certificates', 'Where PKI is used, the component operates in accordance with a recognized PKI or obtains certificates from a trusted certificate authority.', '62443-4-2 | FR1 Identification & Authentication Control', True),
    ('CR 1.9', 'Strength of public key-based authentication', 'Validates certificates, checks revocation status, verifies the presenter controls the private key, and maps identities appropriately when using public-key authentication.', '62443-4-2 | FR1 Identification & Authentication Control', True),
    ('CR 1.10', 'Authenticator feedback', 'Obscures feedback of authentication information during entry so it cannot be observed or captured.', '62443-4-2 | FR1 Identification & Authentication Control', True),
    ('CR 1.11', 'Unsuccessful login attempts', 'Enforces a configurable limit on consecutive failed access attempts and takes a defined action when the limit is exceeded.', '62443-4-2 | FR1 Identification & Authentication Control', True),
    ('CR 1.12', 'System use notification', 'Displays a configurable use-notification message before authentication completes.', '62443-4-2 | FR1 Identification & Authentication Control', True),
    ('CR 1.13', 'Access via untrusted networks', 'Manages, monitors and controls all access attempts arriving from untrusted networks.', '62443-4-2 | FR1 Identification & Authentication Control', True),
    ('CR 1.14', 'Strength of symmetric key-based authentication', 'Provides adequate strength for symmetric-key authentication, including secure key establishment, storage and protection against disclosure.', '62443-4-2 | FR1 Identification & Authentication Control', True),
    ('CR 2.1', 'Authorization enforcement', 'Enforces assigned privileges so that authenticated users, processes and devices may perform only the actions they are permitted.', '62443-4-2 | FR2 Use Control', True),
    ('CR 2.2', 'Wireless use control', 'Authorizes, monitors and enforces usage restrictions for wireless connectivity in line with accepted practices.', '62443-4-2 | FR2 Use Control', True),
    ('CR 2.3', 'Use control for portable and mobile devices', 'Enforces configurable usage restrictions on portable and mobile devices that connect to the component.', '62443-4-2 | FR2 Use Control', True),
    ('CR 2.4', 'Mobile code', 'Controls the use of mobile code technologies, restricting execution, transfer and interaction to authorized cases.', '62443-4-2 | FR2 Use Control', True),
    ('CR 2.5', 'Session lock', 'Prevents further access after a configurable period of inactivity by initiating a session lock until the user re-authenticates.', '62443-4-2 | FR2 Use Control', True),
    ('CR 2.6', 'Remote session termination', 'Allows an authorized operator to terminate a remote session either automatically after inactivity or manually on demand.', '62443-4-2 | FR2 Use Control', True),
    ('CR 2.7', 'Concurrent session control', 'Limits the number of concurrent sessions per interface for any given account or role.', '62443-4-2 | FR2 Use Control', True),
    ('CR 2.8', 'Auditable events', 'Generates audit records for security-relevant events such as access control, request errors, configuration changes and other defined activities.', '62443-4-2 | FR2 Use Control', True),
    ('CR 2.9', 'Audit storage capacity', 'Provides sufficient audit storage and mechanisms to reduce the likelihood of capacity being exceeded.', '62443-4-2 | FR2 Use Control', True),
    ('CR 2.10', 'Response to audit processing failures', 'Detects audit processing failures and responds without overwriting the oldest records unless configured to do so.', '62443-4-2 | FR2 Use Control', True),
    ('CR 2.11', 'Timestamps', 'Creates timestamps, including synchronization capability, for use in audit records and other time-sensitive functions.', '62443-4-2 | FR2 Use Control', True),
    ('CR 2.12', 'Non-repudiation', 'Records actions of individual human users so they cannot later deny having performed them.', '62443-4-2 | FR2 Use Control', True),
    ('CR 2.13', 'Use of physical diagnostic and test interfaces', 'Provides the capability to protect against unauthorized use of the physical diagnostic and test interfaces designed into the component.', '62443-4-2 | FR2 Use Control', True),
    ('CR 3.1', 'Communication integrity', 'Protects the integrity of transmitted information against unauthorized modification.', '62443-4-2 | FR3 System Integrity', True),
    ('CR 3.2', 'Protection from malicious code', 'Requires protection against and detection of malicious code; for components this requirement is realized through the applicable component-type requirements (SAR/EDR/HDR/NDR 3.2).', '62443-4-2 | FR3 System Integrity', True),
    ('CR 3.3', 'Security functionality verification', 'Supports verification that security functions operate correctly, at defined times or during normal operation.', '62443-4-2 | FR3 System Integrity', True),
    ('CR 3.4', 'Software and information integrity', 'Detects unauthorized changes to software, configuration and information at rest and reports detected violations.', '62443-4-2 | FR3 System Integrity', True),
    ('CR 3.5', 'Input validation', 'Validates the syntax, content and legality of inputs that affect control or influence outputs before acting on them.', '62443-4-2 | FR3 System Integrity', True),
    ('CR 3.6', 'Deterministic output', 'Sets outputs to a predetermined safe state when normal operation cannot be maintained.', '62443-4-2 | FR3 System Integrity', True),
    ('CR 3.7', 'Error handling', 'Handles error conditions gracefully without revealing sensitive information that could aid an attacker.', '62443-4-2 | FR3 System Integrity', True),
    ('CR 3.8', 'Session integrity', 'Protects the integrity of active sessions, including invalidating session identifiers on logout and rejecting forged or reused ones.', '62443-4-2 | FR3 System Integrity', True),
    ('CR 3.9', 'Protection of audit information', 'Protects audit records and audit tools from unauthorized access, modification and deletion.', '62443-4-2 | FR3 System Integrity', True),
    ('CR 3.10', 'Support for updates', 'Provides the capability to be updated and patched, with the authenticity and integrity of updates verified before installation; realized per component type.', '62443-4-2 | FR3 System Integrity', True),
    ('CR 3.11', 'Physical tamper resistance and detection', 'Addresses resistance to, and detection of, physical tampering with the component; realized per component type.', '62443-4-2 | FR3 System Integrity', True),
    ('CR 3.12', 'Provisioning product supplier roots of trust', 'Supports secure provisioning and protection of roots of trust supplied by the product supplier; realized per component type.', '62443-4-2 | FR3 System Integrity', True),
    ('CR 3.13', 'Provisioning asset owner roots of trust', 'Supports provisioning and protection of roots of trust supplied by the asset owner; realized per component type.', '62443-4-2 | FR3 System Integrity', True),
    ('CR 3.14', 'Integrity of the boot process', 'Verifies the authenticity and integrity of firmware and software during the boot sequence; realized per component type.', '62443-4-2 | FR3 System Integrity', True),
    ('CR 4.1', 'Information confidentiality', 'Protects the confidentiality of information at rest and in transit for which unauthorized disclosure is a concern.', '62443-4-2 | FR4 Data Confidentiality', True),
    ('CR 4.2', 'Information persistence', 'Provides the ability to erase information from shared or released resources so residual data is not exposed.', '62443-4-2 | FR4 Data Confidentiality', True),
    ('CR 4.3', 'Use of cryptography', 'When cryptography is employed, uses algorithms, key sizes and key management aligned with recognized security practices.', '62443-4-2 | FR4 Data Confidentiality', True),
    ('CR 5.1', 'Network segmentation', 'Supports logical segmentation of networks so the component can operate within and enforce zone and conduit boundaries.', '62443-4-2 | FR5 Restricted Data Flow', True),
    ('CR 5.2', 'Zone boundary protection', 'Addresses monitoring and control of communications at zone boundaries; for components this is realized through the network-device requirement (NDR 5.2).', '62443-4-2 | FR5 Restricted Data Flow', True),
    ('CR 5.3', 'General-purpose person-to-person communication restrictions', 'Addresses restriction of general-purpose person-to-person messaging across zone boundaries; realized through the network-device requirement (NDR 5.3).', '62443-4-2 | FR5 Restricted Data Flow', True),
    ('CR 5.4', 'Application partitioning', 'Supports partitioning of data, applications and services into security zones based on criticality to constrain data flow.', '62443-4-2 | FR5 Restricted Data Flow', True),
    ('CR 6.1', 'Audit log accessibility', 'Provides authorized users read access to audit logs in a usable form.', '62443-4-2 | FR6 Timely Response to Events', True),
    ('CR 6.2', 'Continuous monitoring', 'Supports continuous monitoring by making security-relevant events and status available for detection of incidents.', '62443-4-2 | FR6 Timely Response to Events', True),
    ('CR 7.1', 'Denial of service protection', 'Maintains essential functions in a degraded mode when subjected to denial-of-service conditions.', '62443-4-2 | FR7 Resource Availability', True),
    ('CR 7.2', 'Resource management', 'Limits the use of resources by security functions to prevent resource exhaustion from impairing operation.', '62443-4-2 | FR7 Resource Availability', True),
    ('CR 7.3', 'Control system backup', 'Supports backup of user-level and system-level information without disrupting normal operation.', '62443-4-2 | FR7 Resource Availability', True),
    ('CR 7.4', 'Control system recovery and reconstitution', 'Enables recovery and reconstitution to a known secure state after a disruption or failure.', '62443-4-2 | FR7 Resource Availability', True),
    ('CR 7.5', 'Emergency power', "Supports transition to and from emergency or backup power without affecting the component's security posture.", '62443-4-2 | FR7 Resource Availability', True),
    ('CR 7.6', 'Network and security configuration settings', 'Allows security-related configuration settings to be viewed and set according to recommended guidance.', '62443-4-2 | FR7 Resource Availability', True),
    ('CR 7.7', 'Least functionality', 'Restricts the component to the functions, ports, protocols and services necessary for its intended use.', '62443-4-2 | FR7 Resource Availability', True),
    ('CR 7.8', 'Control system component inventory', 'Provides the ability to report an inventory of its installed components and their attributes.', '62443-4-2 | FR7 Resource Availability', True),
    ('SAR 2.4', 'Mobile code (software application)', 'For software applications, enforces control of mobile code execution, integrity checking and origin restriction within the host environment.', '62443-4-2 | Component type – Software application', True),
    ('SAR 3.2', 'Protection from malicious code (software application)', 'Software applications provide or support mechanisms to protect against and detect malicious code.', '62443-4-2 | Component type – Software application', True),
    ('EDR 2.4', 'Mobile code (embedded device)', 'Embedded devices enforce control over mobile code execution, transfer and interaction appropriate to their platform.', '62443-4-2 | Component type – Embedded device', True),
    ('EDR 2.13', 'Use of physical diagnostic and test interfaces (embedded device)', 'Protects against unauthorized use of physical diagnostic and test interfaces on embedded devices.', '62443-4-2 | Component type – Embedded device', True),
    ('EDR 3.2', 'Protection from malicious code (embedded device)', 'Embedded devices provide protection against, and detection of, malicious code appropriate to their platform.', '62443-4-2 | Component type – Embedded device', True),
    ('EDR 3.10', 'Support for updates (embedded device)', 'Embedded devices support installation of validated and authenticated security updates and patches.', '62443-4-2 | Component type – Embedded device', True),
    ('EDR 3.11', 'Physical tamper resistance and detection (embedded device)', 'Embedded devices resist physical tampering and provide the ability to detect tamper attempts.', '62443-4-2 | Component type – Embedded device', True),
    ('EDR 3.12', 'Provisioning product supplier roots of trust (embedded device)', 'Embedded devices support secure provisioning and protection of supplier-supplied roots of trust.', '62443-4-2 | Component type – Embedded device', True),
    ('EDR 3.13', 'Provisioning asset owner roots of trust (embedded device)', 'Embedded devices support provisioning and protection of asset-owner roots of trust.', '62443-4-2 | Component type – Embedded device', True),
    ('EDR 3.14', 'Integrity of the boot process (embedded device)', 'Embedded devices verify the integrity and authenticity of firmware and software during the boot sequence.', '62443-4-2 | Component type – Embedded device', True),
    ('HDR 2.4', 'Mobile code (host device)', 'Host devices enforce control over mobile code execution, transfer and interaction within their operating environment.', '62443-4-2 | Component type – Host device', True),
    ('HDR 2.13', 'Use of physical diagnostic and test interfaces (host device)', 'Protects against unauthorized use of physical diagnostic and test interfaces on host devices.', '62443-4-2 | Component type – Host device', True),
    ('HDR 3.2', 'Protection from malicious code (host device)', 'Host devices provide protection against, and detection of, malicious code with the ability to update detection mechanisms.', '62443-4-2 | Component type – Host device', True),
    ('HDR 3.10', 'Support for updates (host device)', 'Host devices support installation of validated and authenticated security updates and patches.', '62443-4-2 | Component type – Host device', True),
    ('HDR 3.11', 'Physical tamper resistance and detection (host device)', 'Host devices resist physical tampering and provide the ability to detect tamper attempts.', '62443-4-2 | Component type – Host device', True),
    ('HDR 3.12', 'Provisioning product supplier roots of trust (host device)', 'Host devices support secure provisioning and protection of supplier-supplied roots of trust.', '62443-4-2 | Component type – Host device', True),
    ('HDR 3.13', 'Provisioning asset owner roots of trust (host device)', 'Host devices support provisioning and protection of asset-owner roots of trust.', '62443-4-2 | Component type – Host device', True),
    ('HDR 3.14', 'Integrity of the boot process (host device)', 'Host devices verify the integrity and authenticity of firmware and software during the boot sequence.', '62443-4-2 | Component type – Host device', True),
    ('NDR 1.6', 'Wireless access management (network device)', 'Network devices uniquely identify and authenticate all users and devices establishing wireless connections through them.', '62443-4-2 | Component type – Network device', True),
    ('NDR 1.13', 'Access via untrusted networks (network device)', 'Network devices monitor and control connection attempts to and from untrusted networks they interface with.', '62443-4-2 | Component type – Network device', True),
    ('NDR 2.4', 'Mobile code (network device)', 'Network devices enforce control over mobile code execution, transfer and interaction appropriate to their function.', '62443-4-2 | Component type – Network device', True),
    ('NDR 2.13', 'Use of physical diagnostic and test interfaces (network device)', 'Protects against unauthorized use of physical diagnostic and test interfaces on network devices.', '62443-4-2 | Component type – Network device', True),
    ('NDR 3.2', 'Protection from malicious code (network device)', 'Network devices provide protection against, and detection of, malicious code appropriate to their function.', '62443-4-2 | Component type – Network device', True),
    ('NDR 3.10', 'Support for updates (network device)', 'Network devices support installation of validated and authenticated security updates and patches.', '62443-4-2 | Component type – Network device', True),
    ('NDR 3.11', 'Physical tamper resistance and detection (network device)', 'Network devices resist physical tampering and provide the ability to detect tamper attempts.', '62443-4-2 | Component type – Network device', True),
    ('NDR 3.12', 'Provisioning product supplier roots of trust (network device)', 'Network devices support secure provisioning and protection of supplier-supplied roots of trust.', '62443-4-2 | Component type – Network device', True),
    ('NDR 3.13', 'Provisioning asset owner roots of trust (network device)', 'Network devices support provisioning and protection of asset-owner roots of trust.', '62443-4-2 | Component type – Network device', True),
    ('NDR 3.14', 'Integrity of the boot process (network device)', 'Network devices verify the integrity and authenticity of firmware and software during the boot sequence.', '62443-4-2 | Component type – Network device', True),
    ('NDR 5.2', 'Zone boundary protection (network device)', 'Network devices monitor and control communications at zone boundaries and can deny traffic by default, allowing only explicitly authorized flows.', '62443-4-2 | Component type – Network device', True),
    ('NDR 5.3', 'General-purpose person-to-person communication restrictions (network device)', 'Network devices restrict general-purpose person-to-person messaging from being received from or transmitted to systems outside the control zone.', '62443-4-2 | Component type – Network device', True),
]

TISAX_CONTROLS = [
    ('1.1.1', 'Information Security Policies', 'The organization maintains documented information security policies that are approved by management, communicated to all relevant parties, and reviewed at planned intervals or upon significant change.', '1 IS Policies & Organization', True),
    ('1.2.1', 'Governance of Information Security', 'Information security is steered through a defined management framework with clear objectives, demonstrable management commitment, and allocated resources.', '1 IS Policies & Organization', True),
    ('1.2.2', 'Security Roles and Responsibilities', 'Information security responsibilities are defined, assigned to competent individuals, and segregated to avoid conflicts of interest.', '1 IS Policies & Organization', True),
    ('1.2.3', 'Security in Projects', 'Information security requirements are identified, considered and addressed across all phases of projects.', '1 IS Policies & Organization', True),
    ('1.2.4', 'Responsibilities with External IT Providers', 'Responsibilities, interfaces and accountabilities between the organization and external IT service providers are clearly defined and documented.', '1 IS Policies & Organization', True),
    ('1.3.1', 'Inventory of Information Assets', 'Information assets are identified and recorded in an inventory, each with a designated owner responsible for its protection.', '1 IS Policies & Organization', True),
    ('1.3.2', 'Asset Classification and Protection Levels', 'Assets are classified and handled in line with their protection needs for confidentiality, integrity and availability.', '1 IS Policies & Organization', True),
    ('1.3.3', 'Approved Use of External IT Services', "Only assessed and authorized external IT services are permitted for processing the organization's information assets.", '1 IS Policies & Organization', True),
    ('1.4.1', 'Information Security Risk Management', 'Security risks are systematically identified, assessed, treated and monitored following a defined and repeatable methodology.', '1 IS Policies & Organization', True),
    ('1.5.1', 'Compliance within Processes and Procedures', 'Adherence to information security requirements is verified within operational procedures and processes on a recurring basis.', '1 IS Policies & Organization', True),
    ('1.5.2', 'Independent Review of the ISMS', 'The information security management system is periodically reviewed by an independent and objective authority.', '1 IS Policies & Organization', True),
    ('1.6.1', 'Handling of Information Security Events', 'Security events and weaknesses are reported, evaluated, responded to in a timely manner, and used to derive improvements.', '1 IS Policies & Organization', True),
    ('2.1.1', 'Qualification for Sensitive Roles', 'The suitability and qualification of personnel assigned to security-sensitive activities are verified prior to and during employment.', '2 Human Resources', True),
    ('2.1.2', 'Employee Security Obligations', 'All personnel are formally committed to comply with information security rules, confidentiality and acceptable-use requirements.', '2 Human Resources', True),
    ('2.1.3', 'Security Awareness and Training', 'Staff receive regular awareness activities and role-appropriate training on information security risks and their responsibilities.', '2 Human Resources', True),
    ('2.1.4', 'Remote and Mobile Working', 'Teleworking and mobile working arrangements are governed by rules that safeguard information handled outside company premises.', '2 Human Resources', True),
    ('3.1.1', 'Physical Security Zones', 'Physical perimeters and security zones protect facilities and information assets against unauthorized access and environmental threats.', '3 Physical Security & Business Continuity', True),
    ('3.1.2', 'Information Security in Exceptional Situations', 'Business continuity and emergency arrangements ensure that information security requirements remain effective during exceptional situations and disruptions to operations.', '3 Physical Security & Business Continuity', True),
    ('3.1.3', 'Handling of Supporting Assets', 'Supporting assets such as equipment, cabling and utilities are protected and maintained to preserve the availability and integrity of information processing.', '3 Physical Security & Business Continuity', True),
    ('4.1.1', 'Management of Identification Means', 'The issuance, use, return and revocation of identification and authentication means are controlled across their entire lifecycle.', '4 Identity & Access Management', True),
    ('4.2.1', 'Access Control to Systems and Applications', 'User and privileged access to networks, IT systems and applications is granted on a need-to-know basis, periodically reviewed, and protected by strong authentication where the protection need requires it.', '4 Identity & Access Management', True),
    ('5.1.1', 'Management of cryptographic procedures and keys', 'Cryptographic methods are governed and applied to protect the confidentiality, integrity and authenticity of information, with defined rules for generating, distributing, storing, renewing and revoking keys across their whole lifecycle.', '5 IT/Cyber Security', True),
    ('5.1.2', 'Protection of information during transfer', 'Information exchanged over networks or with external parties is safeguarded against unauthorized access, alteration or loss using appropriate transport protection such as encryption and secured transfer channels.', '5 IT/Cyber Security', True),
    ('5.2.1', 'Change management', 'Changes to IT systems and applications are requested, assessed for security impact, approved, tested and documented before deployment so that modifications do not weaken the protection of information.', '5 IT/Cyber Security', True),
    ('5.2.2', 'Separation of development, test and operational environments', 'Development, test and production environments are kept apart, and productive data is not used in non-productive environments without adequate protection, reducing the risk of unauthorized change and data exposure.', '5 IT/Cyber Security', True),
    ('5.2.3', 'Protection against malware', 'Technical and organizational safeguards detect, prevent and respond to malicious code across IT systems, including up-to-date protection mechanisms and user awareness measures.', '5 IT/Cyber Security', True),
    ('5.2.4', 'Recording and analysis of event logs', 'Security-relevant events are logged, protected against tampering, retained for an appropriate period and regularly evaluated so that anomalies and incidents can be identified in a timely manner.', '5 IT/Cyber Security', True),
    ('5.2.5', 'Vulnerability and patch management', 'Technical vulnerabilities in IT systems are identified, risk-assessed and remediated in a controlled and timely way, including a defined process for obtaining, testing and applying security updates.', '5 IT/Cyber Security', True),
    ('5.2.6', 'Technical audit of IT systems and services', "IT systems and services undergo periodic technical checks or audits to confirm that configuration and protective measures conform to the organization's security requirements and to surface deviations.", '5 IT/Cyber Security', True),
    ('5.2.7', 'Network management', "The organization's networks are designed, segmented, controlled and monitored to protect the information carried over them and to restrict traffic between zones of differing trust levels.", '5 IT/Cyber Security', True),
    ('5.2.8', 'Continuity planning for IT services', 'Plans and measures are prepared to maintain or restore critical IT services during disruptions, including fallback and manual modes, alternative information flows and defined emergency operating procedures.', '5 IT/Cyber Security', True),
    ('5.2.9', 'Backup and recovery of data and IT services', 'A defined and regularly tested backup strategy protects data and IT services, with agreed recovery objectives (RTO/RPO) and safeguards that keep backup copies resilient against loss, corruption or ransomware.', '5 IT/Cyber Security', True),
    ('5.3.1', 'Information security in new and further developed IT systems', 'Information security requirements are defined and taken into account when acquiring, developing or enhancing IT systems, with secure engineering practices applied throughout the system and software development lifecycle.', '5 IT/Cyber Security', True),
    ('5.3.2', 'Security requirements for network services', 'Security features, service levels and management requirements for network services are identified and agreed, whether the services are provided internally or by external providers.', '5 IT/Cyber Security', True),
    ('5.3.3', 'Return and secure removal of information from external IT services', 'Arrangements ensure that information assets held in external IT services can be retrieved and are securely and verifiably deleted when the service ends or is changed.', '5 IT/Cyber Security', True),
    ('5.3.4', 'Protection of information in shared external (cloud) services', "When information is processed in shared or multi-tenant external IT services such as cloud platforms, logical segregation and protective measures prevent other tenants from accessing the organization's data.", '5 IT/Cyber Security', True),
    ('6.1.1', 'Information security with contractors and cooperation partners', 'Security expectations for suppliers and partners are set based on risk, agreed contractually and monitored so that information shared with or processed by them remains adequately protected.', '6 Supplier Relationships', True),
    ('6.1.2', 'Non-disclosure agreements for information exchange', 'Confidentiality and non-disclosure requirements are identified, documented and agreed with the relevant parties before sensitive information is exchanged, and are reviewed and enforced over time.', '6 Supplier Relationships', True),
    ('7.1.1', 'Compliance with regulatory and contractual provisions', "Applicable legal, regulatory and contractual obligations relevant to information security are identified, kept current and reflected in the organization's controls and practices.", '7 Compliance', True),
    ('7.1.2', 'Consideration of personal data protection', 'Where personally identifiable data is processed, the applicable legal and contractual data protection requirements are identified and reflected within the ISMS as part of information security governance.', '7 Compliance', True),
    ('8.1.1', 'Security concept for prototype security areas', 'A documented security concept must define the security areas used to protect prototypes and set the protective measures required for each classification level assigned by the client.', 'Prototype Protection', True),
    ('8.1.2', 'Structural and perimeter protection of security areas', 'Structural and physical safeguards must protect prototypes, prototypical components and parts within security areas, scaled to the protection level demanded by the client.', 'Prototype Protection', True),
    ('8.1.3', 'Access control to security areas', 'Entry to prototype security areas must be limited to authorized persons through documented authorization, identification and logging, with enforced visitor and escort rules.', 'Prototype Protection', True),
    ('8.1.4', 'Protection against unauthorized visual observation', 'Measures must prevent unauthorized line-of-sight or visual observation of prototypes, including shielding of windows, gates, test benches and outdoor areas.', 'Prototype Protection', True),
    ('8.1.5', 'Intrusion detection and surveillance of security areas', 'Security areas must be monitored through intrusion detection, alarm and surveillance measures (e.g. CCTV) with defined recording, retention and response procedures.', 'Prototype Protection', True),
    ('8.1.6', 'Control of cameras and recording devices in security areas', 'The introduction and use of cameras, mobile devices and other recording equipment inside prototype security areas must be restricted and controlled.', 'Prototype Protection', True),
    ('8.2.1', 'Prototype protection governance and responsibilities', 'Governance for prototype protection must be established, maintained and communicated, defining roles, responsibilities and the management of protective measures.', 'Prototype Protection', True),
    ('8.2.2', 'Classification and protection-level determination', 'Prototypes and related information must be classified and assigned the protection level required by the client, and this classification must drive the applicable safeguards.', 'Prototype Protection', True),
    ('8.2.3', 'Confidentiality obligations and awareness', 'Persons with access to prototypes must be bound by non-disclosure obligations and receive awareness training on prototype protection rules before access is granted.', 'Prototype Protection', True),
    ('8.2.4', 'Contractual prototype-protection requirements with clients', 'Prototype protection obligations agreed with the client must be captured contractually and translated into internal requirements before classified items are handled.', 'Prototype Protection', True),
    ('8.2.5', 'Requirements toward external parties and subcontractors', 'Prototype protection requirements must be imposed on suppliers, service providers and subcontractors, including flow-down of obligations and the right to verify compliance.', 'Prototype Protection', True),
    ('8.2.6', 'Verification of compliance and handling of deviations', 'Adherence to prototype protection requirements must be checked periodically and ad hoc, with a defined process to escalate and remediate deviations.', 'Prototype Protection', True),
    ('8.2.7', 'Reporting and management of prototype security incidents', 'A process must ensure that prototype security incidents, including suspected disclosure, are reported, escalated to the client and managed to resolution.', 'Prototype Protection', True),
    ('8.3.1', 'Handling and storage of test vehicles and components', 'Requirements must govern receipt, storage, movement, use and disposal of classified test/trial vehicles, components and parts so exposure is limited to authorized purposes and persons.', 'Prototype Protection', True),
    ('8.3.2', 'Camouflage and disguise of prototypes', "Classified vehicles and components must be camouflaged or disguised per the client's requirements whenever exposed outside protected areas, including during transport and road use.", 'Prototype Protection', True),
    ('8.3.3', 'Transport of prototypes', 'Transport of prototypes and prototypical parts must follow secure logistics requirements covering routing, packaging, tracking, handover and protection against loss, theft or observation.', 'Prototype Protection', True),
    ('8.3.4', 'Reporting of loss or theft of prototypes', 'Loss, theft or disappearance of classified vehicles, components or parts must be detected and reported to the client without undue delay under a defined procedure.', 'Prototype Protection', True),
    ('8.4.1', 'Planning and conduct of test and trial drives', 'Test and trial drives of classified vehicles must be planned and conducted under defined rules for location, camouflage, authorized personnel and protection against observation and recording.', 'Prototype Protection', True),
    ('8.4.2', 'Use of prototypes on public roads and test grounds', 'Requirements must govern the use of classified vehicles on public roads and dedicated test grounds, limiting exposure and enforcing camouflage and behavioural rules for drivers.', 'Prototype Protection', True),
    ('8.5.1', 'Requirements for events and presentations', 'Events, workshops and presentations involving prototypes must apply defined protective measures covering venue security, guest lists, access control and prevention of unauthorized recording.', 'Prototype Protection', True),
    ('8.5.2', 'Requirements for film and photo shootings', 'Film and photo shootings of classified vehicles or components must follow defined rules on location, personnel authorization, on-site handling and protection against uncontrolled capture.', 'Prototype Protection', True),
    ('8.5.3', 'Handling and release of captured media material', "Film, photo and recorded material of prototypes must be securely stored, access-controlled and released only after approval in line with the client's requirements.", 'Prototype Protection', True),
    ('9.1.1', 'Data protection governance and accountability', 'Responsibilities for data protection must be defined and assigned, including any required data protection officer, so that lawful processing of personal data can be demonstrated.', 'Data Protection', True),
    ('9.1.2', 'Records of processing activities', 'A record of processing activities carried out as controller and as processor must be maintained and kept current in line with Art. 30 GDPR.', 'Data Protection', True),
    ('9.1.3', 'Lawful basis for processing personal data', 'Every processing activity must rest on a documented lawful basis, and processing must remain limited to the defined purposes.', 'Data Protection', True),
    ('9.1.4', 'Transparency and information obligations', 'Data subjects must be provided with the required information about the processing of their personal data in a transparent and accessible manner.', 'Data Protection', True),
    ('9.1.5', 'Handling of data subject rights', 'Procedures must enable requests for access, rectification, erasure, restriction, portability and objection to be identified, verified and fulfilled within legal deadlines.', 'Data Protection', True),
    ('9.1.6', 'Data protection impact assessments', 'Processing likely to result in a high risk to individuals must be evaluated through a data protection impact assessment with documented mitigation and, where needed, prior consultation.', 'Data Protection', True),
    ('9.1.7', 'Order processing agreement under Art. 28 GDPR', "Where personal data is processed on behalf of a client, a written order-processing agreement meeting Art. 28 GDPR must be concluded before processing begins and processing must follow the controller's documented instructions.", 'Data Protection', True),
    ('9.1.8', 'Engagement and control of sub-processors', "Sub-processors must be engaged only with the controller's authorization and under equivalent data protection obligations, with the processor remaining liable for their compliance.", 'Data Protection', True),
    ('9.1.9', 'International transfers of personal data', 'Transfers of personal data to third countries must be covered by an appropriate transfer mechanism such as standard contractual clauses or an adequacy decision.', 'Data Protection', True),
    ('9.1.10', 'Technical and organizational measures', 'Appropriate technical and organizational measures per Art. 32 GDPR must ensure a level of security appropriate to the risk of the processing performed.', 'Data Protection', True),
    ('9.1.11', 'Personal data breach detection and notification', 'Personal data breaches must be detected, documented and, where required, notified to the supervisory authority and affected individuals within the deadlines of Art. 33 and 34 GDPR; as processor, the controller must be informed without undue delay.', 'Data Protection', True),
    ('9.1.12', 'Retention, deletion and return of personal data', 'Personal data must be retained only as long as necessary and, at the end of processing, deleted or returned as chosen by the controller unless legal retention applies.', 'Data Protection', True),
]

CONTROLS = {"iec-62443": IEC_62443_CONTROLS, "TISAX": TISAX_CONTROLS}


def upsert_framework(cur, short_name):
    meta = FRAMEWORK_META[short_name]
    row = cur.execute(
        "SELECT id FROM frameworks WHERE short_name=?", (short_name,)
    ).fetchone()
    if row:
        fid = row[0]
        cur.execute(
            "UPDATE frameworks SET name=?, version=?, description=?, issuing_body=?, "
            "applicable_regions=?, applicable_industries=?, status='active', is_builtin=1, "
            "updated_at=? WHERE id=?",
            (meta["name"], meta["version"], meta["description"], meta["issuing_body"],
             meta["regions"], meta["industries"], NOW, fid),
        )
        return fid, False
    fid = uid()
    cur.execute(
        "INSERT INTO frameworks (id, name, short_name, version, description, issuing_body, "
        "applicable_regions, applicable_industries, status, is_builtin, tenant_id, "
        "created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,'active',1,NULL,?,?)",
        (fid, meta["name"], short_name, meta["version"], meta["description"],
         meta["issuing_body"], meta["regions"], meta["industries"], NOW, NOW),
    )
    return fid, True


def upsert_controls(cur, fid, controls):
    new_ids = {c[0] for c in controls}
    existing = {
        r[0]: r[1]
        for r in cur.execute(
            "SELECT control_id, id FROM framework_controls WHERE framework_id=?", (fid,)
        )
    }
    removed = 0
    for cid, rowid in existing.items():
        if cid not in new_ids:
            cur.execute("DELETE FROM control_requirements WHERE control_id=?", (rowid,))
            cur.execute("DELETE FROM framework_controls WHERE id=?", (rowid,))
            removed += 1
    inserted = updated = 0
    for sort, (cid, title, desc, category, mandatory) in enumerate(controls):
        if cid in existing:
            cur.execute(
                "UPDATE framework_controls SET title=?, description=?, category=?, "
                "sort_order=?, is_mandatory=?, updated_at=? WHERE id=?",
                (title, desc, category, sort, 1 if mandatory else 0, NOW, existing[cid]),
            )
            updated += 1
        else:
            cur.execute(
                "INSERT INTO framework_controls (id, framework_id, control_id, title, "
                "description, guidance, category, parent_id, sort_order, mapped_controls, "
                "tags, is_mandatory, created_at, updated_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (uid(), fid, cid, title, desc, "", category, None, sort, "[]", "[]",
                 1 if mandatory else 0, NOW, NOW),
            )
            inserted += 1
    return inserted, updated, removed


def main():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    try:
        for short_name, controls in CONTROLS.items():
            fid, created = upsert_framework(cur, short_name)
            ins, upd, rem = upsert_controls(cur, fid, controls)
            action = "Created" if created else "Updated"
            print(
                f"{action} {short_name}: {ins} inserted, {upd} updated, "
                f"{rem} removed ({len(controls)} total controls)."
            )
        conn.commit()
        print("\nDone. IEC 62443 + TISAX catalogues committed.")
    except Exception as e:
        conn.rollback()
        print(f"Error: {e}")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
