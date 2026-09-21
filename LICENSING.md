> Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents) from ZCode (https://github.com/zai-org/ZCode). Apache-2.0 §4(b) modification notice.

# Licensing

Lumi Agents is an independently maintained fork of
[ZCode](https://github.com/zai-org/ZCode) (upstream base
`872ad960de7ec172591f7e1952f7849229f94521`, Apache-2.0). This page explains, in
plain language, what you may do with the code here, what a paid Lumi offering is
expected to add, and what this licensing model does **not** do.

- Policy decision: [docs/specs/lumi-agents/adr/0001-licensing-and-contribution-model.md](docs/specs/lumi-agents/adr/0001-licensing-and-contribution-model.md)
- Compliance record: [docs/licensing/COMPLIANCE.md](docs/licensing/COMPLIANCE.md)
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md) · Brand: [TRADEMARKS.md](TRADEMARKS.md)

## The short version

- The code in this public repository is licensed under **Apache-2.0**. You may use
  it commercially, modify it, and redistribute it (including selling forks), subject
  to its terms: keep notices and attribution, state significant changes, and carry
  the Apache license text with your distribution.
- **Businesses can use the community edition internally for free.** No paid license
  is needed to run Apache-licensed software.
- Payment, in future Lumi offerings, buys **services and separately licensed
  software** (hosted management, enterprise administration, support) — **not**
  permission to exercise rights Apache already grants.
- Contributing back is lightweight: sign your commits (`git commit -s`, DCO 1.1).
  You keep copyright; Apache-2.0 inbound/outbound for first-party public code.
- "Lumi Agents" the name and brand are **not** granted by Apache. See
  [TRADEMARKS.md](TRADEMARKS.md).

## The license is not withdrawn by future decisions

Apache-2.0 grants are **perpetual and irrevocable** for code already distributed
under it (section 3 and the license's termination clause: rights end only if you
materially breach the license terms and don't cure). If Lumi ever ships a module
under a different license, or changes this repository's license for _future_
versions, every version already released under Apache-2.0 remains available under
Apache-2.0 forever, for everyone, for any use including commercial use. The same
applies to upstream ZCode material: its Apache grant cannot be withdrawn by either
Z.AI or Lumi.

## What is open (public community layer)

Everything currently in this repository, including:

- Desktop, web and CLI clients and the local agent runtime, as published today.
- Provider interfaces, bring-your-your-key paths, extension protocols and SDK
  surfaces where currently open.
- Local permission controls, safety-relevant code, inspectable tool execution and
  data-portability features.
- Public examples, contribution tooling and documentation under their applicable
  licenses (documentation pages in this repo are Apache-2.0 like the rest unless a
  page states otherwise).

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

Competitors may lawfully build, sell and support compliant forks of the public
code. Apache-2.0 gives them the same rights it gives Lumi. Lumi's commercial
strategy must compete on execution and service quality; it cannot — and does not
attempt to — use a license to prohibit competition. Nothing in NOTICE, README or
here may be read as imposing additional restrictions beyond Apache-2.0's terms.

## Copied material and mixed artifacts

Inherited upstream files keep their upstream status; they are not relabeled as
Lumi-owned. Files modified by Lumi carry prominent modification notices (Apache-2.0
§4(b)) — see [docs/licensing/MODIFICATIONS.md](docs/licensing/MODIFICATIONS.md).
Third-party components are registered in `third-party/` with their own licenses;
no third-party metadata is overwritten with Apache-2.0, and mixed artifacts are
never described as exclusively owned by any single party.

## FAQ

**Can a business use Lumi Agents for free?**
Yes. Run it internally, deploy it to your team, integrate it into your workflows.
Apache-2.0 requires no payment, no registration and no permission.

**Can someone sell a fork?**
Yes. Apache-2.0 explicitly permits commercial redistribution and selling. A fork
must keep the license and notices, state its changes, and must not use the Lumi
name or brand to imply endorsement (see [TRADEMARKS.md](TRADEMARKS.md)).

**Must ordinary contributors assign copyright?**
No. Contributions are made under the Developer Certificate of Origin plus the
Apache-2.0 license; you keep copyright. DCO certifies where the code came from —
it is not an assignment and not an exclusive license.

**What does a paid Lumi product add?**
Hosted/managed services, enterprise administration, support and — where developed —
separately licensed proprietary modules. It never adds _permission_ to use the
Apache-licensed code; you already have that.

**Does Apache grant rights to the Lumi name?**
No. Software licenses cover the software. The name, logo and brand materials are
not licensed by Apache-2.0 and are not granted for third-party products; see
[TRADEMARKS.md](TRADEMARKS.md) for the limited, truthful uses that are fine.

**What can't this licensing model protect?**
It cannot create exclusive ownership of community code (everyone's Apache grants
remain), cannot prohibit compliant competitors, cannot substitute for trademark
registration, cannot guarantee revenue or investment, and cannot replace customer
contracts, privacy terms or security processes for paid offerings. It also cannot
repair chain-of-title gaps — those are tracked as diligence items, not solved by
documentation.

## Disclaimers

This page describes repository policy. It is not legal advice. The software is
licensed "as is" under Apache-2.0's warranty and liability disclaimers (sections 7
and 8), which apply to Lumi's distribution of inherited and community code alike.
Upstream ZCode/Z.AI contributors do not provide Lumi's contractual commitments.
Paid services, hosted offerings and enterprise software would require separately
reviewed customer terms; none are offered by anything in this repository.
