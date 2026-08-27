"""
Migration script: Add CIS FortiGate 7.4.x Benchmark v1.0.1 as a built-in framework.

Control IDs, titles, rationale/description, and remediation text are sourced from
Tenable's compliance audit files (a licensed implementation of the official CIS
benchmark) at tenable.com/audits/CIS_FortiGate_7.4.x_v1.0.1_L1 and _L2 - 64 controls
total (39 Level 1 + 25 Level 2), the complete real control set for this benchmark
version (sections 1-7; there is no wireless/switch/access-point content in the
official CIS FortiGate benchmark).

Run from the backend/ directory:
    python add_cis_fortigate_framework.py
"""

import json
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


def framework_exists(cur, short_name):
    cur.execute("SELECT id FROM frameworks WHERE short_name=?", (short_name,))
    return cur.fetchone() is not None


# -----------------------------------------------------------------
# CIS FortiGate 7.4.x Benchmark v1.0.1 - 64 controls (39 L1 + 25 L2)
# -----------------------------------------------------------------
CIS_FORTIGATE_CONTROLS = json.loads(r'''
[
  {
    "control_id": "1.1",
    "title": "Ensure DNS server is configured",
    "description": "Fortinet uses the Domain Name Service (DNS) to translate host names into IP addresses. To enable DNS lookups, you must specify the primary DNS server for your system; secondary and tertiary DNS servers can also be specified. When resolving host names, the system consults the primary name server, falling back to the secondary if a failure or time-out occurs. For security purposes, trusted DNS servers should be configured to prevent man-in-the-middle attacks — the goal is to resolve system hostnames to IP addresses using trusted DNS servers.",
    "guidance": "Configure trusted DNS servers via CLI or GUI.\n\nCLI:\n```\nFGT1 # config system dns\nFGT1 (dns) # set primary 8.8.8.8\nFGT1 (dns) # set secondary 8.8.4.4\nFGT1 (dns) # end\nFGT1 #\n```\n\nGUI: Navigate to Networks > DNS, click \"Specify,\" and enter 8.8.8.8 as the primary DNS server and 8.8.4.4 as the secondary DNS server.",
    "category": "1 Network Configuration",
    "sort_order": 0,
    "is_mandatory": 1,
    "tags": [
      "level:L1",
      "800-53|SC-20",
      "800-53|SC-21",
      "800-53|SC-22",
      "CSCv7|11.1"
    ]
  },
  {
    "control_id": "1.2",
    "title": "Ensure intra-zone traffic is not always allowed",
    "description": "Rationale (per Tenable's raw page data, field \"infos\"): This is to make sure that only specific, authorized traffic is allowed between networks in the same zone. This adds an extra layer of protection between different networks.",
    "guidance": "In this example, we'll turn off intra-zone traffic in the zone DMZ.\n\nIn CLI:\n\nFGT1 # config system zone\nFGT1 (zone) # edit DMZ\nFGT1 (DMZ) # set intrazone deny\nFGT1 (DMZ) # end\nFGT1 #\n\nIn the GUI, click on Network -> Interfaces, select the zone and click on \"Edit\" and turn on \"Block intra-zone traffic\"",
    "category": "1 Network Configuration",
    "sort_order": 1,
    "is_mandatory": 1,
    "tags": [
      "level:L1",
      "800-53|CA-9",
      "800-53|SC-7",
      "CSCv7|2.10"
    ]
  },
  {
    "control_id": "1.3",
    "title": "Disable all management related services on WAN port",
    "description": "Enabling management-related services (HTTPS, HTTP, ping, SSH, SNMP, Radius) on the WAN interface is high risk. These services should only be enabled on a dedicated management interface, not on WAN. Doing so is part of defending the firewall from attacks and reducing the attack surface — vendor device vulnerabilities are commonly tied to management services, and exposing them on WAN lets attackers exploit those vulnerabilities.",
    "guidance": "GUI: Go to \"Network\" > \"Interfaces\". Review the WAN interface and disable HTTPS, HTTP, ping, SSH, SNMP, and Radius services.\n\nCLI:\n```\nFGT1 # config system interface\nFGT1 (interface) # edit \"port1\"\nFGT1 (port1) # unselect allowaccess ping https ssh snmp http radius-acct\n```\nNote: interface name (e.g. \"port1\") may vary by deployment; the \"unselect allowaccess\" command only removes services currently enabled.",
    "category": "1 Network Configuration",
    "sort_order": 2,
    "is_mandatory": 1,
    "tags": [
      "level:L1",
      "800-53|CM-6",
      "800-53|CM-7",
      "CSCv7|1.6"
    ]
  },
  {
    "control_id": "2.1.1",
    "title": "Ensure 'Pre-Login Banner' is set",
    "description": "Rationale (from \"infos\" field): Configure a pre-login banner, ideally approved by the organization's legal team. This banner should, at minimum, prohibit unauthorized access, provide notice of logging or monitoring, and avoid using the word \"welcome\" or similar words of invitation. Through a properly stated login banner, the risk of unintentional access to the device by unauthorized users is reduced. Should legal action take place against a person accessing the device without authorization, the login banner greatly diminishes a defendant's claim of ignorance.",
    "guidance": "Run the following command in the CLI to enable the pre-login-banner:\n\nFG1 # config system global\nFG1 (global) # set pre-login-banner enable\nFG1 (global) # end\nFG1 #\n\nIn the GUI, to edit the content of the pre-login disclaimer message:\n\n- Go to 'System' -> 'Replacement Messages' -> 'Extended View' -> 'Pre-login Disclaimer Message'. The edit screen is on the bottom right corner of the page. Click on \"Save\" after the editing is done.\n\nImpact:\n\nLogin banners provide a definitive warning to any possible intruders who may want to access the FortiGate that certain types of activity are illegal. At the same time, it also advises the authorized and legitimate users of their obligations relating to acceptable use.",
    "category": "2.1 System Settings",
    "sort_order": 3,
    "is_mandatory": 1,
    "tags": [
      "level:L1",
      "800-53|AC-8"
    ]
  },
  {
    "control_id": "2.1.2",
    "title": "Ensure 'Post-Login-Banner' is set",
    "description": "2.1.2 Ensure 'Post-Login-Banner' is set (CIS FortiGate 7.4.x v1.0.1, L1). Sets the banner displayed after a user successfully logs in — equivalent to a Message of the Day (MOTD) on other systems. Network banners serve a legal function: they help establish consent to monitoring and file retrieval, and protect against Fourth Amendment privacy claims on government networks.",
    "guidance": "CLI:\n```\nFG1 # config system global\nFG1 (global) # set post-login-banner enable\nFG1 (global) # end\nFG1 #\n```\n\nGUI: Navigate to System > Replace Messages > Extended View > \"Post-login Disclaimer Message\", edit the content in the bottom right corner, then save.\n\nImpact note: enabling this requires an acceptance action (pressing \"A\" or \"Accept\") in both the CLI and the GUI, which may affect automated scripts.",
    "category": "2.1 System Settings",
    "sort_order": 4,
    "is_mandatory": 1,
    "tags": [
      "level:L1",
      "CIS FortiGate 7.4.x v1.0.1 L1",
      "800-53|AC-8"
    ]
  },
  {
    "control_id": "2.1.3",
    "title": "Ensure timezone is properly configured",
    "description": "Sets the local time zone information so that the device displays time relevant to viewers. Accurate device time serves two critical functions: validating digital certificates against their validity periods, and generating reliable timestamps for logging. These timestamps matter across syslog servers, SNMP monitoring, and packet captures. Impact: For many features to work, including scheduling, logging, and SSL-dependent features, the FortiOS system time must be accurate.",
    "guidance": "The guidance uses Eastern Timezone (GMT-5:00, ID 12) as an example.\n\nCLI:\nconfig system global\nset timezone 12\nend\n\nGUI: Navigate to System > Settings, then select \"(GMT-5:00) Eastern Time (US & Canada)\" under System Time.",
    "category": "2.1 System Settings",
    "sort_order": 5,
    "is_mandatory": 1,
    "tags": [
      "level:L1",
      "800-53|AU-7, AU-8",
      "CSCv7|6.1"
    ]
  },
  {
    "control_id": "2.1.4",
    "title": "Ensure correct system time is configured through NTP",
    "description": "NTP enables the device to maintain accurate time and date when receiving updates from a reliable NTP server. Accurate timestamps are critical when correlating events with other systems, troubleshooting, or performing investigative work.",
    "guidance": "Run the following commands to configure NTP:\n\nconfig system ntp\n    set type custom\n    config ntpserver\n        edit 1\n            set server pool.ntp.org\n        next\n        edit 2\n            set server 1.1.1.1\n        end\n    end",
    "category": "2.1 System Settings",
    "sort_order": 6,
    "is_mandatory": 1,
    "tags": [
      "level:L1",
      "800-53|AU-7",
      "800-53|AU-8",
      "CSCv7|6.1"
    ]
  },
  {
    "control_id": "2.1.5",
    "title": "Ensure hostname is set",
    "description": "Changes the device's default hostname. The device hostname plays an important role in asset inventory and identification as a security requirement. It is also crucial in public key and certificate deployments, as well as when correlating logs from different systems during incident handling. (Note: Nessus provides the target output to assist in reviewing the benchmark to ensure target compliance.)",
    "guidance": "In CLI, set the hostname to 'New_FGT1' as follows:\n\nFGT1 # config system global\nFGT1 (global) # set hostname \"New_FGT1\"\nFGT1 (global) # end\nNew_FGT1 #\n\nIn GUI\n1) Go to 'System' > 'Settings'\n2) Update the field 'Hostname' with the new hostname\n3) click 'Apply'",
    "category": "2.1 System Settings",
    "sort_order": 7,
    "is_mandatory": 1,
    "tags": [
      "level:L1",
      "800-53|SC-20"
    ]
  },
  {
    "control_id": "2.1.6",
    "title": "Ensure the latest firmware is installed",
    "description": "Checks whether the FortiGate is running the latest stable firmware release from Fortinet. Firmware updates are periodically released to add features and, critically, to patch known vulnerabilities, so falling behind leaves the device exposed to well-known, already-published exploits.",
    "guidance": "Determine the correct upgrade path, then download and install the firmware:\n1. Visit https://docs.fortinet.com/upgrade-tool, select the product, current FortiOS version, and target version, then download the necessary intermediate/target firmware versions.\n2. Go to https://support.fortinet.com, navigate to Support > Firmware Download, select the product model and version, and download the firmware image.\n3. In the GUI: go to System > Fabric Management, right-click the device that needs to be upgraded, then click \"Upgrade\".\n\nNo CLI command sequence is given for this control on the source page — remediation is performed via the FortiGate GUI as described above.",
    "category": "2.1 System Settings",
    "sort_order": 8,
    "is_mandatory": 0,
    "tags": [
      "level:L2",
      "800-53|SI-3",
      "CSCv7|2.2",
      "CSCv7|8.2",
      "CSCv7|11.4"
    ]
  },
  {
    "control_id": "2.1.7",
    "title": "Disable USB Firmware and configuration installation",
    "description": "Disable the USB port auto-install feature for configuration and firmware on FortiGate. Disabling USB auto-install prevents a USB drive containing a manipulated configuration or incorrect firmware image from being connected and loaded automatically, which could otherwise be used to compromise or take over the device.",
    "guidance": "Run the following commands via the CLI console:\n\nconfig system auto-install\nset auto-install-config disable\nset auto-install-image disable\nend",
    "category": "2.1 System Settings",
    "sort_order": 9,
    "is_mandatory": 0,
    "tags": [
      "level:L2",
      "800-53|CM-6",
      "800-53|CM-7",
      "CSCv7|11.3"
    ]
  },
  {
    "control_id": "2.1.8",
    "title": "Disable static keys for TLS",
    "description": "Disable support for static keys on TLS sessions terminating on the FortiGate. This prevents TLS sessions terminating on the FortiGate from using static SSL keys, which do not provide forward secrecy and are considered weaker than ephemeral key exchange methods.",
    "guidance": "CLI configuration commands:\n\nconfig system global\n    set ssl-static-key-ciphers disable\nend",
    "category": "2.1 System Settings",
    "sort_order": 10,
    "is_mandatory": 0,
    "tags": [
      "level:L2",
      "800-53|CM-6",
      "800-53|CM-7",
      "CSCv7|12.4"
    ]
  },
  {
    "control_id": "2.1.9",
    "title": "Enable Global Strong Encryption",
    "description": "Enable FortiOS to only use strong encryption and allow only strong ciphers for communication.",
    "guidance": "CLI:\n\nconfig system global\nset strong-crypto enable\nend",
    "category": "2.1 System Settings",
    "sort_order": 11,
    "is_mandatory": 0,
    "tags": [
      "level:L2",
      "800-53|SC-12",
      "CSCv7|18.5"
    ]
  },
  {
    "control_id": "2.1.10",
    "title": "Ensure management GUI listens on secure TLS version",
    "description": "Rationale: As we move towards better encryption capabilities, we need to also ensure GUI access is properly secured. TLS 1.3 is currently the most secure SSL/TLS supported version for SSL-encrypted administrator access (at this time of writing). Use higher version of SSL/TLS to prevent MiTM (man-in-the-middle) attacks.",
    "guidance": "CLI:\n\nconfig system global\nset admin-https-ssl-versions tlsv1-3",
    "category": "2.1 System Settings",
    "sort_order": 12,
    "is_mandatory": 1,
    "tags": [
      "level:L1",
      "800-53|AC-18"
    ]
  },
  {
    "control_id": "2.1.11",
    "title": "Ensure CDN is enabled for improved GUI performance",
    "description": "CIS FortiGate 7.4.x Benchmark control 2.1.11 \"Ensure CDN is enabled for improved GUI performance\" (Level 2). Rationale: to improve GUI performance, FortiGate offers an option to load static GUI artifacts from CDN (content delivery network) servers located closer to the user rather than serving them directly from the FortiGate appliance. Remote administrative access can be slow due to geographical distance between the admin and the device, and enabling CDN caching improves the web management console experience, with fallback to the FortiGate itself if the CDN is unavailable. Per the benchmark, this is not a security-impacting setting, so non-compliance carries no direct security impact.",
    "guidance": "Enable CDN usage for the GUI via the CLI:\n\nconfig system global\n    set gui-cdn-usage enable\nend",
    "category": "2.1 System Settings",
    "sort_order": 13,
    "is_mandatory": 0,
    "tags": [
      "level:L2",
      "800-53|CM-6"
    ]
  },
  {
    "control_id": "2.1.12",
    "title": "Ensure single CPU core overloaded event is logged",
    "description": "CIS FortiGate 7.4.x v1.0.1 L1 control 2.1.12 (Ensure single CPU core overloaded event is logged) enables the log-single-cpu-high option under config system global, which polls each CPU core's usage every three seconds and logs an event whenever a single core exceeds the CPU usage threshold (that core is then excluded from re-checking for the next 30 seconds). The control matters because FortiGate's dashboard and reporting only surface overall/aggregate CPU usage, so on multi-core units a single overloaded core can go unnoticed even while total CPU usage looks low, which can silently stall traffic processing on that core.",
    "guidance": "On CLI:\n\nconfig system global\n    set log-single-cpu-high enable\nend",
    "category": "2.1 System Settings",
    "sort_order": 14,
    "is_mandatory": 1,
    "tags": [
      "level:L1",
      "800-53|AU-3",
      "800-53|AU-3(1)",
      "800-53|AU-7",
      "800-53|AU-12",
      "CSCv7|6.2"
    ]
  },
  {
    "control_id": "2.1.13",
    "title": "Ensure Hostname is Not Displayed On Login GUI",
    "description": "CIS FortiGate 7.4.x v1.0.1 L2 benchmark control \"2.1.13 Ensure Hostname is Not Displayed On Login GUI\" (Tenable audit item page). Rationale: Ensure that the device hostname is not displayed on the GUI login page. The hostname of the device may be displayed on the GUI login page which may provide information for reconnaissance. Category: SYSTEM AND COMMUNICATIONS PROTECTION. Plugin: FortiGate.",
    "guidance": "To disable \"gui-display-hostname\"\n\nIn the CLI:\n\nFGT1 # config system global\nFGT1 (global) # set gui-display-hostname disable\nFGT1 (global) # end\nFGT1 #",
    "category": "2.1 System Settings",
    "sort_order": 15,
    "is_mandatory": 0,
    "tags": [
      "level:L2",
      "Audit Name: CIS FortiGate 7.4.x v1.0.1 L2",
      "Category: SYSTEM AND COMMUNICATIONS PROTECTION",
      "800-53|SC-7(16)",
      "Plugin: FortiGate"
    ]
  },
  {
    "control_id": "2.2.1",
    "title": "Ensure 'Password Policy' is enabled",
    "description": "It is important to use secure and complex passwords to prevent unauthorized access to the FortiGate device. Attackers can use brute force password software to launch more than just dictionary attacks, including attacks that discover common passwords where a letter is replaced by a number or symbol. CIS recommends that passwords be at least 14 characters long with no limit on the enforced maximum number of characters.",
    "guidance": "Configuration may be done via CLI or GUI interface.\n\nCLI approach:\n```\nconfig system password-policy\nset status enable\nset apply-to admin-password ipsec-preshared-key\nset minimum-length 14\nend\n```\n\nGUI approach:\n1) Log in as Super Admin\n2) Navigate to System > Settings\n3) Locate Password Policy section\n4) Change Password scope from \"Off\" to \"Both\"\n5) Set Minimum length to \"14\"\n\nImpact: Weak passwords enable unauthorized access; compromised accounts may allow attackers to modify critical system settings.",
    "category": "2.2 Password Policy",
    "sort_order": 16,
    "is_mandatory": 1,
    "tags": [
      "level:L1",
      "800-53|IA-5(1)",
      "CSCv7|4.4"
    ]
  },
  {
    "control_id": "2.2.2",
    "title": "Ensure administrator password retries and lockout time are configured",
    "description": "Failed login attempts can indicate malicious attempts to gain access to the network. FortiGate is preconfigured to limit the number of failed administrator login attempts; once the maximum number of failed attempts is reached, access to the account is blocked for the configured lockout period. Restricting the number of failed login attempts before a lockout period is a security best practice — it minimizes attempts to gain unauthorized access, since a failed login could indicate an invalid user or a hacker, and the lockout period further minimizes hacker attempts to gain access to the firewall.",
    "guidance": "To configure the lockout options, from CLI:\n\nconfig system global\n    set admin-lockout-threshold 3\n    set admin-lockout-duration 900\nend\n\nNote: Lockout affects the offending IP address, not the entire account.\n\nImpact (of not remediating): Attackers will keep attempting to access the device through brute force attacks without any interruption, which may lead to a successful login.\n\nSee also: https://workbench.cisecurity.org/benchmarks/24708",
    "category": "2.2 Password Policy",
    "sort_order": 17,
    "is_mandatory": 1,
    "tags": [
      "level:L1",
      "800-53|AC-6(2)",
      "800-53|AC-6(5)",
      "CSCv7|4.3"
    ]
  },
  {
    "control_id": "2.3.1",
    "title": "Ensure only SNMPv3 is enabled",
    "description": "Ensures that only SNMPv3 is enabled on the FortiGate, with SNMPv1 and SNMPv2c disabled. SNMPv1 and SNMPv2c transmit data between the SNMP server and SNMP agent in clear text, whereas SNMPv3 adds authentication and privacy (encryption) options that secure protocol operations and are not available in the earlier SNMP versions.",
    "guidance": "Enable the SNMP agent:\nconfig system snmp sysinfo\n    set status enable\nend\n\nDelete any existing SNMPv1/SNMPv2c communities (example shows deleting community index 1, e.g. \"public\"):\nconfig system snmp community\n    show\nend\nconfig system snmp community\n    delete 1\nend\n\nCreate an SNMPv3 user with authentication and privacy enabled:\nconfig system snmp user\n    edit \"snmp_test\"\n        set security-level auth-priv\n        set auth-proto sha256\n        set auth-pwd xxxx\n        set priv-proto aes256\n        set priv_pwd xxxx\n    end\nend\n\nNote/Impact: Some older SNMP servers that only support SNMPv1 or SNMPv2c will not be able to query this firewall once earlier SNMP versions are disabled.",
    "category": "2.3 SNMP",
    "sort_order": 18,
    "is_mandatory": 1,
    "tags": [
      "level:L1",
      "800-53|CM-6",
      "800-53|CM-7",
      "800-53|SC-23",
      "CSCv7|11.5"
    ]
  },
  {
    "control_id": "2.3.2",
    "title": "Allow only trusted hosts in SNMPv3",
    "description": "Ensuring that only certain hosts are able to conduct SNMP GET or receive SNMP Trap. SNMP offers rich information that can be useful for reconnaissance activity. Hence, limiting this information to only relevant devices such as NMS (Network Monitoring System) or other SNMP servers is necessary.",
    "guidance": "CLI Method:\nFGT1 # config system snmp user\nFGT1 (user) # edit \"snmp_test\"\nFGT1 (snmp_test) # unselect notify-hosts 0.0.0.0\nFGT1 (snmp_test) # end\nFGT1 #\n\nGUI Method:\n1. System > SNMP.\n2. On SNMPv3 section, double click on the configured SNMPv3 settings.\n3. Remove 0.0.0.0 from \"Hosts\" option.",
    "category": "2.3 SNMP",
    "sort_order": 19,
    "is_mandatory": 0,
    "tags": [
      "level:L2",
      "800-53|CM-6",
      "800-53|CM-7",
      "800-53|SC-23",
      "CSCv7|11.1",
      "CSCv7|12.2",
      "CIS FortiGate 7.4.x v1.0.1 L2"
    ]
  },
  {
    "control_id": "2.3.3",
    "title": "Disable SNMPv3 Query Per User",
    "description": "SNMP can contain information useful for reconnaissance; SNMP queries allow devices to send requests for information. Disabling queries on SNMPv3 users that do not need to query and only need to receive SNMP traps is necessary to reduce this exposure.",
    "guidance": "CLI Method:\nFGT1 # config system snmp user\nFGT1 (user) # edit snmp_test\nFGT1 (snmp_test) # set queries disable\nFGT1 (snmp_test) # next\nFGT1 (user) # end\n\nGUI Method:\nNavigate to System > SNMP, locate the SNMPv3 user in the SNMPv3 section, select edit, then disable the \"Enabled\" slider under the Queries section.",
    "category": "2.3 SNMP",
    "sort_order": 20,
    "is_mandatory": 0,
    "tags": [
      "level:L2",
      "800-53|CM-7(2)"
    ]
  },
  {
    "control_id": "2.3.4",
    "title": "Enabling SNMP trap for memory usage",
    "description": "Enabling SNMP traps for memory usage monitoring helps detect anomalies and ensure critical security features remain operational. Monitoring memory through SNMP traps prevents performance issues that could create security vulnerabilities on the FortiGate. Memory usage reaching critical status automatically turns FortiGates into conserve mode, which will impact security inspection.",
    "guidance": "Configure two SNMP memory thresholds via CLI:\n\nFGT1 # config system snmp sysinfo\nFGT1 (sysinfo) # show\nconfig system snmp sysinfo\n    set status enable\n    set trap-free-memory-threshold 20\n    set trap-freeable-memory-threshold 50\nend",
    "category": "2.3 SNMP",
    "sort_order": 21,
    "is_mandatory": 1,
    "tags": [
      "level:L1",
      "800-53|AU-2",
      "800-53|AU-7",
      "800-53|AU-12",
      "CSCv7|6.2"
    ]
  },
  {
    "control_id": "2.4.1",
    "title": "Remove default admin user and create one with other name",
    "description": "CIS FortiGate 7.4.x benchmark control 2.4.1 (Remove default admin user and create one with other name). Rationale: it is important to change the password of the default admin account before deploying any new FortiGate, and ideally the account name itself should be changed since default credentials (including Fortinet's) are well documented by vendors and are among the first credentials attackers try. Because the built-in \"admin\" account cannot be renamed while in use, the recommended approach is to create a second administrator account with a different name and then remove the default \"admin\" account entirely.",
    "guidance": "To remediate, create a new local administrator account (e.g., \"mycompanyadmin\") via CLI or GUI, verify it works, then delete the default \"admin\" account.\n\nCLI (VDOM mode enabled):\n```\nconfig global\nconfig system admin\nedit \"mycompanyadmin\"\nset password\nset accprofile \"super_admin\"\nnext\nend\n```\nVerify the new account can log in via a separate CLI/browser session before logging out of the default admin account. Then, using the new admin account's session, delete the default account:\n```\nconfig global\nconfig system admin\ndelete \"admin\"\nend\n```\n\nGUI:\nNavigate to Global (if VDOM enabled) > System > Administrators. Create the new admin account, verify login capability in a separate browser session, then remove/delete the default \"admin\" account from the System > Administrators menu.",
    "category": "2.4 Administrative Access",
    "sort_order": 22,
    "is_mandatory": 1,
    "tags": [
      "level:L1",
      "800-53|IA-5",
      "CSCv7|4.2"
    ]
  },
  {
    "control_id": "2.4.2",
    "title": "Ensure all the login accounts having specific trusted hosts enabled",
    "description": "Configure an administrative account to be accessible only to someone who is using a trusted host. You can set a specific IP address for the trusted host or use a subnet. Access to a firewall to perform administrative tasks should only come from specific network segments reserved for administrators only. This additional layer of security ensures that no one from anywhere else on the network is able to log in, even with correct credentials.",
    "guidance": "To remove a trusted host item from the list in CLI:\n\nFG1 # config system admin\nFG1 (admin) # edit \"test_admin\"\nFG1 (test_admin) # unset trusthost1\nFG1 (test_admin) # end\nFG1 #\n\nTo add a trusted host into the list in CLI:\n\nFG1 # config system admin\nFG1 (admin) # edit \"test_admin\"\nFG1 (test_admin) # set trusthost6 1.1.1.1 255.255.255.255\nFG1 (test_admin) # end\nFG1 #",
    "category": "2.4 Administrative Access",
    "sort_order": 23,
    "is_mandatory": 1,
    "tags": [
      "level:L1",
      "800-53|AC-6(2)",
      "800-53|AC-6(5)",
      "800-53|AC-17(3)",
      "800-53|SI-7",
      "CSCv7|4.6",
      "CSCv7|11.6",
      "CSCv7|11.7"
    ]
  },
  {
    "control_id": "2.4.3",
    "title": "Ensure admin accounts with different privileges have their correct profiles assigned",
    "description": "Rationale: \"Verify that users with access to the Fortinet should only have the minimum privileges required for that particular user. In some organizations, it is necessary to create different levels of administrative accounts.\" The benchmark example notes that, e.g., tier 1 support technicians should have more restricted access than tier 3 support personnel. Nessus does not perform an automated check for this item (\"Nessus has not performed this check. Please review the benchmark to ensure target compliance.\") — it is a manual/audit-only control.",
    "guidance": "Create a custom admin profile with only the required permissions, then assign it to the account, via CLI:\n\nFGT1 # config system accprofile\nFGT1 (accprofile) # edit \"tier_1\"\nFGT1 (tier_1) # set fwgrp custom\nFGT1 (tier_1) # config fwgrp-permission\nFGT1 (fwgrp-permission) # set address read-write\nFGT1 (fwgrp-permission) # end\nFGT1 (tier_1) # end\nFGT1 #\n\nFGT1 # config system admin\nFGT1 (admin) # edit \"support1\"\nFGT1 (support1) # set accprofile \"tier_1\"\nFGT1 (support1) # end\nFGT1 #\n\nVia GUI: System > Admin Profiles, select the profile and click Edit; under Firewall, click Custom and select Read/Write for Address (repeat for other needed permission groups). Then go to System > Administrators, select the account, click Edit, and assign the desired profile under Administrator Profile.",
    "category": "2.4 Administrative Access",
    "sort_order": 24,
    "is_mandatory": 1,
    "tags": [
      "level:L1",
      "800-53|AC-6(2)",
      "800-53|AC-6(5)",
      "CSCv7|4.3"
    ]
  },
  {
    "control_id": "2.4.4",
    "title": "Ensure Admin idle timeout time is configured",
    "description": "Rationale: The idle timeout period is the amount of time an administrator stays logged into the FortiGate GUI without any activity. Best practice requires setting this timeout to mitigate the risk of unauthorized access via an unattended, still-logged-in admin session. CIS recommends that administrator sessions automatically time out after a period of inactivity, with a maximum recommended time of 15 minutes or less.",
    "guidance": "GUI Method:\n1. Login to FortiGate with Super Admin privileges\n2. Go to 'System' > 'Settings'\n3. In the 'Administration Settings' section, set the 'Idle timeout' value to five minutes by typing 5\n4. Click Apply\n\nCLI Method:\nconfig system global\nset admintimeout 5\nend\n\nImpact: This prevents unauthorized access to the FortiGate if the management PC is left unattended.",
    "category": "2.4 Administrative Access",
    "sort_order": 25,
    "is_mandatory": 1,
    "tags": [
      "level:L1",
      "800-53|AC-6(2)",
      "800-53|AC-6(5)",
      "CSCv7|4.3"
    ]
  },
  {
    "control_id": "2.4.5",
    "title": "Ensure only encrypted access channels are enabled",
    "description": "Allow only HTTPS access to the GUI and SSH access to the CLI (2.4.5 Ensure only encrypted access channels are enabled, CIS FortiGate 7.4.x v1.0.1 L1). Restricting administrative access to encrypted channels only prevents attackers from using man-in-the-middle techniques to sniff login credentials transmitted over unencrypted protocols such as HTTP or Telnet.",
    "guidance": "If HTTP or Telnet is in the allowaccess list, reset the list with the same elements minus http/telnet.\n\nCLI:\n```\nFG1 # config system interface\nFG1 (interface) # edit port1\nFG1 (port1) # set allowaccess ssh https ping snmp\nFG1 (port1) # end\nFG1 #\n```\n\nWeb GUI:\n1. Network > Interfaces, select the interface and click \"Edit\".\n2. In the interface setting page, uncheck HTTP and Telnet in the \"Administrative Access\" section.",
    "category": "2.4 Administrative Access",
    "sort_order": 26,
    "is_mandatory": 1,
    "tags": [
      "level:L1",
      "800-53|AC-17(2)",
      "800-53|IA-5",
      "800-53|IA-5(1)",
      "800-53|SC-8",
      "800-53|SC-8(1)",
      "CSCv7|4.5",
      "CIS FortiGate 7.4.x v1.0.1 L1 benchmark"
    ]
  },
  {
    "control_id": "2.4.6",
    "title": "Apply Local-in Policies",
    "description": "Rationale: Configure Local-in Policies to control inbound traffic that is destined to a FortiGate interface. Local-in Policies allow for more granular and specific control of all types of traffic that are destined for a FortiGate interface. They are not limited to management-only protocols, therefore they can extend past \"trusted host\" configurations and be configured with source and destination addresses as well as specific services. NOTE: Nessus has provided the target output to assist in reviewing the benchmark to ensure target compliance.",
    "guidance": "Local-in Policies can only be configured through the CLI:\n\nconfig firewall {local-in-policy | local-in-policy6}\n    edit <policy_number>\n        set intf <interface>\n        set srcaddr <source_address> [source_address] ...\n        set dstaddr <destination_address> [destination_address] ...\n        set action {accept | deny}\n        set service <service_name> [service_name] ...\n        set schedule <schedule_name>\n        set comments <string>\n    next\nend\n\nFor example, to prevent the source subnet 10.10.10.0/24 from pinging port1, but allow administrative access for PING on port1:\n\nconfig firewall address\n    edit \"10.10.10.0\"\n        set subnet 10.10.10.0 255.255.255.0\n    next\nend\nconfig firewall local-in-policy\n    edit 1\n        set intf \"port1\"\n        set srcaddr \"10.10.10.0\"\n        set dstaddr \"all\"\n        set service \"PING\"\n        set schedule \"always\"\n    next\nend\n\nImpact:\n\nLocal-in Policies are processed before \"trusted host\" configurations, so it is important to validate that management access will be maintained once the Local-in policies are put in place.",
    "category": "2.4 Administrative Access",
    "sort_order": 27,
    "is_mandatory": 1,
    "tags": [
      "level:L1",
      "800-53|AC-3",
      "800-53|AC-5",
      "800-53|AC-6",
      "800-53|CM-7",
      "800-53|CP-6",
      "800-53|CP-7",
      "800-53|MP-2",
      "800-53|PL-8",
      "800-53|PM-7",
      "800-53|SA-8",
      "800-53|SC-7",
      "CSCv7|14.6"
    ]
  },
  {
    "control_id": "2.4.7",
    "title": "Ensure default Admin ports are changed",
    "description": "FortiGate admin ports default to the common values of 80 (HTTP) and 443 (HTTPS); the appliance keeps listening on whatever admin ports are configured even when interface access is otherwise restricted, which can create conflicts if ports 80 or 443 are later needed for other purposes. Changing the default admin ports to uncommon values reduces the attack surface exposed to anyone targeting FortiGate admin access and avoids that port conflict. This is one hardening step among many, but an important one, since unauthorized administrative access to a FortiGate (or any firewall) could be very costly.",
    "guidance": "CLI:\nconfig system global\n    set admin-https-redirect disable\n    set admin-port 8082 (or any other uncommon port)\n    set admin-server-cert \"self-sign\"\n    set admin-sport 4343 (or any other uncommon port)\nend\n\nOR\n\nWeb GUI:\n1. System > Settings\n2. Change the ports/settings under the 'Administration Settings' section.\n\nNOTE: HTTPS redirection must be turned off as well as changing port 80. This is due to the nature of how browser port redirection works — the browser will be redirected from port 80 to port 443 (or whichever 'admin-sport' is configured), meaning it will still listen on port 80 even after the port has been reconfigured.",
    "category": "2.4 Administrative Access",
    "sort_order": 28,
    "is_mandatory": 1,
    "tags": [
      "level:L1",
      "800-53|AC-3",
      "800-53|AC-5",
      "800-53|AC-6",
      "800-53|CM-7",
      "800-53|CP-6",
      "800-53|CP-7",
      "800-53|MP-2",
      "800-53|PL-8",
      "800-53|PM-7",
      "800-53|SA-8",
      "800-53|SC-7",
      "CSCv7|9.2",
      "CSCv7|9.4"
    ]
  },
  {
    "control_id": "2.4.8",
    "title": "Virtual patching on the local-in management interface",
    "description": "Enabling virtual patching on the local-in management interface applies IPS signatures to traffic destined for the FortiGate itself, mitigating attacks against GUI and SSH management access by virtually patching known vulnerabilities. This requires a valid FortiGuard FMWR license to install the FMWP database. Since actual patch deployment requires scheduled downtime, virtual patching reduces risk exposure during the window between a vulnerability announcement and the applied patch.",
    "guidance": "CLI configuration:\nconfig firewall local-in-policy\nedit <id>\nset virtual-patch enable\nnext\nend",
    "category": "2.4 Administrative Access",
    "sort_order": 29,
    "is_mandatory": 1,
    "tags": [
      "level:L1",
      "800-53|RA-5",
      "800-53|SI-2",
      "800-53|SI-2(2)",
      "CSCv7|3.5"
    ]
  },
  {
    "control_id": "2.5.1",
    "title": "Ensure High Availability configuration is enabled",
    "description": "Ensure FortiGate devices are configured for High Availability (HA). Configuring HA increases system availability and decreases the impact of routine maintenance (firmware updates, cable moves, etc.) as well as the impact of device failure. Not having HA configured correctly and synced properly impacts the availability of the FortiGate devices and any systems that must traverse them; with HA properly configured, outages can be minimized during firmware updates, power outages, or device failures.",
    "guidance": "GUI: Navigate to System > HA. Set \"Mode\" to the proper setting, \"Active-Active\" or \"Active-Passive\". Review configuration settings: \"Cluster Name\" must match on devices, \"Password\" must match on devices, \"Heartbeat Interfaces\" need to be defined on devices. Click \"OK\" to save changes and exit.\n\nCLI:\n```\nFGT1 # config system ha\nFGT1 (ha) # set mode a-p ###(Active-Passive)\nFGT1 (ha) # set group-name \"FGT-HA\" ###(Set cluster name)\nFGT1 (ha) # set password ####### ###(Set password)\nFGT1 (ha) # set hbdev port10 50 ###(Set Heartbeat Interface and priority)\nFGT1 (ha) # end\n```",
    "category": "2.5 High Availability",
    "sort_order": 30,
    "is_mandatory": 0,
    "tags": [
      "level:L2",
      "800-53|SI-13(5)"
    ]
  },
  {
    "control_id": "2.5.2",
    "title": "Ensure \"Monitor Interfaces\" for High Availability devices is enabled",
    "description": "Configure Interface Monitoring within High Availability settings; Interface Monitoring should be enabled on all critical interfaces. With Interface Monitoring enabled, failover can occur if there are physical media issues or issues with the specific port to which the FortiGate is connected. Not configuring Interface Monitoring can directly impact services due to a failure to trigger an HA failover if an interface issue affects only the primary device and is not being monitored — without it, failover capability is limited to hardware, system, or power faults only.",
    "guidance": "GUI:\n1. Navigate to System > HA\n2. Under \"Monitor Interfaces\" select applicable interfaces\n3. Select OK\n\nCLI (validation/example):\nFGT1 # config system ha\nFGT1 (ha) # set monitor \"port6\" \"port7\"\nFGT1 (ha) # show\nconfig system ha\n    set group-name \"FGT-HA\"\n    set mode a-p\n    set monitor \"port6\" \"port7\"\nend",
    "category": "2.5 High Availability",
    "sort_order": 31,
    "is_mandatory": 1,
    "tags": [
      "level:L1",
      "800-53|SI-13(5)"
    ]
  },
  {
    "control_id": "2.5.3",
    "title": "Ensure HA Reserved Management Interface is configured",
    "description": "Ensures Reserved Management Interfaces are configured on FortiGate devices in an HA cluster, so both the primary and secondary firewalls remain individually reachable for administration. Without this, management interfaces sync with HA and share a virtualized MAC address between the two units. As a result, not configuring reserved management interfaces impacts the ability to access the secondary device directly, since the primary and secondary sync configuration exactly and float the MAC address between them for failover.",
    "guidance": "GUI: Go to System > HA and edit the \"Master\" device. Enable \"Management Interface Reservation,\" then select an interface and configure the appropriate gateway.\n\nCLI:\n```\nFGT1 #config system ha\nFGT1 (ha) # set ha-mgmt-status enable\nFGT1 (ha) # config ha-mgmt-interfaces\nFGT1 (ha-mgmt-interfaces) # edit 1\nnew entry '1' added\nFGT1 (1) # set interface port6\nFGT1 (1) # set gateway 10.10.10.1\nFGT1 (1) # end\nFGT1 (ha) # show\nconfig system ha\n    set group-name \"FGT-HA\"\n    set mode a-p\n    set password ENC enrwD467hJmO6j6YW/l6FEOa1YNVYdo8Z5mCcTDEKUFpOVXcNYnPBmQDGX//ViXk6TkwNH0il5aJr/fZY25lq+husndQHZVWp2LIlXmCv/n81U43nkZUWaIKvqkellGFbhv0/IHoOLzQPCsVcBbyrsgoprYMvh6w7F06+nRriBtMNQxpiTE+12xAHz7lA3EoYZzf8A==\n    set ha-mgmt-status enable\n    config ha-mgmt-interfaces\n        edit 1\n            set interface \"port6\"\n            set gateway 10.10.10.1\n        next\n    end\n    set override disable\nend\nFGT1 (ha) # end\n```",
    "category": "2.5 High Availability",
    "sort_order": 32,
    "is_mandatory": 1,
    "tags": [
      "level:L1",
      "CIS FortiGate 7.4.x v1.0.1 L1 | 2.5.3",
      "800-53|SI-13(5)"
    ]
  },
  {
    "control_id": "2.5.4",
    "title": "Ensure High Availability Group-ID is configured",
    "description": "High Availability (HA) lets a FortiGate cluster float a virtual MAC address between devices to minimize downtime on failover. This virtual MAC is generated from the HA Group-ID, so leaving it at the default value risks duplicate MAC addresses at Layer 2 if multiple default FortiGate HA clusters exist on the same network segment. Configuring a unique, non-default Group-ID prevents this MAC address collision and the resulting network problems.",
    "guidance": "CLI method:\n```\nFGT1 # config system ha\nFGT1 (ha) # set group-id 10\nFGT1 (ha) # end\nFGT1 #\n```\nThe Group ID accepts integer values from 0-1023; set it to a unique, non-default value for each HA cluster on the network.\n\nGUI method: Navigate to System > HA, select the Primary device, click Edit, enter a value in the Group ID field under Cluster Settings, and click OK.\n\nImpact if not remediated: failure to modify the Group-ID could result in duplicate MAC addresses versus other default FortiGate HA configurations, causing network problems if deployed in the same environment.",
    "category": "2.5 High Availability",
    "sort_order": 33,
    "is_mandatory": 0,
    "tags": [
      "level:L2",
      "800-53|SI-13(5)",
      "CIS FortiGate 7.4.x Benchmark v1.0.1 (L2) - 2.5.4 Ensure High Availability Group-ID is configured"
    ]
  },
  {
    "control_id": "3.1",
    "title": "Ensure that unused policies are reviewed regularly",
    "description": "CIS FortiGate 7.4.x Benchmark control 3.1 requires that all firewall policies be reviewed regularly to confirm they still serve a valid business purpose; the guidance recommends a review cadence of at least twice yearly, or per the organization's Business Continuity Plan, since some policies may only be intended to activate during contingency/DR scenarios. Unused or unjustified policies should be disabled and logged rather than left active, since stale allow rules expand the attack surface and violate least-privilege/least-functionality principles.",
    "guidance": "Review all configured firewall policies and determine whether each one is still required for a legitimate business purpose. For any policy that is no longer needed, delete it (or disable and log it if it is retained only for contingency/BCP purposes) rather than leaving it active indefinitely.",
    "category": "3 Firewall Policy",
    "sort_order": 34,
    "is_mandatory": 0,
    "tags": [
      "level:L2",
      "800-53|CM-6, CM-7",
      "CSCv7|9.2, 11.2"
    ]
  },
  {
    "control_id": "3.2",
    "title": "Ensure that policies do not use \"ALL\" as Service",
    "description": "CIS FortiGate 7.4.x v1.0.1 (L1) benchmark control 3.2 \"Ensure that policies do not use \\\"ALL\\\" as Service.\" Rationale: ensure that all security policies in effect clearly state which protocols/services they are allowing, so the firewall does not allow traffic with unauthorized protocols/services by mistake.",
    "guidance": "This is an example showing how to modify policy with ID of 2 to change the service from \"ALL\" to FTP and SNMP.\n\nIn CLI:\n\nFGT1 # config firewall policy\nFGT1 (policy) # edit 2\nFGT1 (2) # set service \"FTP\" \"SNMP\"\nFGT1 (2) # end\nFGT1 #\n\nIn the GUI,\n1. Go to Policy & Objects.\n2. Click on Firewall Policy.\n3. Select the policy, click \"Edit\".\n4. In the Service section, click on it and select FTP and SNMP. Click OK.",
    "category": "3 Firewall Policy",
    "sort_order": 35,
    "is_mandatory": 1,
    "tags": [
      "level:L1",
      "800-53|AC-3",
      "800-53|AC-5",
      "800-53|AC-6",
      "800-53|MP-2",
      "CSCv7|9.2"
    ]
  },
  {
    "control_id": "3.3",
    "title": "Ensure firewall policy denying all traffic to/from Tor, malicious server, or scanner IP addresses using ISDB",
    "description": "Firewall policies should include a deny rule for traffic going to/from Tor, malicious server, or scanner IP addresses using ISDB (Internet Service Database). FortiGate includes Tor or malicious server related IP address using ISDB. The idea is to filter out malicious traffic using firewall policies as first level filtering. This is done without involving more resource intensive processes such as IPS inspection, hence optimizing FortiGate's performance.",
    "guidance": "Review firewall policies and ensure there are:\n\n- A firewall policy created to block inbound connections with these settings:\n\nFrom: Any\nTo: Any\nSource: \"Tor-Exit.Node\", \"Tor-Relay.Node\", \"Censys-Scanner\", \"Shodan-Scanner\", \"Botnet-C&C.Server\", \"Phishing-Phishing.Server\", \"Proxy-Proxy.Server\", \"Spam-Spamming.Server\", \"VPN-Anonymous.VPN\", and \"Malicious-Malicious.Server\"\nDestination: all\nSchedule: Always\nServices: All\nAction: Deny\nLog Violation Traffic: Enabled\nEnable this policy: Enabled\n\n- A firewall policy created to block outbound connections with these settings:\n\nFrom: Any\nTo: Any\nSource: All\nDestination: \"Tor-Relay.Node\", \"Botnet-C&C.Server\", \"Phishing-Phishing.Server\", \"Proxy-Proxy.Server\", \"Spam-Spamming.Server\", \"VPN-Anonymous.VPN\", and \"Malicious-Malicious.Server\"\nSchedule: Always\nAction: Deny\nLog Violation Traffic: Enabled\nEnable this policy: Enabled\n\nNote: this control's remediation is defined entirely as GUI firewall-policy field settings in Tenable's audit content — there is no FortiOS CLI (`config firewall policy ...`) block on this page to preserve verbatim.",
    "category": "3 Firewall Policy",
    "sort_order": 36,
    "is_mandatory": 1,
    "tags": [
      "level:L1",
      "800-53|CM-7",
      "800-53|CP-6",
      "800-53|CP-7",
      "800-53|PL-8",
      "800-53|PM-7",
      "800-53|SA-8",
      "800-53|SC-7",
      "CSCv7|12.2",
      "CSCv7|12.3",
      "CSCv7|13.3"
    ]
  },
  {
    "control_id": "3.4",
    "title": "Ensure logging is enabled on all firewall policies",
    "description": "Firewall policies must have logging enabled, including the default implicit deny policy, so both allowed and denied traffic is recorded. This log data lets SOC/security analysts perform threat hunting and incident response investigations. By default, FortiGate does not enable a logging option when a policy is created, and the default implicit deny policy is not logged, leaving a data gap unless explicitly configured.",
    "guidance": "Review firewall policies and ensure that:\n- For allowed policies, \"Log Allowed Traffic\" is set to the \"All Sessions\" option.\n- For denied policies, \"Log Violation Traffic\" is enabled.\n\nImpact: By default, when creating firewall policies, a logging option is not enabled. Also, the default implicit deny policy is not logged. This creates a data gap in threat hunting or incident response activities.\n\nNote: This control's remediation is GUI-based (FortiGate policy logging settings) — no CLI/CLI-console commands are provided by Tenable for this item.",
    "category": "3 Firewall Policy",
    "sort_order": 37,
    "is_mandatory": 1,
    "tags": [
      "level:L1",
      "800-53|AU-1, AU-2, SI-4, SI-4(4)",
      "CSCv7|12.5, 12.8",
      "Categories: AUDIT AND ACCOUNTABILITY, SYSTEM AND INFORMATION INTEGRITY"
    ]
  },
  {
    "control_id": "4.1.1",
    "title": "Detect Botnet connections",
    "description": "Interfaces which are classified as \"WAN\" and are used by a policy should use an IPS sensor which blocks or monitors outgoing connections to botnet sites. Blocking outgoing connections to known Botnets should be utilized in a Defense In Depth network design.",
    "guidance": "Configure relevant IPS profiles with 'Scan Outgoing Connections to Botnet Sites' set to 'Block'. Apply relevant IPS profile on all firewall policies with traffic exiting the network to a 'WAN' interface. (No CLI commands are listed for this control on the page.)",
    "category": "4.1 Intrusion Prevention & Botnet Detection",
    "sort_order": 38,
    "is_mandatory": 0,
    "tags": [
      "level:L2",
      "800-53|SI-4",
      "800-53|SI-4(4)",
      "CSCv7|12.7",
      "CSCv7|15.3",
      "CIS FortiGate 7.4.x v1.0.1 L2 Benchmark"
    ]
  },
  {
    "control_id": "4.1.2",
    "title": "Apply IPS Security Profile to Policies",
    "description": "Ensuring that traffic traversing between networks on the FortiGate have an IPS security profile inspecting it. Traffic moving between \"interfaces\" on the FortiGate should have firewall policies applied with an IPS security profile applied.",
    "guidance": "Configure on all \"Allowed\" firewall policies to have an appropriate IPS security profile applied to policies. (No CLI commands are given for this control in the source — it is a GUI/policy-configuration step, not a CLI-based remediation.)",
    "category": "4.1 Intrusion Prevention & Botnet Detection",
    "sort_order": 39,
    "is_mandatory": 1,
    "tags": [
      "level:L1",
      "800-53|RA-5",
      "CSCv7|12.7"
    ]
  },
  {
    "control_id": "4.2.1",
    "title": "Ensure Antivirus Definition Push Updates are Configured",
    "description": "CIS FortiGate 7.4.x v1.0.1 L2 benchmark control 4.2.1 \"Ensure Antivirus Definition Push Updates are Configured.\" Rationale: Ensure FortiGate is configured to accept antivirus definition push updates. Ensure that the FortiGate will accept push updates from FortiGuard to ensure the most up to date signature databases are present on the device.",
    "guidance": "On GUI:\n1. Access the FortiGate administrative web access page and go to System > FortiGuard.\n2. Under \"FortiGuard Updates\" ensure that the \"Scheduled updates\" is set to \"Automatic\".\n\nOn CLI:\nconfig system autoupdate schedule\nset status enable\nset frequency automatic\nend",
    "category": "4.2 Antivirus",
    "sort_order": 40,
    "is_mandatory": 0,
    "tags": [
      "level:L2",
      "800-53|SI-3",
      "CSCv7|8.2"
    ]
  },
  {
    "control_id": "4.2.2",
    "title": "Apply Antivirus Security Profile to Policies",
    "description": "Ensures traffic traversing between network interfaces on the FortiGate is inspected by an Antivirus Security profile. Firewall policies governing inter-interface traffic should have an antivirus security profile applied to them so that traffic is scanned for malware. Note from the benchmark: Nessus provides the target output to assist in reviewing the benchmark to ensure target compliance.",
    "guidance": "Review firewall policies and apply an appropriate antivirus security profile to policies. (No CLI command syntax is provided for this specific item — the CIS benchmark leaves the exact GUI/CLI steps to policy-specific configuration, unlike sibling items such as 4.2.1 which do include `config`/`set`/`end` CLI blocks.)",
    "category": "4.2 Antivirus",
    "sort_order": 41,
    "is_mandatory": 0,
    "tags": [
      "level:L2",
      "800-53|SI-3",
      "CSCv7|8.2"
    ]
  },
  {
    "control_id": "4.2.3",
    "title": "Enable Outbreak Prevention Database",
    "description": "CIS FortiGate 7.4.x v1.0.1 L2 control 4.2.3 \"Enable Outbreak Prevention Database\": ensures FortiGate antivirus inspection uses the FortiGuard outbreak prevention database as an added layer on top of signature-based detection. This leverages third-party malware hash signatures curated by FortiGuard's Global Threat Intelligence database — the antivirus engine queries FortiGuard with a scanned file's hash, and a match is treated as malicious, giving protection beyond traditional signature matching alone.",
    "guidance": "Review Antivirus Security Profiles and validate that \"Use FortiGuard outbreak prevention database\" is enabled. (No CLI command is provided for this item — it is a GUI-review-only check per the Tenable audit source.)",
    "category": "4.2 Antivirus",
    "sort_order": 42,
    "is_mandatory": 0,
    "tags": [
      "level:L2",
      "800-53|SI-3",
      "CSCv7|8.1",
      "CSCv7|8.2",
      "CSCv7|8.3",
      "CSCv7|8.6"
    ]
  },
  {
    "control_id": "4.2.4",
    "title": "Enable AI /heuristic based malware detection",
    "description": "AI/heuristic based detection should be enabled. The AV Engine AI malware detection model integrates into regular AV scanning to help detect potentially malicious Windows Portable Executables (PEs) in order to mitigate zero-day attacks. This represents an additional security layer beyond traditional antivirus protection; the capability was called \"Heuristic detection\" in FortiOS 6.x and was renamed to \"AI based detection\" in version 7.x by Fortinet.",
    "guidance": "Command sequence for FortiGate CLI:\n\nFGT1 # config antivirus settings\nFGT1 (settings) # set machine-learning-detection enable",
    "category": "4.2 Antivirus",
    "sort_order": 43,
    "is_mandatory": 0,
    "tags": [
      "level:L2",
      "800-53|SI-4",
      "CSCv7|8.1",
      "CSCv7|8.2",
      "CSCv7|8.3"
    ]
  },
  {
    "control_id": "4.2.5",
    "title": "Enable grayware detection on antivirus",
    "description": "Grayware detection should be enabled. Usage of grayware is generally not allowed in strict company policies and some graywares can be used for malicious intent. If the file passes the virus scan, it can be checked for grayware. Grayware signatures are kept up to date in the same manner as the antivirus definitions.",
    "guidance": "On CLI:\n\nFGT1 # config antivirus settings\nFGT1 (settings) # set grayware enable",
    "category": "4.2 Antivirus",
    "sort_order": 44,
    "is_mandatory": 0,
    "tags": [
      "level:L2",
      "800-53|SI-3",
      "CSCv7|8.1",
      "CSCv7|8.2"
    ]
  },
  {
    "control_id": "4.2.6",
    "title": "Ensure inline scanning with FortiGuard AI-Based Sandbox Service is enabled",
    "description": "CIS FortiGate 7.4.x v1.0.1 (L1) Benchmark, control 4.2.6 \"Ensure inline scanning with FortiGuard AI-Based Sandbox Service is enabled.\" Rationale: Inline scanning is supported when the FortiGate is licensed with the FortiGuard AI-Based Sandbox Service (FAIS). It works similar to inline scanning for the FortiSandbox appliance, by holding a file up to 50 seconds for the verdict to be returned. Timed out scans can either be set to block, log, or ignore. Inline scanning can be enabled from the GUI on the Cloud Sandbox configuration page. With FAIS, unknown malware can be detected and blocked using cloud sandboxing technology. Using inline scanning with FAIS, patient zero can also be prevented. This complements the existing antivirus signature-based detection and also acts as an additional layer of defense on top of FortiGate's AV heuristics feature.",
    "guidance": "On GUI:\n\nEnable the FortiGate Cloud feature visibility:\n1. Go to System > Feature Visibility.\n2. In the Additional Features section, enable FortiGate Cloud Sandbox.\n3. Click Apply.\n\nConfigure the Cloud Sandbox Fabric connector:\n1. Go to Security Fabric > Fabric Connectors and double-click the Cloud Sandbox card.\n2. Set the Type to FortiGate Cloud.\n3. Select a Region.\n4. Enable Inline scan.\n5. Click OK.\n\nConfigure the antivirus profile:\n1. Go to Security Profiles > AntiVirus and click Create New.\n2. Set the Feature set to Proxy-based.\n3. Enable the protocols to inspect.\n4. Enable Send files to FortiSandbox for inspection.\n5. Set the Scan strategy to Inline, and set the Action to Block.\n6. Click OK.\n\nOn CLI:\n\nDisable FortiSandbox appliance and FortiSandbox Cloud:\n```\nconfig system fortisandbox\nset status disable\nend\n```\n\nConfigure FortiGate Cloud Sandbox (example given is setting it as \"Global\" region):\n```\n# execute forticloud-sandbox region\n0 Global\n1 Europe\n2 Japan\n3 US\nPlease select cloud sandbox region[0-3]:0\nCloud sandbox region is selected: Global\n```\n\nEnable inline scanning for FortiGate Cloud:\n```\nconfig system fortiguard\nset sandbox-region \"Global\"\nset sandbox-inline-scan enable\nend\n```\n\nEnforced on AV security profile:\n```\nconfig antivirus profile\nedit <profile name>\nset feature-set proxy\nset fortisandbox-mode inline\nconfig http\nset fortisandbox block\nend\nconfig ftp\nset fortisandbox block\nend\nconfig imap\nset fortisandbox block\nend\nconfig pop3\nset fortisandbox block\nend\nconfig mapi\nset fortisandbox block\nend\nconfig nntp\nset fortisandbox block\nend\nconfig cifs\nset fortisandbox block\nend\nconfig ssh\nset fortisandbox block\nend\nnext\nend\n```",
    "category": "4.2 Antivirus",
    "sort_order": 45,
    "is_mandatory": 1,
    "tags": [
      "level:L1",
      "800-53|SI-3"
    ]
  },
  {
    "control_id": "4.2.7",
    "title": "Enable CDR for proxy mode on XLSB, OpenOffice, and RTF files",
    "description": "Enabling Content Disarm & Reconstruction (CDR) for proxy mode on XLSB, OpenOffice, and RTF files sanitizes potentially malicious content embedded in these document formats before it reaches the user. This applies only to AV profiles and firewall policies operating in Proxy mode. Without CDR enabled, malicious payloads hidden in these document formats could bypass traditional security measures, leading to data breaches or system compromise. This proactive approach reduces the attack surface while maintaining business continuity and usability.",
    "guidance": "To configure antivirus CDR in the GUI:\n1. Go to Security Profiles > AntiVirus and click Create New.\n2. Enable AntiVirus scan, and select Block.\n3. Set Feature set to Proxy-based.\n4. Under Inspected Protocols, enable one or more protocols that support proxy-based antivirus scanning.\n5. Under APT Protection Options, enable Content Disarm and Reconstruction, and select Apply CDR to office files to disarm Microsoft Office and OpenOffice files, including RTF (Rich Text Format) and XLSB (Excel Binary Workbook) files.\n\nImpact: Without CDR, malicious payloads hidden in these document formats could bypass traditional security measures, leading to data breaches or system compromise.\n\n(No CLI commands are given for this control on the Tenable page — remediation is GUI-only.)",
    "category": "4.2 Antivirus",
    "sort_order": 46,
    "is_mandatory": 0,
    "tags": [
      "level:L2",
      "800-53|SI-3",
      "CSCv7|8.1",
      "CIS FortiGate 7.4.x v1.0.1 L2, control 4.2.7"
    ]
  },
  {
    "control_id": "4.3.1",
    "title": "Enable Botnet C&C Domain Blocking DNS Filter",
    "description": "Enable Botnet C&C domain blocking to block botnet access at the DNS name-resolution stage. Blocking botnet website access at the DNS resolution stage provides an additional layer of defense against command-and-control communication reaching compromised hosts.",
    "guidance": "Go to Security Profiles > DNS Filter. On the relevant security profile, double click to open it. Enable \"Redirect botnet C&C requests to Block Portal\". Ensure that firewall policies that carry DNS traffic have a DNS Filter security profile applied with that option enabled. (No CLI/console commands are listed for this control — remediation is GUI-only.)",
    "category": "4.3 DNS Filter",
    "sort_order": 47,
    "is_mandatory": 0,
    "tags": [
      "level:L2",
      "800-53|SI-8",
      "CSCv7|8.6",
      "CSCv7|8.7"
    ]
  },
  {
    "control_id": "4.3.2",
    "title": "Ensure DNS Filter logs all DNS queries and responses",
    "description": "DNS Filter should log all DNS queries and responses regardless of whether the DNS category is blocked, monitored, or allowed. By default, FortiGate does not log allowed DNS traffic, which creates a data gap for security investigations and threat hunting/incident response activities.",
    "guidance": "Review DNS Filter Security Profiles and validate that 'Log all DNS queries and responses' is enabled.",
    "category": "4.3 DNS Filter",
    "sort_order": 48,
    "is_mandatory": 1,
    "tags": [
      "level:L1",
      "800-53|AU-2",
      "CSCv7|8.7"
    ]
  },
  {
    "control_id": "4.3.3",
    "title": "Apply DNS Filter Security Profile to Policies",
    "description": "4.3.3 Apply DNS Filter Security Profile to Policies (CIS FortiGate 7.4.x v1.0.1 L1). Rationale/Description: \"Ensuring that traffic traversing to the Internet on the FortiGate has a DNS Filter security profile inspecting it. Traffic outbound to the Internet on the FortiGate should have firewall policies applied with an DNS Filter security profile applied. NOTE: Nessus has provided the target output to assist in reviewing the benchmark to ensure target compliance.\" This is a policy-configuration check (audit category: System and Information Integrity) verified via Nessus target output rather than a direct CLI query — no CLI commands are provided for this item on the source page.",
    "guidance": "Solution: \"Configure on \\\"Allowed\\\" firewall policies that handle traffic outbound to Internet to have an appropriate DNS Filter security profile applied to policies.\" No CLI/command-line remediation steps are given in the source content for this item — the fix is applied via FortiGate policy configuration (attaching a DNS Filter security profile to the relevant firewall policy), not a documented CLI command sequence.",
    "category": "4.3 DNS Filter",
    "sort_order": 49,
    "is_mandatory": 1,
    "tags": [
      "level:L1",
      "800-53|SI-8",
      "CSCv7|7.7",
      "Category: SYSTEM AND INFORMATION INTEGRITY"
    ]
  },
  {
    "control_id": "4.4.1",
    "title": "Create a Web Filtering Profile",
    "description": "Websites categorized under \"Security Risk\" pose significant threats to an organization's network and users. Categories such as Dynamic DNS, Malicious Websites, Phishing, and Spam URLs are often associated with cyber threats and serve as initial access vectors for attacks such as malware distribution, phishing schemes, command-and-control activities, and data theft. Note: if organizational policy requires allowing certain FortiGuard URL Database Categories such as \"Dynamic DNS,\" \"Newly Observed Domains,\" or \"Newly Registered Domains,\" these should be configured under the \"Monitor\" action rather than blocked.",
    "guidance": "Apply a Web Filter profile to the firewall policy or SD-WAN and ensure that the Security Risk categories — including Malicious Websites, Phishing, and Spam URLs — are configured to Block. Caveat noted on the page: setting \"Newly Observed Domains\" or \"Newly Registered Domains\" to Block may significantly restrict user access to newly created or uncategorized websites, so those should be set to Monitor if such access is required by policy. (This item's Solution text is high-level GUI/policy guidance only — the page does not include a verbatim FortiGate CLI command block for this control.)",
    "category": "4.4 Web Filter",
    "sort_order": 50,
    "is_mandatory": 1,
    "tags": [
      "level:L1",
      "800-53|AC-4(11)",
      "CIS FortiGate 7.4.x v1.0.1 L1 Benchmark"
    ]
  },
  {
    "control_id": "4.5.1",
    "title": "Block high risk categories on Application Control",
    "description": "Rationale (CIS FortiGate 7.4.x v1.0.1 L1, control 4.5.1 \"Block high risk categories on Application Control\"): Ensure FortiGate Application Control blocks high risk applications to reduce attack surface. High risk applications such as those in \"P2P\" and \"Proxy\" are known for spreading malware. Some of this traffic is encrypted and therefore is able to bypass network security inspection (for those without decryption implemented). Blocking these applications from running eliminates this risk. If any application that falls under \"P2P\" and \"Proxy\" is required to be allowed based on an organization's policy, that specific application needs to be under \"Monitor\" mode in the \"Application and Filter Override\" configuration. NOTE: Nessus has provided the target output to assist in reviewing the benchmark to ensure target compliance.",
    "guidance": "Review Application Control Security Profiles and validate that \"P2P\" and \"Proxy\" category is blocked. (No CLI/CONFIG command is provided for this control in the source audit file — remediation is GUI-based policy review only.)",
    "category": "4.5 Application Control",
    "sort_order": 51,
    "is_mandatory": 1,
    "tags": [
      "level:L1",
      "800-53|SC-7(8)",
      "CSCv7|9.5"
    ]
  },
  {
    "control_id": "4.5.2",
    "title": "Block applications running on non-default ports",
    "description": "Ensure FortiGate Application Control blocks applications running on non-default ports. Running applications on non-default ports is not directly a threat, but can be an indication of something unexpected. For example, HTTPS runs on port 443. Potentially, if an attacker starts a rogue HTTPS server on port 10443, it could be used for data exfiltration.",
    "guidance": "GUI:\n1. Go to \"Security Profiles\" > \"Application Control\"\n2. Select relevant App Control profile\n3. Enable \"Block applications detected on non-default ports\" option\n\nCLI:\nFGT1 # config application list\nFGT1 (list) # edit <profile name>\nFGT1 (<profile name>) # set enforce-default-app-port enable",
    "category": "4.5 Application Control",
    "sort_order": 52,
    "is_mandatory": 0,
    "tags": [
      "level:L2",
      "800-53|SI-3"
    ]
  },
  {
    "control_id": "4.5.3",
    "title": "Ensure all Application Control related traffic is logged",
    "description": "CIS FortiGate control 4.5.3 (\"Ensure all Application Control related traffic is logged\") requires that no Application Control category be left set to \"Allow.\" Any category set to \"Allow\" is not logged by FortiGate's Application Control profile, which creates a visibility gap for security investigations and incident forensics/response — this includes the \"Unknown Applications\" category.",
    "guidance": "On the FortiGate GUI:\n1. Go to \"Security Profiles\" > \"Application Control\".\n2. Select the relevant App Control profile.\n3. Change any categories with \"Allow\" action to \"Monitor\".\n\nImpact: Visibility gap, which affects incident forensics and response.\n\n(No CLI/CGI commands are provided for this control on the Tenable audit page — remediation is GUI-only.)",
    "category": "4.5 Application Control",
    "sort_order": 53,
    "is_mandatory": 1,
    "tags": [
      "level:L1",
      "800-53|SI-4",
      "800-53|SI-4(4)",
      "CSCv7|6.3"
    ]
  },
  {
    "control_id": "4.5.4",
    "title": "Apply Application Control Security Profile to Policies",
    "description": "CIS FortiGate 7.4.x v1.0.1 (L1) Benchmark, control 4.5.4 \"Apply Application Control Security Profile to Policies.\" Rationale: Ensuring that traffic traversing between networks on the FortiGate have an Application Control security profile inspecting it. Traffic moving between \"interfaces\" on the FortiGate should have firewall policies applied with an Application Control security profile applied. NOTE: Nessus has provided the target output to assist in reviewing the benchmark to ensure target compliance.",
    "guidance": "Configure on all \"Allowed\" firewall policies to have an appropriate Application Control security profile applied to policies.\n\nNote: No CLI/console commands are provided for this control in the Tenable audit source — the remediation text above is the complete Solution field as published (GUI/policy-configuration guidance only, no verbatim CLI syntax given).",
    "category": "4.5 Application Control",
    "sort_order": 54,
    "is_mandatory": 1,
    "tags": [
      "level:L1",
      "800-53|AC-3",
      "800-53|AC-5",
      "800-53|AC-6",
      "800-53|MP-2",
      "CSCv7|9.5",
      "CSCv7|18.10"
    ]
  },
  {
    "control_id": "5.1.1",
    "title": "Enable Compromised Host Quarantine",
    "description": "This control governs the default automation trigger that fires when a high-severity compromised host is detected on the FortiGate. Enabling it activates a default automation stitch that automatically quarantines that host across FortiAPs, FortiSwitches, and FortiClient EMS endpoints, protecting the environment from a compromised device spreading further. It applies only where Fortinet's solution ecosystem (FortiGate paired with FortiAP, FortiSwitch, or FortiClient EMS) is deployed.",
    "guidance": "GUI: Security Fabric > Automation, then edit the relevant automation stitch/trigger and change the status from Disabled to Enabled.\n\nCLI:\n```\nconfig system automation-action\nedit \"Quarantine on FortiSwitch + FortiAP\"\nset description \"Default automation action configuration for quarantining a MAC address on FortiSwitches and FortiAPs.\"\nset action-type quarantine\nnext\nedit \"Quarantine FortiClient EMS Endpoint\"\nset description \"Default automation action configuration for quarantining a FortiClient EMS endpoint device.\"\nset action-type quarantine-forticlient\nnext\nend\nconfig system automation-trigger\nedit \"Compromised Host - High\"\nset description \"Default automation trigger configuration for when a high severity compromised host is detected.\"\nnext\nend\nconfig system automation-stitch\nedit \"Compromised Host Quarantine\"\nset description \"Default automation stitch to quarantine a high severity compromised host on FortiAPs, FortiSwitches, and FortiClient EMS.\"\nset status enable\nset trigger \"Compromised Host - High\"\nconfig actions\nedit 1\nset action \"Quarantine on FortiSwitch + FortiAP\"\nnext\nedit 2\nset action \"Quarantine FortiClient EMS Endpoint\"\nnext\nend\nnext\nend\n```",
    "category": "5 Automation & Security Fabric",
    "sort_order": 55,
    "is_mandatory": 1,
    "tags": [
      "level:L1",
      "800-53|AC-17",
      "800-53|AC-17(1)",
      "800-53|CM-6",
      "800-53|CM-7",
      "800-53|SC-7",
      "800-53|SI-4",
      "CSCv7|8.1",
      "CSCv7|8.3"
    ]
  },
  {
    "control_id": "5.2.1.1",
    "title": "Ensure Security Fabric is Configured",
    "description": "CIS FortiGate 7.4.x v1.0.1 (L2) control 5.2.1.1 \"Ensure Security Fabric is Configured.\" Rationale: ensure the root FortiGate is configured as the Security Fabric root; without a configured root FortiGate the Security Fabric is not functional and cannot be leveraged (only applicable if the Security Fabric feature is in use). Impact of non-compliance: without Security Fabric enabled, visibility and management of traffic across the organization is decreased and individual FortiGate management becomes more intensive. Note: Nessus does not perform this check automatically — the benchmark must be reviewed manually to confirm target compliance.",
    "guidance": "Remediation through the GUI (no CLI commands are provided for this check):\n\n1. Go to \"Security Fabric\" -> Fabric Connectors and then select \"Security Fabric Setup\".\n2. On the root FortiGate, set the status to enabled and the Security Fabric Role to \"Serve as Fabric Root\".\n3. Configure FortiAnalyzer settings when prompted and define a Fabric name as well as interfaces that will \"Allow other Security Fabric Devices to Join\".",
    "category": "5 Automation & Security Fabric",
    "sort_order": 56,
    "is_mandatory": 0,
    "tags": [
      "level:L2",
      "800-53|CM-6b."
    ]
  },
  {
    "control_id": "6.1.1",
    "title": "Apply a Trusted Signed Certificate for VPN Portal",
    "description": "CIS FortiGate 7.4.x v1.0.1 L2 control 6.1.1 \"Apply a Trusted Signed Certificate for VPN Portal\". Rationale (Info): Apply a signed certificate from a trusted Certificate Authority (CA) to the SSL VPN portal to allow users to connect securely with confidence. Having an unsigned or self signed certificate leaves connections open to man-in-the-middle attacks and could allow users to connect to untrusted servers. NOTE: Nessus has provided the target output to assist in reviewing the benchmark to ensure target compliance.",
    "guidance": "Import a signed certificate from a trusted CA through the GUI:\n\n1. Go to System > Certificates > Import.\n2. Then assign the certificate to the SSL VPN portal by going to VPN > SSL-VPN Settings and selecting the proper certificate in the dropdown for \"Server Certificate\".\n\n(No CLI commands are given for this item — remediation is GUI-only.)",
    "category": "6 VPN",
    "sort_order": 57,
    "is_mandatory": 0,
    "tags": [
      "level:L2",
      "800-53|AC-17",
      "800-53|AC-17(1)",
      "800-53|AC-17(3)",
      "CSCv7|1.8"
    ]
  },
  {
    "control_id": "6.1.2",
    "title": "Enable Limited TLS Versions for SSL VPN",
    "description": "Enable and disable TLS versions and Cipher suites for more granular control of SSL VPN connections and enforcing more secure connections. Limiting TLS versions to more secure versions as well as enforcing stronger ciphers increases the security of the SSL VPN connections.",
    "guidance": "CLI commands:\nconfig vpn ssl settings\nset ssl-max-proto-ver tls1-3\nset ssl-min-proto-ver tls1-2\nset algorithm high",
    "category": "6 VPN",
    "sort_order": 58,
    "is_mandatory": 0,
    "tags": [
      "level:L2",
      "800-53|AC-17",
      "800-53|AC-17(1)",
      "800-53|AC-17(3)"
    ]
  },
  {
    "control_id": "7.1.1",
    "title": "Enable Event Logging",
    "description": "Enabling event logging generates logs that can be stored for later review or auditing, or ingested by another system (SIEM, Analyzer) for monitoring and response.",
    "guidance": "GUI: 1. Go to Log & Report > Log Settings. 2. Enable \"All\" Event Logging.\n\nCLI:\nconfig log eventfilter\n    set event enable\nend",
    "category": "7 Logging & Monitoring",
    "sort_order": 59,
    "is_mandatory": 0,
    "tags": [
      "level:L2",
      "800-53|AU-2, AU-3, AU-3(1), AU-6(3), AU-7, AU-12",
      "CSCv7|6.2, 6.3, 8.8"
    ]
  },
  {
    "control_id": "7.2.1",
    "title": "Centralized Logging and Reporting",
    "description": "Device logs should be sent to a centralized device for log collection, retention, and reporting. This could be a SIEM, syslog device, FortiAnalyzer, FortiManager, etc. Centralized logging allows for more reliable log retention and more enriched log data for review and reporting.",
    "guidance": "Configure a remote server for logs to be sent to:\n1. Go to Log & Report > Log Settings.\n2. Under \"Syslog logging\" configure a remote server to send logs to.",
    "category": "7 Logging & Monitoring",
    "sort_order": 60,
    "is_mandatory": 0,
    "tags": [
      "level:L2",
      "800-53|AU-1",
      "800-53|AU-2",
      "800-53|AU-6(3)",
      "CSCv7|6.3",
      "CSCv7|8.6"
    ]
  },
  {
    "control_id": "7.3.1",
    "title": "Encrypt Log Transmission to FortiAnalyzer / FortiManager",
    "description": "Enable encryption for logs sent to FortiAnalyzer or FortiManager. This provides encryption for logs transmitted to FortiAnalyzer or FortiManager to prevent logs from being collected and viewed as they traverse the network.",
    "guidance": "Secure log transfer settings can only be configured on CLI:\n\nconfig log fortianalyzer setting\nset reliable enable\nset enc-algorithm high\nend",
    "category": "7 Logging & Monitoring",
    "sort_order": 61,
    "is_mandatory": 1,
    "tags": [
      "level:L1",
      "800-53|AC-17(2)",
      "800-53|IA-5",
      "800-53|IA-5(1)",
      "800-53|SC-8",
      "800-53|SC-8(1)",
      "CSCv7|14.4"
    ]
  },
  {
    "control_id": "7.3.2",
    "title": "Encrypt Log Transmission to Syslog",
    "description": "Enable encryption for logs that are sent to FortiAnalyzer or FortiManager. Provides encryption for logs that are sent to syslog to prevent logs being collected and viewed as they traverse the network.",
    "guidance": "Secure log transfer settings can only be configured on CLI:\n\nconfig log syslog setting\nset reliable enable\nset enc-algorithm high\nend",
    "category": "7 Logging & Monitoring",
    "sort_order": 62,
    "is_mandatory": 1,
    "tags": [
      "level:L1",
      "800-53|AC-17(2)",
      "800-53|IA-5",
      "800-53|IA-5(1)",
      "800-53|SC-8",
      "800-53|SC-8(1)",
      "CSCv7|14.4"
    ]
  },
  {
    "control_id": "7.3.3",
    "title": "Encrypt Log Transmission to Syslog",
    "description": "Enable encryption for logs sent to FortiAnalyzer or FortiManager. This provides encryption for logs sent to syslog to prevent them from being collected and viewed in cleartext as they traverse the network.",
    "guidance": "Configure via CLI:\n\nconfig log syslog setting\nset reliable enable\nset enc-algorithm high\nend",
    "category": "7 Logging & Monitoring",
    "sort_order": 63,
    "is_mandatory": 1,
    "tags": [
      "level:L1",
      "800-53|AC-17(2)",
      "800-53|IA-5",
      "800-53|IA-5(1)",
      "800-53|SC-8",
      "800-53|SC-8(1)",
      "CSCv7|14.4"
    ]
  }
]
''')


