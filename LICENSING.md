> Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents) from ZCode (https://github.com/zai-org/ZCode). Apache-2.0 §4(b) modification notice.

# Licensing

Lumi Agents is an independently maintained fork of
[ZCode](https://github.com/zai-org/ZCode) (upstream base
`872ad960de7ec172591f7e1952f7849229f94521`, Apache-2.0). This page explains, in
plain language, what you may do with the code here, what a paid Lumi offering is
expected to add, and what this licensing model does **not** do.

- Policy decision: [docs/specs/lumi-agents/adr/0001-licensing-and-contribution-model.md](docs/specs/lumi-agents/adr/0001-licensing-and-contribution-model.md)
- Rights map: [RIGHTS.md](RIGHTS.md)
- Compliance record: [docs/licensing/COMPLIANCE.md](docs/licensing/COMPLIANCE.md)
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md) · Brand: [TRADEMARKS.md](TRADEMARKS.md)

## The short version

- **CLOUDJET SOLUTIONS PTE. LTD.** (Singapore UEN **201708398E**) develops and
  maintains the Lumi Agents fork and is its project steward.
- Cloudjet first-party Lumi code and inherited ZCode code covered by the root
  license are distributed under **Apache-2.0**. Third-party components, vendored
  material, runtimes, and assets retain their own applicable licenses and notices.
  For Apache-covered material, commercial use, modification, and redistribution
  are permitted subject to the license terms.
- **Businesses can use the community edition internally for free.** No paid license
  is needed to run Apache-licensed software.
- Payment, in future Lumi offerings, buys **services and separately licensed
  software** (hosted management, enterprise administration, support) — **not**
  permission to exercise rights Apache already grants.
- Contributing back is lightweight: sign your commits (`git commit -s`, DCO 1.1).
  You keep copyright; Apache-2.0 inbound/outbound for first-party public code.
- Apache-2.0 may grant copyright permissions in covered Lumi artwork files, but
  section 6 does **not** grant trademark permission to use the Lumi Agents name or
  folded-L mark as a source identifier implying official origin or endorsement.
  See [TRADEMARKS.md](TRADEMARKS.md).

## Project stewardship and who owns what

Cloudjet's role as Lumi Agents maintainer and distributor is intentionally
separate from copyright ownership:

- Inherited ZCode code and notices remain attributable to Z.AI Co., Ltd and the
  relevant upstream contributors.
- Cloudjet holds copyright only in Lumi-specific work that Cloudjet actually
  authored or validly acquired by assignment.
- Independent contributors retain copyright in their contributions unless they
  separately assign it; the project's DCO + Apache policy grants the rights
  needed to distribute those contributions.
- Third-party components retain their own terms.

For that reason, the root `LICENSE` is kept intact rather than replacing the
inherited Z.AI notice with Cloudjet's name. Cloudjet's project identity and
rights in its own work are recorded in [RIGHTS.md](RIGHTS.md), NOTICE, package
metadata, and the About/Credits surfaces. This is the strongest truthful
Cloudjet positioning without pretending an upstream copyright transfer occurred.

## The license is not withdrawn by future decisions

Apache-2.0 grants are expressed as perpetual and irrevocable subject to the
license's terms; the patent grant also contains the specific patent-litigation
termination rule. A later Cloudjet licensing decision cannot retroactively turn a
previous Apache-2.0 release into a proprietary-only release. Previously distributed
upstream and Lumi material remains governed by the license grants applicable to
that release.

## What is open (public community layer)

The public source tree exposes the desktop, web and CLI clients, local agent
runtime, provider interfaces, extension/SDK surfaces, local permission controls,
examples, contribution tooling, and documentation. Cloudjet/Lumi first-party
material and inherited ZCode material covered by the root license are Apache-2.0;
third-party and vendored material stays under the license identified for that
component or file.

## What a paid offering is expected to add (proposed, not shipped)

The following are **product hypotheses for future, separately licensed work with
established rights**. None exist today; no code in this repository implements them;
no public feature is being moved behind them:

- Hosted organization administration and managed execution services.
- Fleet/device management, centralized policy administration, organization-level
  audit/retention and operational reporting.
- Managed deployments, support commitments and maintained workflow integrations.
- Distinctive company-owned vertical modules, evaluation assets and automation
  packages, where a paid value proposition has been validated.

These would live in **separate private repositories** behind documented public
interfaces. The community build and its tests must never depend on private source
or paid entitlements. A directory boundary or an HTTP interface alone does not make
code legally separable — provenance and dependency review decide that, per
[COMPLIANCE.md](docs/licensing/COMPLIANCE.md).

## Competitors

Competitors may lawfully build, sell and support compliant forks using the
permissions available for the relevant material. Apache-2.0 gives everyone the
same copyright/patent permissions for Apache-covered material; third-party
components remain subject to their own terms. Lumi's commercial strategy must
compete on execution and service quality, not by adding restrictions that
contradict existing open-source grants.

## Copied material and mixed artifacts

Inherited upstream files keep their upstream status; they are not relabeled as
Lumi-owned. Files modified by Lumi carry prominent modification notices (Apache-2.0
§4(b)) — see [docs/licensing/MODIFICATIONS.md](docs/licensing/MODIFICATIONS.md).
Third-party components are registered in `third-party/` with their own licenses;
no third-party metadata is overwritten with Apache-2.0, and mixed artifacts are
never described as exclusively owned by any single party.

## FAQ

**Can a business use Lumi Agents for free?**
Apache-covered Lumi/ZCode material may be used without a paid Lumi license,
including commercially, subject to Apache-2.0. Third-party components remain
subject to their own applicable license terms.

**Can someone sell a fork?**
For Apache-covered material, yes: Apache-2.0 permits commercial redistribution
and selling subject to its conditions. A complete distribution must also comply
with the licenses of any included third-party components. Trademark permission is
separate; see [TRADEMARKS.md](TRADEMARKS.md).

**Must ordinary contributors assign copyright?**
No. Contributions are made under the Developer Certificate of Origin plus the
Apache-2.0 license; the applicable copyright owner retains ownership unless a
separate assignment applies. DCO certifies submission provenance/right-to-submit;
it is not an assignment and not an exclusive license.

**What does a paid Lumi product add?**
Hosted/managed services, enterprise administration, support and — where developed —
separately licensed proprietary modules. It never adds _permission_ to use the
Apache-licensed code; you already have that.

**Does Apache grant trademark rights to the Lumi name or mark?**
No. Apache-2.0 section 6 does not grant trademark rights. Separately, if a Lumi
artwork file is itself distributed under Apache-2.0, the copyright permissions of
that license can apply to the file. Using the artwork as a product/source mark
remains a distinct trademark question; see [TRADEMARKS.md](TRADEMARKS.md).

**What can't this licensing model protect?**
It cannot create exclusive ownership of community code (everyone's Apache grants
remain), cannot prohibit compliant competitors, cannot substitute for trademark
registration, cannot guarantee revenue or investment, and cannot replace customer
contracts, privacy terms or security processes for paid offerings. It also cannot
repair chain-of-title gaps — those are tracked as diligence items, not solved by
documentation.

## Disclaimers

This page describes repository policy. It is not legal advice. Apache-covered software is
licensed "as is" under Apache-2.0's warranty and liability disclaimers (sections 7
and 8). Third-party material remains governed by its own applicable terms.
Upstream ZCode/Z.AI contributors do not provide Lumi's contractual commitments.
Paid services, hosted offerings and enterprise software would require separately
reviewed customer terms; none are offered by anything in this repository.
