# ADR 0001: Lumi Agents licensing and contribution model

- Status: Accepted (this repository's policy)
- Date: 2026-09-21
- Supersedes: nothing (initial licensing ADR)
- Context docs: [LICENSING.md](../../../LICENSING.md),
  [CONTRIBUTING.md](../../../CONTRIBUTING.md), [TRADEMARKS.md](../../../TRADEMARKS.md),
  [docs/licensing/COMPLIANCE.md](../licensing/COMPLIANCE.md)

## Decision

For the public repository `RunLumi/LumiAgents`:

1. **Public community code stays Apache-2.0.** The root `LICENSE` (including the
   upstream `Copyright 2026 Z.AI Co., Ltd` line) is retained unchanged. New
   first-party public code is contributed under Apache-2.0 as well.
2. **Future commercial modules/services are separately licensed.** They are built in
   their own private repositories with public documented interfaces. Nothing in this
   repository is reclassified as proprietary.
3. **Public contributions use DCO.** Contributors certify provenance with
   `Signed-off-by` (Developer Certificate of Origin 1.1); inbound license is
   Apache-2.0 for first-party public code; contributors retain copyright.
4. **Trademark guidance is separate from software licensing.** See
   [TRADEMARKS.md](../../../TRADEMARKS.md); it states only what evidence supports.

## Alternatives considered

- **Copyleft (AGPL-3.0) for the public code.** Would force reciprocity onto
  commercial users and cloud providers. Rejected: it changes the obligations already
  communicated to users of the existing Apache-licensed distribution, and
  reciprocating the inherited Apache material under AGPL would not be clearly
  compatible in all directions.
- **Delay-open licenses (FSL/BUSL).** Time-delayed source availability is not
  open-source and would contradict the fork's stated basis in Apache-licensed
  upstream work. Rejected.
- **CLA / copyright assignment.** Gives the operator future relicensing flexibility
  but adds legal friction, suppresses casual contributions, and requires operator
  infrastructure (signing, entity agreements) that does not currently exist. DCO
  achieves provenance traceability at much lower cost. Rejected for ordinary public
  contributions; any future differently-licensed product line needs a separate,
  explicit contribution arrangement — never a silent reuse of this DCO flow.
- **Single proprietary license with open-source exceptions.** Contradicts the
  fork's public basis and upstream obligations. Rejected.

## Why open-core is coherent here

Apache-2.0 grants everyone — customers, competitors, Lumi itself — the rights to
use, modify, sell and redistribute the public code. That is a feature: it maximizes
adoption and trust in the community edition. A commercial layer competes on
**operated services, support, enterprise administration and separately licensed
additions**, not on restricting rights the public code already grants. This policy
therefore never claims that the license both grants freedom and prohibits
competition; it doesn't.

## Limitations (stated, not hidden)

- This ADR is an engineering/provenance policy, not legal advice, and creates no
  corporate obligation until adopted by the rights holder(s).
- The DCO certifies the _origin_ of contributions; it is **not** a copyright
  assignment, an exclusive grant, or a relicensing agreement.
- No trademark registration or exclusive brand right is asserted anywhere in this
  documentation; brand scope is limited to actual evidence.
- The open/commercial boundary in LICENSING.md marks commercial items as
  **proposed**: none exist yet, and no public code is moved behind a commercial
  claim by this ADR.
- Ownership of founder/employee/contractor work is an unresolved diligence item
  tracked in `docs/licensing/COMPLIANCE.md`; nothing here repairs chain of title.
- This model does not guarantee investment, exclusivity, legal compliance or
  freedom from liability.