def add_cis_fortigate(cur):
    if framework_exists(cur, "cis-fortigate-7.4"):
        print("CIS FortiGate 7.4.x Benchmark already exists, skipping.")
        return
    fid = insert_framework(
        cur,
        name="CIS FortiGate 7.4.x Benchmark",
        short_name="cis-fortigate-7.4",
        version="1.0.1",
        description=(
            "CIS security configuration benchmark for Fortinet FortiGate devices running "
            "FortiOS 7.4.x. Covers network configuration, system hardening, administrative "
            "access, security profiles (AV/IPS/DNS/Web/App Control), automation and Security "
            "Fabric, VPN, and logging. 39 Level 1 (baseline) controls and 25 Level 2 "
            "(defense-in-depth) controls."
        ),
        issuing_body="Center for Internet Security (CIS)",
        regions='["global"]',
        industries='["all"]',
    )
    for c in CIS_FORTIGATE_CONTROLS:
        insert_control(
            cur,
            framework_id=fid,
            control_id=c["control_id"],
            title=c["title"],
            description=c["description"],
            category=c["category"],
            sort_order=c["sort_order"],
            guidance=c["guidance"],
            tags=json.dumps(c["tags"]),
            is_mandatory=c["is_mandatory"],
        )
    print(f"Added CIS FortiGate 7.4.x Benchmark v1.0.1 with {len(CIS_FORTIGATE_CONTROLS)} controls.")


def main():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    try:
        add_cis_fortigate(cur)
        conn.commit()
        print("\nDone. Framework committed.")
    except Exception as e:
        conn.rollback()
        print(f"Error: {e}")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
