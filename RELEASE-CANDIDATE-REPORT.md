# QueueZeroTwo release candidate — v58

## Scope
Cumulative backup integrity, publishing reliability, handoff safety, accessibility, and documentation changes. This is a review candidate, not a production release.

## Changes
- Backup restoration: at least one court, sequential unique court IDs, finite non-negative integer active and historical scores.
- Shared score sanitizer also protects results sharing; regression test covers the shared scope.
- Publishing: preserve immutable queued/in-flight results, retain queued entries on rejected network promises, preserve distinct result codes and coalesce pending state without modifying in-flight state.
- Host handoff: guard offline transfers and pending results, offer backup export, clarify QR lifetime and that a QR transfers control rather than session data, handle rejected rotation RPC.
- Accessibility: explicit toolbar labels, sound/theme/voice pressed states, heading-based modal labels, standalone standings label, minimum 44px top-level touch targets.
- README: remove contradictory team mode descriptions, clarify backup-first handoff.
- CI: integrate backup, publishing and handoff regression tests; cache allocation v58.

## Verification and limitations
The earlier local candidate passed standalone regression tests but six browser suites could not start due to missing Playwright. The shared score sanitizer scope was corrected before submission to GitHub; CI must validate the exact PR commit. Full manual UAT, actual two-device synchronization, database migration replay, real device installation and rendered accessibility remain unverified. Full automatic secure session transfer is not implemented; use private backup export/import before scanning. No database schema or authentication changes are included.

## Before release
Run complete CI, test handoff on an isolated backend with two devices, verify mobile controls at 320px, and obtain deployment approval.
