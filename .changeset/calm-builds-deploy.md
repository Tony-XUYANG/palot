---
"@palot/desktop": patch
---

Keep Sealos remote deployments moving when GHCR is already public or a transient
kubectl or HTTP transport failure interrupts verification. Official Sealos domains
now use direct Node HTTPS transport while custom domains keep Electron system proxy behavior,
and Launchpad checks use the authenticated Sealos region.
