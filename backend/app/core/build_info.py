"""
Build-time license constants.

The defaults checked into the repo keep license enforcement OFF, so the SaaS
deployment (and local dev) is completely unaffected. The protected client
Docker build OVERWRITES this file BEFORE obfuscation — baking in
LICENSED_BUILD = True and the customer-facing public key — so a client
cannot disable enforcement or swap the key via environment variables.
"""

LICENSED_BUILD = False
LICENSE_PUBLIC_KEY = ""
