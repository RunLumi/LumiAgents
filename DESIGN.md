# Lumi Design System

## How to use this guide

**Preserve the shared Lumi identity.** Civic Editorial Intelligence, the lit operating
desk, light-only warm paper, Geist/Geist Mono, folded-L geometry, restrained material
depth, and every existing color value remain the brand contract. Improve hierarchy,
consistency, state clarity, and usability within that language; do not rebrand a page.

[AGENTS.md](AGENTS.md) governs scope and trust. [Spec 23](docs/specs/v1/23-user-experience-handoff.md)
governs Lumi Agents interaction semantics. This guide governs visual expression.
§19 owns base tokens; §10 owns component behavior; §24 is the review gate. Reuse the
existing primitive before adding a variant. A new component must solve a repeated
user problem that composition cannot, with explicit states and a removal test.

**Shared brand is not shared product scope.** CEO Brief, Daily Pulse, routes, native
class names, and `frontend/` paths below are companion-product reference examples,
not claims that those features/files exist here. Lumi Agents implements its own
Project → Task → Run journey using the same visual language. Do not add companion
screens, mobile shells, or a framework merely to match an example.

In this repository, inspect the shipped [desktop UI styles](apps/desktop/ui/src/styles/lumi.css),
[markup](apps/desktop/ui/src/App.tsx), and [behavior](apps/desktop/ui/src) before
implementation. Existing code or screenshots may lag this contract; record drift
rather than treating it as a new palette. This document does not prove deployed
parity, installed fonts, accessibility compliance, or passing tests.

## 0. Brand Summary — companion-product context

**Product name:** Lumi
**Vietnamese sales name:** Lumi AI Workspace
**Product category:** AI operating workspace for SME teams and CEOs
**Core product wedge:** Daily Pulse → Operating Memory → CEO Morning Brief
**Companion-product URL reference:** `lumi.locuno.com` (verify before publishing)

Lumi turns clear SME updates into a calm, evidence-based CEO morning brief: an operating assistant
for stuck, late, risky, or decision-bound work, not a chatbot, task clone, or surveillance tool.

---

# 1. Design Philosophy

## 1.1 Core Positioning

> Calm clarity for running a company.

Lumi is a calm, serious, evidence-led civic editorial command surface: accountable and respectful
of human judgment, never flashy, toy-like, surveillance-oriented, crypto/cyberpunk, childish, or
templated.

## 1.2 Visual Direction

**Civic Editorial Intelligence** applies Civic Editorial Minimalism to an AI workspace: institutional
trust, editorial clarity, warm human texture, precise structure, high signal, and no spectacle,
AI gimmicks, or decorative noise. It must satisfy a CEO, team member, and top designer alike.

## 1.3 The Exceptional Standard

Evaluate Lumi by what the user can understand and accomplish:

* **Earned trust:** the user sees the source, freshness, and limits before relying on a signal.
* **Quiet authority:** composed, edited, inevitable, never decorated.
* **Operational warmth:** serious, not cold, for teams in Vietnam, Malaysia, Indonesia,
  Saudi Arabia, the Philippines, Latvia, and markets like them.
* **Native confidence:** web, iOS, Android, Mac, and Watch are one product expressed
  through each platform's best behavior, never a stretched viewport.
* **Unconventional restraint:** show fewer things in a better order with stronger evidence,
  not a visual gimmick.

Every screen must make its actual job clearer, safer, or faster; visual polish alone is not completion.

## 1.4 The Product Metaphor

Lumi is a **lit operating desk**:

* Warm paper background: the desk surface.
* White cards: documents placed on the desk.
* Blue actions: signed authority.
* Amber and red rails: attention marks in the margin.
* Evidence chips: source notes attached to the claim.
* The clarity mark: Lumi found or verified something useful.

Never replace it with all-glass panels, neon depth, floating dashboards, or chatbot theatrics:
intelligence is work ordering, not visual effects. Floating chrome may use the scoped §8.0
liquid-glass recipes; the desk itself stays paper.

## 1.5 Civic Material Intelligence

The visual language is **Civic Editorial Minimalism + Material Intelligence**: civic-service
seriousness, editorial hierarchy, and high-end native tactility without ad-hoc glassmorphism, aurora
gradients, AI glow, or signal-competing decoration. Every visible object needs a physical reason:

| Material cue | Purpose | Allowed expression |
|---|---|---|
| Paper | calm reading, trust, warmth | `Paper White` canvas, slight top light |
| Sheet | grouped evidence, decisions, records | white surface, 1px border, lit top edge |
| Ink | authority and hierarchy | Civic Navy / Ink text, not black |
| Mark | attention and provenance | rail, badge, source chip, restrained clarity mark |
| Lift | interactivity or overlay plane | navy-tinted token shadow only |
| Glass | floating chrome above the work | translucent surface white, backdrop blur + saturation, §8.0 recipes |
| Well | input / capture area | recessed inner shade, white fill |
| Seal | primary authority | Lumi Blue button, active state, selected state |

Material is never decorative: remove any shadow, border, tint, or rail that does not explain state,
hierarchy, affordance, or provenance.

The serious-SaaS standard: less chrome and more judgment; fewer panels and better-ranked
information; more evidence and less performance; tactile enough to trust, quiet enough for daily use.

---

# 2. Logo Interpretation

The logo is a geometric folded **L-form**: two planes divided by a precise diagonal channel, deep
institutional blue, strong negative space, and an architectural silhouette.

## 2.1 What the logo communicates

It communicates structure and an operating system (**L-form**); work aligned (**two planes**);
movement, handoff, and progress (**diagonal channel**); trust and calm intelligence (**blue**);
simplicity (**open space**); and precision rather than decoration (**sharp geometry**).

## 2.2 Logo usage principles

Use it with restraint.

Do:

* Give the mark generous whitespace on warm paper or white.
* Keep the four-point clarity mark separate and subtle for verified insight.
* Use L geometry to inspire layouts, corners, dividers, and section framing.

Do not:

* Add decorative gradients beyond the supplied primary app-icon treatment
* Add AI glow
* Slant or italicize the `umi` wordmark; its outlined letters are upright
* Separate the folded-L and `u` by more than one wordmark stem width; the canonical lockup uses
  approximately 0.8× stem width
* Add glassmorphism
* Add drop shadows
* Add animated sparkle effects
* Place the logo on noisy backgrounds
* Merge the separate clarity motif back into the folded-L logo

## 2.3 Logo clear space

Minimum clear space equals the width of the diagonal channel. Use the mark alone for small app
icons.

For product headers, use:

```text
[Logo mark] Lumi
```

For Vietnamese sales material, use:

```text
[Logo mark] Lumi AI Workspace
```

---

# 3. Brand Keywords

Design filters: clear, calm, reliable, precise, evidenced, human, operational, executive,
trustworthy, warm, focused, quietly intelligent. Never direct visually toward futuristic, magical,
viral, flashy, neon, robotic, cyber, gamified, trendy, or hype.

---

# 4. Core Design Principle

## 4.1 The Mass-Love Layer

Most users should instantly feel:

> “This is clear, useful, and trustworthy.”

Require readable type, obvious hierarchy, familiar layouts, no visual stress, hidden navigation, or
overdesigned interactions, and no cleverness that blocks understanding.

## 4.2 The Designer-Praise Layer

Top designers should notice:

> “This is restrained, consistent, and unusually well-edited.”

Require strong typographic rhythm, whitespace, intentional grids, subtle paper texture, and
logo-derived icons, never generic SaaS gradients, AI stock illustration, or a template feel.

## 4.3 The CEO Layer

CEOs should feel:

> “This helps me see what matters without micromanaging.”

Prioritize brief, risk, decision, and operating signal; avoid task-board clutter; rank and group
information with evidence so every section answers: “What should I know or decide?”

---

# 5. Color System

> **Light-only — no dark mode.** Warm paper and civic ink are the brand. Web, iOS,
> iPadOS, macOS, watchOS, and Android have no dark theme or `prefers-color-scheme`
> branch: web sets `color-scheme: light` and keeps Tailwind `dark:` inert with a
> never-applied `.dark`; SwiftUI forces `.preferredColorScheme(.light)` and
> `Info.plist` `UIUserInterfaceStyle = Light`; Android `LumiTheme` always resolves
> a light `ColorScheme` and `values-night` mirrors it. Never restore dark palette.
>
> **One source of truth.** The token table in §19 is canonical. Every platform
> mirror in companion projects (`frontend/src/index.css`, `ios/Lumi/UI/Shared/LumiKit.swift`,
> `ios/LumiMac/Theme/LumiColors.swift`, `ios/LumiWatch/Theme/WatchColors.swift`,
> `android/.../theme/Color.kt`) must preserve the same resolved sRGB values — see the
> **Cross-Platform Token Parity** contract in §19.

## 5.1 Primary Palette

### Lumi Blue

```css
--color-lumi-blue: #006093;
```

Lumi Blue is deep cerulean, ocean ink, rebranded from cobalt `#0E3EB8` on 2026-07-09.
Cobalt had become generic AI/cloud/payments blue; cerulean keeps civic trust and reads as
operational intelligence, not an AI toy.

Use for:

* Logo
* Primary buttons
* Key links
* Active navigation
* Selected states
* Important chart lines
* Executive brief highlights

Personality:

* Trust
* Governance
* Reliability
* Operating clarity

---

### Civic Navy

```css
--color-civic-navy: #102A43;
```

Use for:

* Headlines
* Body text
* Navigation labels
* Dense UI text
* Executive brief titles

Personality:

* Serious
* Editorial
* Stable
* Professional

---

### Paper White

```css
--color-paper-white: #F4F0E8;
```

Use for:

* Main app background
* Landing page background
* Report surfaces
* Empty states

Do not default to pure white.
Warm paper makes the product feel more mature and less like a generic SaaS dashboard.
The paper is deliberately ~3 L\* below the white card surface (`#F4F0E8` vs `#FFFFFF`)
so cards read as **lit sheets resting on paper**, giving the `shadow-card`/elevation
system the tonal contrast it needs to register. Paper too close to white (the earlier
`#FAF8F4`) collapsed that depth into white-on-white — the exact generic-SaaS look §1.1
rejects.

---

### Surface White

```css
--color-surface-white: #FFFFFF;
```

Use for:

* Cards
* Modals
* Tables
* Input backgrounds

---

### Archive Gray

```css
--color-archive-gray: #E7EAF0;
```

Use for:

* Borders
* Dividers
* Table lines
* Quiet UI structure
* Disabled states

---

### Soft Slate

```css
--color-soft-slate: #5E6677;   /* AA ≥4.5:1 on paper */
```

Use for:

* Secondary text
* Timestamps
* Helper text
* Metadata

---

### Signal Amber

```css
--color-signal-amber: #F4A62A;
```

Use only for:

* Warnings
* Overdue flags
* Important notices
* Cash/payment risks
* Items needing attention

Limit amber to 5% of the interface.

---

### Risk Red

```css
--color-risk-red: #C2410C;
```

Use sparingly for:

* Critical risk
* Failed states
* Dangerous actions
* Data errors

Do not use red for normal urgency. Use amber first.

---

### Success Green

```css
--color-success-green: #1F7A4D;
```

Use for:

* Completed work
* Resolved risks
* Confirmed decisions
* Positive status

Avoid bright SaaS green.

---

## 5.2 Extended Palette

```css
:root {
  --color-lumi-blue: #006093;
  --color-lumi-blue-hover: #004F80;   /* blue-700 — perceptual hover step */
  --color-lumi-blue-active: #003E6A;  /* blue-800 — pressed */
  --color-lumi-blue-soft: #E4F3FC;

  --color-civic-navy: #102A43;
  --color-ink: #172033;
  --color-soft-slate: #5E6677;        /* AA ≥4.5:1 on paper (nudged from #667085) */

  --color-paper-white: #F4F0E8;
  --color-surface-white: #FFFFFF;
  --color-archive-gray: #E7EAF0;
  --color-border-subtle: #E7EAF0;
  --color-border: #D9DEE8;
  --color-border-strong: #C8D0DE;

  --color-signal-amber: #F4A62A;
  --color-amber-soft: #FFF4DC;

  --color-risk-red: #C2410C;
  --color-red-soft: #FFF1EC;

  --color-success-green: #1F7A4D;
  --color-green-soft: #E9F7EF;
}
```

---

## 5.3 Tonal Ramps & Wide-Gamut

Use the existing **OKLCH ramps** where the host project provides them; do not invent
new shades during feature work. The §19 sRGB anchors, hover, and pressed values
remain exact. A perceptual color space helps interpolation, but does not guarantee
identical perceived steps, zero hue shift after gamut mapping, or contrast.

Companion web projects may provide ramps and Display-P3 enhancements in
`frontend/src/index.css`. Their presence is not established in Lumi Agents. Preserve
existing approved enhancements where present, with the exact sRGB fallback; never
reinterpret the canonical hex values to make the brand more saturated. Verify the
rendered foreground/background pair on the target display. Wide gamut is optional;
consistent identity and legibility are required.

---

## 5.4 Color Temperament

Lumi color should feel expensive because it is controlled.

Rules:

* **Blue is authority.** Use Lumi Blue for the one action, active navigation,
  selected state, and trusted insight. Do not wash whole screens in blue.
* **Paper is material.** `Paper White` is not beige lifestyle branding; it is a
  calm reading surface. Pair it with white cards, navy text, and lit shadows so
  the app feels like documents on a desk.
* **Amber is attention.** Amber means "look here soon." It is the default for
  overdue, waiting, and business-risk states that are not catastrophic.
* **Red is rare.** Red means destructive, failed, blocked, critical, or legally
  dangerous. If everything is red, nothing is urgent.
* **Green is closure.** Use green for resolved, completed, paid, approved, and
  all-clear states. Do not use bright gamified green.
* **Gray is structure.** Archive Gray and Border provide document structure. They
  should never become a cold enterprise-gray theme.

Color budget per screen:

| Color role | Budget |
|---|---:|
| Paper / white / navy / slate | 85-95% |
| Lumi Blue | 3-8% |
| Amber / red / green combined | 1-6% |
| Decorative color | 0% |

These budgets guide emphasis, not pixel quotas that hide real warnings. Reuse existing
hues and semantic roles. A palette change requires a separate, explicitly approved
brand decision across affected Lumi projects; page-level work cannot authorize it.

## 5.5 Dark-ground status tints

The product is light-only (§5), but sales and print surfaces occasionally invert
one panel to Civic Navy to show the assistant's own output. Status colour still
has to survive that inversion: on `#102A43`, `risk-red` measures 2.83:1 and
`success-green` 2.75:1, both far under AA, so a status label rendered in them is
unreadable and the colour stops carrying meaning.

Three tints exist for that ground only. They are the **same semantics**, lifted
for legibility, never new meanings and never a second status palette:

| Token | Hex | On navy | Replaces |
|---|---|---:|---|
| `--color-amber-on-navy` | `#F4A62A` | 7.21:1 | `signal-amber` (unchanged; already passes) |
| `--color-red-on-navy` | `#FF9E7A` | 7.27:1 | `risk-red` |
| `--color-green-on-navy` | `#6FD39F` | 8.01:1 | `success-green` |

Rules:

* Use them **only** on a Civic Navy surface. On paper or white, the §5.2 hues
  remain the only correct choice.
* They are not a dark mode and do not license one. A navy panel is a single
  editorial inversion, not a theme.
* The saturated hue still carries the rail or dot; the tint carries the label
  text. Never invert that pairing.
* Any additional dark-ground tint needs the same measured contrast in this table
  before it ships.

---

# 6. Typography

## 6.1 Typeface — one brand family, two voices by weight

Type is **one family, Geist**, with authority expressed through weight and tracking,
not a second display face. Geist Mono serves technical content. Keep this shared
identity across Lumi products; framework choice does not change typography.

| Role | Face | Voice | Weight · tracking |
|------|------|-------|-------------------|
| **Titles / display** (page titles, hero, big numbers) | **Geist** (`--font-display`, `.font-display`) | heavier, tighter — authoritative | 600–700 · `-0.018em` titles → `-0.055em` hero |
| **UI / body / labels** (everything else) | **Geist** (`--font-sans`) | lighter, quieter — disappears behind the work | 400–500 · 0 to `-0.01em` |
| **Numeric / tabular** (tables, metrics, badges) | Geist, `tabular-nums` | figures align in columns; counts don't jitter | — |
| **Mono** (code, evidence hashes, technical bits) | **Geist Mono** (`--font-mono`) | the mono of the same system | 400–500 |

Where bundled, serve Geist and Geist Mono locally with `font-display: swap`; verify
the actual font assets, license, Vietnamese glyphs, and loaded weights rather than
assuming a named CSS family is installed. Do not add a font package as an incidental
part of a documentation or unrelated feature change.

**Noto is the multilingual safety net, not the brand.** Preserve the fallback stacks
below, but named Noto families are not guaranteed to exist on every OS. Test actual
Vietnamese, Arabic/RTL, and other supported scripts with the shipped font stack;
record missing coverage. Use natural shaping and platform fallback, never tofu or
shrunk text. Font feature settings must match features the loaded font supports.

Canonical stacks (mirrored on every platform — §19):

```
--font-sans / --font-display:
  Geist, "Noto Sans", "Noto Sans Thai", "Noto Sans Arabic", "Noto Sans Devanagari",
  "Noto Sans JP", "Noto Sans KR", "Noto Sans SC", "Noto Sans TC",
  ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
--font-mono:
  "Geist Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace
```

**Hard rules.** One brand family: **Geist** (+ Geist Mono for mono). Display vs body
is weight and tracking, *not* a second typeface. IBM Plex and Inter are removed
completely — do not reintroduce either, anywhere (web, iOS, Android, Mac, Watch,
slides, email, docs-site). No third face in core UI.

Avoid: Poppins · Montserrat · Futura-like startup fonts · overly rounded friendly
fonts · decorative serifs · thin weights below 400.

## 6.2 Type Scale

The canonical scale is the fluid `--text-xs` through `--text-display` set in §19.
Do not copy a second fixed-pixel scale into a component. The examples below describe
roles; resolve them through the host's shared primitive and text tokens. §16 sets
readability floors: body/input text must not fall below 16px at default scale,
metadata below 12px, or user-selected text scaling be overridden.

## 6.3 Product UI Typography

### App page title

```css
font-family: var(--font-display);   /* Geist, display weight */
font-size: 28px;
line-height: 1.2;
font-weight: 650;
letter-spacing: -0.02em;
color: var(--color-civic-navy);     /* editorial ink — never pure black */
```

**Headings are Civic Navy ink, never black.** Page and section titles use
`--color-civic-navy` (`#102A43`) on every platform (web `h1`–`h3`, iOS
`LumiPageTitle`, Android `LumiPageTitle`/`LumiSectionHeader`): pure black looks cheap on
warm paper; navy looks editorial. Lumi Blue is for actions, links, and selected state;
body stays ink/navy and metadata soft-slate.

Use the host’s shared page-header primitive with a semantic `<h1>`, an optional 12px,
uppercase, `0.14em`-tracked soft-slate eyebrow (date, section, context), and one-line lede.
Companion Today and CEO Brief can use a locale-aware date eyebrow (`Intl.DateTimeFormat`)
to orient executives before the title; use it whenever a page has a natural where/when line.

### Section title

```css
font-size: 18px;
line-height: 1.35;
font-weight: 650;
```

### Body text

```css
font-size: 16px;
line-height: 1.6;
font-weight: 400;
```

### Metadata

```css
font-size: 13px;
line-height: 1.4;
font-weight: 450;
color: var(--color-soft-slate);
```

## 6.4 Marketing Typography

Marketing pages can be more editorial.

Hero headline:

```css
font-size: clamp(42px, 7vw, 88px);
line-height: 0.96;
font-weight: 700;
letter-spacing: -0.055em;
```

Hero body:

```css
font-size: clamp(18px, 2vw, 22px);
line-height: 1.55;
font-weight: 400;
```

Use large confident typography instead of hero illustrations.

## 6.5 Typography Taste Rules

Typography is product infrastructure: the cheapest way to feel world-class or generic.

Rules:

* **Geist display (600–700, tight tracking) is authoritative:** page/brief titles,
  hero moments, and large numbers should feel infrastructural, not like a consulting deck.
* **Geist body (400–500) operates:** labels, tables, forms, metadata, chat, and dense mobile cards
  disappear behind the work.
* **One family:** display and body are Geist, differentiated only by weight/tracking. Never add a
  second font; Noto is glyph fallback only.
* **Numbers align:** use `tabular-nums` for counts, money, dates, percentages, and jitter-sensitive tables.
* **Metadata stays readable:** owners, sources, dates, and confidence bear trust.
* **Test Vietnamese:** verify diacritics, long phrases, and natural line breaks on mobile and desktop.
* **No fake editorial flourish:** no random italics, mixed-family emphasis, poetic labels,
  oversized microcopy, or decorative uppercase.

Line-length rules:

| Content | Ideal width |
|---|---:|
| CEO brief prose | 56-72 characters |
| Form helper text | 40-64 characters |
| Table cell text | truncate after useful signal, reveal full text on detail |
| Mobile card body | 2-3 lines max before progressive disclosure |

If a line is too long, improve the composition or the copy. Do not shrink text
below the scale.

---

# 7. Layout System

## 7.1 Grid

Desktop:

```css
max-width: 1200px;
outer-margin: 80px;
grid-columns: 12;
gap: 24px;
```

Tablet:

```css
outer-margin: 40px;
gap: 20px;
```

Mobile:

```css
outer-margin: 20px;
gap: 16px;
```

### 7.1.1 Reading column — match width to the cognitive task

1200px is an outer bound; width follows the task. **Reading/deciding** surfaces (Today,
CEO Brief, single-record detail) use a focused `max-w-3xl` ~768px editorial column so
they read rather than scan. **Scanning/comparing** surfaces (CRM, lists/boards,
dashboards) use 1200px. Narrow for prose and decisions; wide for grids and tables.

## 7.2 Spacing Scale

```css
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
--space-8: 32px;
--space-10: 40px;
--space-12: 48px;
--space-16: 64px;
--space-20: 80px;
--space-24: 96px;
```

## 7.3 Whitespace Rule

Whitespace separates decisions and groups related information; it is not a percentage
quota. Briefs need reading space; operating tables need comparison density. Use §7.2
spacing tokens and remove irrelevant content before widening gaps. The primary job,
current state, and next action should remain visible on a small laptop. Do not hide
necessary context below the fold to make a screen look calm.

## 7.4 One Message Per Section

Each page section answers one clear question: “What needs my decision?”, “What is overdue?”,
“Where is the team blocked?”, “Which customer is risky?”, or “What should I do today?” Split any
section that answers more than one.

## 7.5 Composition Grammar

Lumi uses three recurring compositions; choose by job.

### Briefing Column

Use for CEO Brief, Today, a single risk/decision/commitment, or any read-and-decide surface.

```text
Context
Primary summary
Ranked sections
Evidence / action
```

Rules:

* One focused column (`max-w-3xl`) unless comparison is required.
* The most important item appears above filters and secondary navigation.
* Each item shows claim, why it matters, owner, age/due date, and evidence.
* Actions sit near the claim they affect.

### Operating Table

Use for records that must be scanned, sorted, filtered, or compared.

```text
Header / filters
Table or compact list
Bulk or row actions
Detail sheet
```

Rules:

* Tables are for comparison, not decoration.
* On narrow views, use ranked cards when comparison survives; otherwise keep a labelled, keyboard-accessible table scroll region without forcing the whole page sideways.
* Filters must reduce cognitive load. If a filter is rarely used, move it.
* Empty states should explain what creates records and what Lumi will do next.

### Capture Form

Use for Daily Pulse, settings, invitations, and any user-entered operating
signal.

```text
Short purpose
One question per block
Clear save / submit
Recovery state
```

Rules:

* Forms stay single-column.
* Labels are always visible.
* Helper text is short and human.
* The save state is explicit: saving, saved, failed, retry.

Do not mix these compositions casually. A CEO brief with dashboard widgets, a
table with editorial prose blocks, or a pulse form with a dashboard sidebar all
feel confused.

---

# 8. Shape and Geometry

## 8.0 Material Recipes

Every UI object must use one of these recipes. Do not invent one-off material.

| Recipe | Background | Border | Radius | Shadow | Use |
|---|---|---|---|---|---|
| Canvas | `--color-paper-white` + `--canvas-glow` | none | 0 | none | app background |
| Sheet | `--color-surface-white` | 1px `--color-border` | 8px | `--shadow-card` | cards, table shells, list groups |
| Raised sheet | `--color-surface-white` | 1px `--color-border-strong` | 8px | `--shadow-raised` | sticky bars, hovered interactive cards |
| Overlay | `--color-surface-white` | 1px `--color-border-strong` | 12px | `--shadow-overlay` | popovers, menus, tooltips |
| Modal sheet | `--color-surface-white` | 1px `--color-border-strong` | 16px | `--shadow-modal` | dialogs, command palette, bottom sheets |
| Glass chrome | `--glass-tint` + backdrop `--glass-blur` | 1px `--glass-border` | 0 (flush) | `--shadow-raised` | sidebar, docked side panels |
| Glass overlay | `--glass-tint-strong` + backdrop `--glass-blur-strong` | 1px `--glass-border` | 12px | `--shadow-overlay` | popovers, menus, tooltips over content |
| Glass modal | `--glass-tint-strong` + backdrop `--glass-blur-strong` | 1px `--glass-border` | 16px | `--shadow-modal` | dialogs, command palette over content |
| Recessed well | `--color-surface-white` | 1px `--color-border` | 8px | `--shadow-input` | inputs, textareas, search fields |
| Lit token | status soft token | 1px same-hue inset ring | 999px | `--shadow-lit` | badges, chips, tabs |
| Authority seal | `--color-lumi-blue` + `--gradient-primary` | 1px blue-active mix | 8px | `--shadow-button` | primary action |

Rules:

* A page may use many objects, but only these material recipes.
* A card inside a card is prohibited. Use sections, dividers, or nested rows.
* Overlays must visibly float above sheets. If the shadow tier does not make the
  plane obvious, the plane is wrong.
* Sheet surfaces must be white. Do not tint cards by domain unless the whole
  card is an alert or empty state.
* The background glow is part of the canvas only. Never attach glows to
  individual components.

Liquid-glass rules (the §1.5 Glass cue):

* Glass recipes apply to floating chrome only — sidebar, side panels, popovers,
  menus, dialogs, command palette. Content surfaces (cards, tables, inputs,
  lists, badges) stay on their opaque recipes; the §10.2/§10.3 bans on glass
  content stand.
* Glass is derived from surface white and existing border tokens only. It adds
  no new palette; §5 governs every color it shows.
* Blur budget: at most three glass layers visible per screen. Never nest
  `backdrop-filter` inside another glass surface.
* Every glass surface has an opaque twin: when `backdrop-filter` is unsupported
  or the user prefers reduced transparency, render the equivalent opaque recipe
  at the same radius, border, and shadow.
* Text on glass must pass §16.1 contrast measured over the busiest content
  beneath it; raise the tint opacity until it does.

## 8.1 Border Radius

Use modest radius. Radius communicates object class, not mood.

```css
--radius-xs: 2px;
--radius-sm: 4px;
--radius-md: 8px;
--radius-card: 8px;
--radius-control: 8px;
--radius-popover: 12px;
--radius-lg: 12px;
--radius-xl: 16px;
--radius-pill: 999px;
```

Radius roles:

| Radius | Use |
|---|---|
| 2px | tiny evidence markers, chart bar caps, progress segments |
| 4px | small thumbnails, compact icon containers, table row hover background |
| 8px | cards, buttons, inputs, list groups, mobile cards |
| 12px | popovers, dropdowns, date pickers, elevated menus |
| 16px | modals, command palette, bottom sheets, large empty states |
| 999px | badges, chips, avatar circles, segmented-control thumb only |

Avoid:

* giant pill buttons
* extreme roundness
* playful blobs
* organic shapes that conflict with the logo geometry

## 8.2 Borders

Use borders as material edges, not decoration.

```css
--border-hairline: 1px;
--border-focus: 2px;
--border-rail: 3px;
--color-border-subtle: #E7EAF0;
--color-border: #D9DEE8;
--color-border-strong: #C8D0DE;
```

Border roles:

| Border | Width | Color | Use |
|---|---:|---|---|
| Hairline | 1px | `--color-border` | cards, inputs, tables, dividers |
| Subtle divider | 1px | `--color-border-subtle` | section separators, table row dividers |
| Strong edge | 1px | `--color-border-strong` | overlays, active containers, sticky surfaces |
| Focus ring | 2px | blue mix | keyboard focus, never elevation |
| Severity rail | 3px | status hue | risk, overdue, danger zone, urgent decision |

Rules:

* Borders are always 1px except focus rings and severity rails.
* Do not use double borders unless the inner line is the lit top edge token.
* Do not put borders on all four sides of every row in a long list. Use one
  bottom divider or grouped sheets.
* Borders should feel archival, not boxy. If the UI looks like a spreadsheet,
  reduce borders and increase hierarchy.

## 8.3 Shadows — the elevation ramp

Shadows are **navy-tinted, never pure black** (`rgba(16, 42, 67, …)`) — a black
shadow on warm paper reads as dirt; a navy one reads as depth. Depth is a
4-tier ramp, not ad-hoc values. Each tier pairs an *ambient* shadow (close,
tight, holds the object to its surface) with a *key* shadow (cast, soft, sells
the height); both scale together so a surface reads as the same physical
material at every plane. Use the token, never a raw `box-shadow`.

| Token | Plane | Use |
|-------|-------|-----|
| `--elevation-1` | resting | cards, tables, list rows |
| `--elevation-2` | raised | sticky headers, hover-lifted cards, dock pods |
| `--elevation-3` | overlay | popovers, dropdowns, tooltips, the dock panel |
| `--elevation-4` | modal | dialogs, command palette, sheets (highest plane) |

Exact shadow recipes:

```css
--elevation-1:
  0 1px 2px rgba(16, 42, 67, 0.05);

--elevation-2:
  0 8px 24px -6px rgba(16, 42, 67, 0.10),
  0 2px 6px -2px rgba(16, 42, 67, 0.06);

--elevation-3:
  0 16px 40px -8px rgba(16, 42, 67, 0.14),
  0 4px 10px -4px rgba(16, 42, 67, 0.08);

--elevation-4:
  0 28px 60px -12px rgba(16, 42, 67, 0.20),
  0 8px 18px -6px rgba(16, 42, 67, 0.10);
```

Plane rules:

* Resting cards use `--shadow-card`, not a visible floating shadow.
* Hover lift is 1px vertical movement plus `--shadow-card-hover`, never a jump.
* Sticky headers use `--shadow-raised` only after they are stuck.
* Popovers and menus use `--shadow-overlay`.
* Dialogs and bottom sheets use `--shadow-modal`.
* Shadows do not communicate severity. Color rails and badges do.

### Lit-token coverage (one lighting language, every surface)

Lighting is not just elevation — each surface pairs a navy drop with an **inner
light-edge** so it reads as *lit from above*, never a flat sticker. This is the
single quality that makes the whole UI feel built by one hand. Every interactive
surface is on it (web; mobile mirrors it via platform-idiomatic shadows):

| Surface | Token | Lit treatment |
|---------|-------|---------------|
| Badges · chips · active nav pill · active tab | `shadow-lit` | soft tint + same-hue ring + lit edge (+ saturated dot/rail) |
| Cards · tables | `shadow-card` (`-hover`) | bright top edge + two-layer navy drop |
| Sticky bars (stuck header) · dock pods | `shadow-raised` | lit edge + the elevation-2 drop (8/24) — the raised plane: lifted off the page but a tier *below* the overlay panel that opens above a pod |
| Primary button · toggle (on) | `shadow-button` + `--gradient-primary` | top-down sheen + inner highlight + tight drop |
| Inputs · textarea · toggle track | `shadow-input` | recessed inner top shade (the inverse — a well) |
| Selects · popovers · dropdowns · toasts · chart tooltip | `shadow-overlay` | lifted lit sheet (elevation-3) + hairline ring |
| Dialogs · command palette · sheets | `shadow-modal` | the highest plane (elevation-4) — a deeper navy cast so a modal floats visibly clear of mere overlays |
| Skeletons | `.lumi-shimmer` | a soft light sweeps across while loading |
| Alerts · status banners | `shadow-lit` + accent rail | soft tint + same-hue ring + 3px saturated rail |
| Charts | gradient fills | trend areas fade to a soft wash; bars get lit, rounded tops |

The colour half is equally unified: badges, toasts, alerts, the chart tooltip, and
the mobile banner all draw their status colours from the **same lit-token quads**
(§10.4) — `info / success / warning / danger`. Nothing in the product invents its
own status palette.

In components, use the **shadcn/Tailwind utilities** — never a raw `box-shadow`,
an arbitrary `shadow-[…]`, or a stock `shadow-sm/md/lg/xl/2xl` (those are the
inconsistency this ramp replaces). The guard
A token guard should reject them; verify the host’s actual check. The companion
example `node frontend/scripts/check-design-tokens.mjs` is not a command in this repository.

```html
<div class="shadow-elevation-1">  <!-- resting card -->
<div class="shadow-elevation-3">  <!-- floating popover / dropdown -->
```

```css
/* raw CSS (rare) reads the token directly */
box-shadow: var(--elevation-1);
```

Focus rings are a separate affordance (accessibility, not depth): use
`shadow-ring` / `shadow-ring-destructive`, not an elevation tier (§16.5).

Still forbidden: unscoped glassmorphism blur stacks (translucent material exists only through
the §8.0 liquid-glass recipes), generic floating-SaaS card shadows,
thick offset neo-brutalist shadows, and **coloured glows** (the navy tint is the
only colour a Lumi shadow ever carries).

---

# 9. Iconography

## 9.1 Icon Principle

Icons should feel like they belong to the logo.

Use:

* Simple line icons
* Geometric construction
* 1.75px or 2px stroke
* Square or angled details
* Occasional four-point star motif

Avoid:

* Cartoon icons
* 3D icons
* AI sparkle overload
* Gradient icons
* Emoji-like icons
* Random icon packs with inconsistent stroke

## 9.2 Core Icon Motifs

Supporting system motifs:

### Star mark

Meaning:

* verified
* clarified
* important insight
* Lumi found this

Use sparingly.

### L-corner

Meaning:

* structure
* framework
* workspace
* task/project container

### Annotation dot

Meaning:

* evidence
* source
* comment
* detail

### Line bracket

Meaning:

* grouping
* section
* report category

## 9.3 Icon Examples

* Daily Pulse: circle + small star
* CEO Brief: document + star
* Commitment: check line + deadline dot
* Risk: amber marker + bracket
* Decision: forked path + star
* Project: L-frame + stacked cards
* Recurring: loop arrow + small dot
* Evidence: document + annotation dot
* Chat: speech bubble + L-corner

---

# 10. UI Components

## 10.1 Buttons

### Primary Button — a lit, pressable object

Use for the single main action. The fill is lumi-blue, but **lit from above**:
a near-invisible top-down sheen (`--gradient-primary`: a lighter crown → brand →
pressed-tone floor) + `--shadow-button` (an inner top highlight + a tight navy
drop). The result is a tactile object you want to press, not a flat rectangle.

```css
background-color: var(--color-lumi-blue);
background-image: var(--gradient-primary);   /* approved button lighting */
box-shadow: var(--shadow-button);            /* inner highlight + navy drop */
color: white;
border: 1px solid color-mix(in oklch, var(--color-lumi-blue-active) 35%, transparent);
border-radius: var(--radius-control);
height: 40px;
min-width: 96px;
padding: 0 16px;
font-weight: 550;
font-size: 14px;
letter-spacing: 0;
```

- **Hover:** drop the sheen, deepen to `--color-lumi-blue-hover` (solid).
- **Active:** settle to `--color-lumi-blue-active`, remove the drop, nudge down 1px
  — the press feels physical.
- **Focus-visible:** 2px blue focus ring, 2px offset, never hidden by the shadow.
- **Disabled:** no gradient, no shadow, `opacity: 0.55`, cursor default.

> This sheen and the existing canvas top light (`--canvas-glow`) are approved
> material lighting, alongside the supplied app-icon treatment. These narrow
> exceptions do not permit decorative gradients, AI glow, or new color treatments.

Button size contract:

| Size | Height | Padding | Font | Use |
|---|---:|---:|---:|---|
| `sm` | 32px | 12px | 13px / 550 | table rows, dense toolbars |
| `md` | 40px | 16px | 14px / 550 | default product actions |
| `lg` | 48px | 20px | 15px / 600 | hero, mobile primary actions |
| `icon-sm` | 32px square | 0 | icon 16px | dense toolbars |
| `icon-md` | 40px square | 0 | icon 18px | default icon actions |

Button hierarchy:

* One filled primary button per action cluster.
* Secondary buttons can sit beside the primary, but never compete in fill.
* Tertiary buttons are inline actions, not page-level CTAs.
* Destructive actions never share the same visual weight as the safe primary
  action unless the entire dialog is a destructive confirmation.

### Secondary Button

```css
background: transparent;
color: var(--color-civic-navy);
border: 1px solid var(--color-border);
border-radius: var(--radius-control);
height: 40px;
padding: 0 16px;
box-shadow: var(--shadow-lit);
```

### Tertiary Button

Text-only.

```css
color: var(--color-lumi-blue);
font-weight: 550;
height: 32px;
padding: 0 4px;
```

### Destructive Button

Use rarely.

```css
background: transparent;
color: var(--color-risk-red);
border: 1px solid var(--color-risk-red);
border-radius: var(--radius-control);
height: 40px;
padding: 0 16px;
```

---

## 10.2 Cards — lit documents

Cards are **lit documents on warm paper**, never glass or flat boxes: white surface,
1px border, and `shadow-card` lit drop (bright top edge plus close and soft navy-tinted
shadows). Never black paper shadows: they read as dirt, while navy reads as depth.

```css
background: var(--color-surface-white);
border: 1px solid var(--color-border);
border-radius: var(--radius-card);
padding: 20px;
box-shadow: var(--shadow-card);     /* lit token — see §19 */
```

Clickable rows and board cards lift 1px with `shadow-card-hover`; all others rest.

Card density contract:

| Card type | Padding | Radius | Border | Shadow | Use |
|---|---:|---:|---|---|---|
| Compact row card | 12-16px | 8px | 1px | `--shadow-card` | mobile list rows, task rows |
| Standard card | 20px | 8px | 1px | `--shadow-card` | brief item, risk, decision |
| Reading card | 24px | 8px | 1px | `--shadow-card` | CEO summary, evidence detail |
| Empty-state card | 24-32px | 16px | 1px | `--shadow-card` | all-clear, no data yet |
| Overlay card | 16-20px | 12px | 1px strong | `--shadow-overlay` | popover content |

Card anatomy:

```text
top row:    status / section label          owner or timestamp
title:      strong claim or record name
body:       why it matters, one short paragraph
metadata:   evidence, source, due date, confidence
action:     one contextual action, placed after the claim
```

Spacing inside a standard card:

```css
gap-title-body: 8px;
gap-body-meta: 12px;
gap-meta-action: 16px;
```

Clickable card state:

```css
transition: transform var(--motion-fast) var(--ease-out),
            box-shadow var(--motion-fast) var(--ease-out),
            border-color var(--motion-fast) var(--ease-out);
hover: transform translateY(-1px);
hover: box-shadow var(--shadow-card-hover);
active: transform translateY(0);
```

Use cards for brief, task, risk, decision, project, and pulse summaries. Avoid nested cards,
glass/blurred translucency, colored or heavy gradients (only the near-invisible primary-button
sheen in §10.1; canvas light stays on the canvas), untinted black shadows, and over-coloring.

---

## 10.3 Inputs

Inputs should be calm and highly readable.

```css
height: 40px;
border: 1px solid var(--color-border);
border-radius: var(--radius-control);
background: white;
padding: 0 12px;
font-size: max(1rem, 16px);
line-height: 1.4;
box-shadow: var(--shadow-input);
```

Focus:

```css
border-color: var(--color-lumi-blue);
box-shadow:
  var(--shadow-input),
  0 0 0 3px color-mix(in oklch, var(--color-lumi-blue) 14%, transparent);
```

Textarea for daily pulse:

```css
min-height: 140px;
line-height: 1.6;
padding: 12px;
```

Input state contract:

| State | Border | Shadow | Text |
|---|---|---|---|
| Rest | `--color-border` | `--shadow-input` | `--color-ink` |
| Hover | `--color-border-strong` | `--shadow-input` | unchanged |
| Focus | `--color-lumi-blue` + blue halo | input + focus ring | unchanged |
| Error | `--color-risk-red` + red halo | input + destructive ring | error text below |
| Disabled | `--color-border-subtle` | none | `--color-soft-slate` |

Placeholder text must meet contrast expectations for helper text. Never use
placeholder text as the label.

---

## 10.4 Badges — the "lit token" system

> **The anti-slop rule.** Never use a flat pastel text pill. Lumi badges are layered,
> scannable *lit tokens*, not one flat fill.

**Anatomy.** Every status badge is a **quad**, not one color:

| Layer | Role | Token |
|-------|------|-------|
| **surface** | the chip body — a soft, desaturated tint | `--badge-{status}-surface` |
| **ring** | a 1px *inset* hairline in the **same hue at low alpha** — identity, not a generic grey border | `--badge-{status}-ring` (`color-mix`, tracks the brand hue automatically) |
| **dot** | a 5px **saturated** disc the eye locks onto first — instant scannability | `--badge-{status}-dot` |
| **text** | AA-compliant strong ink of the hue | `--badge-{status}-text` |
| **lit edge** | a 1px inner top highlight so the chip reads *lit from above*, not flat | `shadow-lit` |

Five families (`neutral · info · success · warning · danger`) define the quad in
`index.css`; components reference token classes, never inline values.

**Geometry.** `rounded-full`, minimum 20px height, `px-2`, `gap-1.5`, dot `5px`; text `12px / 560 /
tracking-0.01em / tabular-nums`: compact and readable. Grow with text scaling; interactive chips need the hit area in §16.3.

**States (every badge earns them).**
- **Resting:** surface + inset ring + lit edge + (status only) dot.
- **Hover** (interactive badges — filters, links, removable tags): `brightness 0.985`
  + a 1px lift (`-translate-y-px`). Calm, tactile, never a colour flash.
- **Active:** settle back down (`translate-y-0`, `brightness 0.95`).
- **Focus-visible:** 2px `--ring` halo at 2px offset — keyboard parity with buttons.

**Variant → family map** (the only allowed status variants):

| Variant | Family | Domain meaning |
|---------|--------|----------------|
| `status-open` | neutral | open / todo / draft / queued |
| `status-in-progress` | info (blue) | active / in review / medium |
| `status-done` | success (green) | done / approved / resolved / paid |
| `status-overdue` · `status-amber` | warning (amber) | overdue / high / waiting |
| `status-critical` | danger (red) | blocked / failed / rejected / critical |

Generic counts/categories/tags use dotless `outline` / `secondary` lit-neutral chips
(`bg-card`/`bg-secondary` + inset `ring-border` + `shadow-lit`) so tags never pose as status;
`default` is solid brand.

**Do / Don't.**
- ✅ One dot, one hue, per status. ✅ The ring is the status hue, never plain grey.
- ❌ No flat pastel fill with no ring or dot. ❌ No bright red unless truly critical.
- ❌ Never hand-roll a `statusColors` map on a page.

**Implementation.** `<StatusBadge status={x} />` (`@/components/page`) maps domain
status/severity/priority to a variant and automatically enables its status dot. Shadcn
`<Badge dot interactive>` carries styling; §19 `index.css` owns token quads.

## 10.5 Mobile Primitives

Mobile UI must express the same shadcn-style component contract as the web app.
The implementation language differs, but the primitives do not.

| Web primitive | Mobile KMP primitive | Native Android wrapper | Use for |
|---|---|---|---|
| `PageHeader` | `LumiPageTitle` | `LumiPageTitle` | Page title + optional description |
| `SectionHeader` | `LumiSectionHeader` | `LumiSectionHeader` | One-message section dividers |
| `Card` | `LumiCard` | `LumiCard` | Brief, task, risk, decision, pulse summaries |
| `Button` default | `LumiPrimaryButton` | `LumiButton` | One primary screen action |
| `Button` link/ghost | `LumiInlineAction` | `LumiTextButton` / `LumiInlineAction` | Inline row actions |
| `Input` / `Textarea` | `LumiMultilineField` / field primitive | `LumiFormField` | Forms and Pulse answers |
| `Badge` / `StatusBadge` | `LumiBadge` | `LumiBadge` | Status, counts, severity |
| `EmptyState` | `LumiEmptyState` | `LumiEmptyState` | Purposeful empty and all-clear states |
| Directory row | `LumiDirectoryRow` | `LumiRow` | Workspace rows and settings rows |

Mobile source of truth:

* Shared cross-platform screens and reusable business UI live in
  `android/shared/src/commonMain/kotlin/com/locuno/lumi/shared/ui/`.
* Android-only adapters live in `android/core/designsystem/`, but must mirror the
  same names, token values, shapes, and states.
* iOS must consume the shared KMP screens when available through
  `ios/Lumi/KMP/SharedScreenBridge.swift`; SwiftUI-only fallbacks are temporary
  adapters, not a second product design system.

Mobile token mapping:

```text
LumiBlue        #006093   primary buttons, active nav, key actions
CivicNavy      #102A43   headings and primary text
PaperWhite     #F4F0E8   app background
SurfaceWhite   #FFFFFF   cards, sheets, inputs
Border         #D9DEE8   borders and dividers
SoftSlate      #5E6677   metadata and helper text
SignalAmber    #F4A62A   warnings only
RiskRed        #C2410C   destructive/error only
SuccessGreen   #1F7A4D   resolved/all-clear states
```

Mobile deviations from web must be functional, not aesthetic: 48dp/44pt touch
targets, bottom navigation, native text scaling, store billing, and platform back
behavior. Color, typography hierarchy, card borders, badge tones, and empty/error
states must remain visibly Lumi.

Use badges for status and risk — always the **lit-token quad** of §10.4 (surface +
same-hue inset ring + saturated dot + AA text + lit edge), never a flat fill. The
canonical quads (web `index.css §19`, iOS `LumiBadge`, Android `LumiBadge`):

| Family | surface | dot / ring hue | text |
|--------|---------|----------------|------|
| neutral (open) | `#F2F4F7` | slate | `#344054` |
| info (in progress) | `lumi-blue-soft` | `lumi-blue` | `lumi-blue` |
| success (done) | `green-soft` | `success-green` | `success-green` |
| warning (overdue) | `amber-soft` | `signal-amber` | `#9A5B00` (AA) |
| danger (critical) | `red-soft` | `risk-red` | `risk-red` |

Do not use bright red unless critical. The dot is the saturated hue; the ring is
the same hue at low alpha (`color-mix`), never plain grey.

**Implementation:** never hand-roll a `statusColors` map on a page. Use the shared
`StatusBadge` primitive (`@/components/page`), which maps any domain status / severity
/ priority to the variant **and** enables the dot for status families — one source of
truth. `<StatusBadge status={x} />`, or pass `label` / `variant` to override.

### Mobile excellence rules

Mobile is a first-class executive surface, not a companion view.

Rules:

* **One-handed operation:** reach primary actions on common phones; use bottom bars/sheets when central.
* **Native touch targets:** ≥44pt iOS, ≥48dp Android unless the primitive is larger.
* **Cards over squeezed tables:** tables that cannot retain title, owner, status, due/age, and action become cards.
* **Evidence stays visible:** source/confidence need a compact row or disclosure, never an unlabeled tiny icon.
* **Design network states:** loading, retry, stale, offline, and denied must match the happy path.
* **Honor keyboard/safe areas:** submit stays uncovered and active fields visible.
* **Resist locale pressure:** Vietnamese fits navigation, cards, buttons, and empties without shrinking type.

Mobile polish test:

> Can a CEO read a brief in a car, approve a decision, and trust its source without
> pinching, hunting, or wondering whether the app is loading?

If not, redesign mobile before adding features.

---

## 10.6 Tables

Tables should be functional, not spreadsheet-like.

Use for:

* Tasks
* Commitments
* Risks
* Decisions
* Projects

Rules:

* Row height minimum 52px
* Strong title column
* Subtle metadata
* Sticky header if table is long
* Use badges for status
* Avoid excessive grid lines

Table border:

```css
border-bottom: 1px solid var(--color-border);
```

Header:

```css
font-size: 12px;
font-weight: 650;
text-transform: uppercase;
letter-spacing: 0.06em;
color: var(--color-soft-slate);
```

---

## 10.7 Page Primitives

Every surface reuses its host’s shared editorial primitives (companion example:
`frontend/src/components/page/`). Preserve semantic heading structure; a plain HTML
implementation does not need React or a component library to express the contract.

### PageHeader

Canonical title block: optional uppercase **eyebrow**, 28px/650/civic-navy **title**
(§6.3), optional one-line **lede**, and right-aligned **actions**.

```text
TODAY'S OPERATING BRIEF · 12 Jun        ← eyebrow (optional)
Good morning                            ← title                 [ Generate ]  ← actions
Lumi has reviewed yesterday's updates…  ← lede (optional, ~1 sentence)
```

**Toolbar exception.** Board/Timeline/Workflow/Tasks pair title, back button, and view
switcher, so use exported **`PAGE_TITLE_CLASS`** rather than full `<PageHeader>`. It is the
same 28px/650/civic-navy single source of truth; never hand-tune an inline `<h1>`.

### SectionHeader

Long-page divider: uppercase **label**, optional **count** chip, and edge-running hairline;
it enforces one message per section (§7.4).

```text
NEEDS YOUR DECISION  ③ ─────────────────────────────────────
```

### EmptyState

Authored empty state, never blank: icon, title, one-line population explanation, optional action.
`tone="success"` is the reassuring green-soft/success-green Risks/Brief all-clear variant.

> The CEO Brief page is the reference implementation of all three.

## 10.8 Severity rails — colour as triage

List and digest items use a **3px inline-start status-hue rail** for pre-reading triage. Only
attention levels get one; calm items stay rail-less, applying the §8.3 vocabulary to rows.

| Level | Rail | Used for |
|-------|------|----------|
| Danger | `border-inline-start: var(--border-rail) solid var(--color-risk-red)` | critical risk, failed action, destructive confirmation |
| Attention | `border-inline-start: var(--border-rail) solid var(--color-signal-amber)` | overdue, waiting, high priority, review needed |
| Calm | *(no rail)* | everything routine |

Pair rails with **ranking** (§4.3): railed items lead so a digest reads in priority order.
Today is the ranked-and-railed reference; Risks, Decisions, and Settings danger use the same
lit-token quad hues (§10.4), never per-surface severity colors.

---

# 11. Product Surfaces

Every Lumi surface must know which operating job it serves:

| Surface job | Design answer |
|---|---|
| See clearly | summary first, ranked items, evidence nearby |
| Decide fast | one primary action, options visible, owner and deadline clear |
| Trust the signal | source, timestamp, confidence, and provenance close to the claim |
| Capture signal | short form, visible labels, calm save state |
| Chase and verify | status, owner, next action, and follow-up age visible |

Design from the operating question inward, then reveal the data needed to answer it.
Sections 11.1–11.10 are companion examples, not a screen backlog for Lumi Agents.

For Lumi Agents, apply the same compositions to the existing runtime contracts:

| User job | Required visible context |
|---|---|
| Delegate | goal, desired output, active Project/environment, scope and constraints |
| Supervise | observed phase, milestones, affected system, budget, next meaningful event |
| Approve | exact business effect, account/target/destination, material value, expiry, safe rejection |
| Recover | what happened, known vs unknown effects, preserved work, owner, safe next choice |
| Review result | artifact/change set, evidence, validation status, unresolved items, next action |

Keep planned, attempted, executed, and verified distinct. A source-backed claim is
not automatically verified; human approval is not execution; execution is not
verification. Draft, saved, published, and sent are separate states. Use existing
neutral/info/warning/danger/success families with explicit labels. Only mark the
requested job complete when its required verification passes.

## Shared state contract

| State | What the user needs |
|---|---|
| First use / empty | what belongs here and one real setup action; never fake records |
| Loading | stable space and the observed activity; no fabricated progress percentage |
| Waiting for approval | action summary and approve/reject; no silent timeout approval |
| Partial / stale / offline | visible limit or timestamp, preserved result/input, safe continuation |
| Failed / denied | specific cause and remedy; retry only when policy and effect state permit |
| Ambiguous effect | explain that the action may have happened; verify before offering replay |
| Cancelled | distinguish stopped work from already completed or in-flight effects |
| Verified result | inspectable evidence, useful output, and any remaining exceptions |

Implement these through existing primitives, not a new status framework. Preserve
focus, selection, scroll, and unsaved input across refresh and recovery. Notifications
are for meaningful completion, approval, exception, failure, or budget changes.

## 11.1 CEO Brief Page

This most important surface is a morning briefing document, calm executive memo, and
prioritized decision surface — never a dashboard.

Page structure:

```text
Header:
  Good morning / Brief date / Generate brief button

Executive Summary:
  2–4 sentence summary

Sections:
  1. Needs CEO Decision
  2. Customer / Revenue Risk
  3. Cash / Receivables
  4. Overdue Commitments
  5. Team Blockers
  6. Follow-up Opportunities
  7. Suggested Questions
```

Each brief item shows title, why it matters, suggested CEO action, owner, due date,
source/evidence, and confidence when low.

### Brief item layout

```text
┌──────────────────────────────────────────────┐
│ Decision needed                              │
│ Approve 5% discount for ABC before 11:00     │
│                                              │
│ Why it matters: 120M VND deal may stall.     │
│ Suggested action: approve or hold price.     │
│                                              │
│ Owner: Lan · Source: Sales pulse · 08/06     │
└──────────────────────────────────────────────┘
```

Use the four-point star only for Lumi-generated insight, not every item.

---

## 11.2 Daily Pulse Page

This page must be extremely simple: one question per block, completed in 60–90 seconds.
Avoid many required fields, dense forms, project-management jargon, long instructions, and excess dropdowns.

Default questions:

```text
1. Hôm nay bạn hoàn thành việc gì quan trọng?
2. Bạn đang kẹt ở đâu?
3. Bạn đã hứa gì với khách / team / nhà cung cấp?
4. Việc nào cần CEO hoặc quản lý quyết?
5. Có rủi ro nào về khách, doanh thu, công nợ, đơn hàng hoặc deadline không?
6. Ngày mai việc quan trọng nhất của bạn là gì?
```

Visual style: large textarea, minimal labels, warm paper, clear submit, and “Mất khoảng 60 giây.”

---

## 11.3 Tasks Page

Tasks must work without making Lumi a task-manager clone. Show title, owner, due date,
priority, status, project, and business impact when present; add customer, money, source type,
and linked commitment/risk.

---

## 11.4 Projects Page

Project UI is clean and operational: project, owner, team, status, due date, open/overdue tasks,
and linked risks. No complex Gantt or chart features in MVP.

---

## 11.5 Recurring Tasks Page

Recurring tasks are operating routines. Use routine/cadence, Every Monday, Daily, Monthly, and
Next run; never expose technical RRULE language.

Example:

```text
Check receivables
Every Monday · Finance · Next run: 10/06
```

---

## 11.6 Commitments Page

Commitments are stronger than tasks. Show promise, owner, stakeholder/customer, due date/time,
business impact, risk, evidence, and status. Use “Who promised what?”, “What is overdue?”, and
“Which promises affect customers or money?”

---

## 11.7 Risks Page

Risks are sober, not scary. Show title, severity, likelihood, owner, related customer/project/task,
money when available, evidence, and suggested action. Use amber unless critical, never red-heavy UI.

---

## 11.8 Decisions Page

Decision requests are an executive queue: decision, requester, needed-by date, options,
recommendation when available, business impact, evidence, and status. Answer: “What is waiting on leadership?”

---

## 11.9 Chat with Lumi

Chat is an operating query layer, not a ChatGPT clone.

Examples:

```text
Hôm nay việc nào cần tôi quyết?
Ai đang bị kẹt nhiều nhất?
Khách nào có rủi ro?
Task nào quá hạn?
Tóm tắt project ABC.
```

Chat answers are short, source-linked, action-oriented, clear about missing data, and
never speculative without saying so.

## 11.10 AI Insight States

AI-generated items look accountable, never magical.

Every AI insight, risk, commitment, and decision request has a visible state:

| State | Visual treatment | Copy behavior |
|---|---|---|
| Source-backed | normal card, evidence chip, timestamp | confident, concrete |
| Low confidence | neutral or amber soft badge, confirm action | cautious, asks for review |
| Missing evidence | empty/evidence-needed state, no strong claim | explains what data is missing |
| Conflicting evidence | comparison layout or warning rail | names the conflict plainly |
| Stale evidence | age visible, refresh or request update | avoids current-tense claims |
| Confirmed by human | success badge or resolved state | records owner and time |

Never make AI look more certain than its evidence; an honest, useful low-confidence state
is more premium than a polished hallucination.

---

# 12. Data Visualization

Use charts sparingly; Lumi is not a dashboard.

Companion chart examples (choose only when they answer the current user’s question):

* Small weekly pulse completion trend
* Overdue tasks by team
* Risks by type
* Decisions waiting by age
* Commitments resolved vs overdue

Style:

* Minimal axes
* No rainbow palettes
* No 3D charts
* No decorative gradients
* Use Lumi Blue, Civic Navy, Archive Gray, Signal Amber

Default chart colors:

```css
--chart-primary: #006093;
--chart-secondary: #102A43;
--chart-muted: #CBD3DF;
--chart-warning: #F4A62A;
--chart-risk: #C2410C;
--chart-success: #1F7A4D;
```

---

Chart integrity: show units, time window, timezone where material, denominator,
source, and missing/stale data. Unknown is not zero. Label series directly or use
patterns as well as color; provide a text/table equivalent. Do not imply causation,
precision, or improvement the data cannot establish.

# 13. Illustration and Imagery

## 13.1 Illustration Style

Use:

* Documents
* Briefing sheets
* Operating ledgers
* Checklists
* Evidence markers
* Thin annotation circles
* Structured work surfaces
* Simple geometric diagrams
* Paper textures
* Editorial layouts

Avoid:

* Robots
* Neural networks
* Holograms
* AI glow
* 3D mascots
* Floating dashboards
* Generic people illustrations
* Hyper-polished startup illustration packs

## 13.2 Photography

If using photography:

Use:

* Real work environments
* Natural light
* Editorial composition
* Real notebooks, papers, laptops
* Human hands reviewing documents
* CEO/founder desk scenes

Avoid:

* Stock call-center teams
* Overly smiling office people
* Fake diversity collage
* Futuristic blue-light rooms
* Corporate handshake photos

---

# 14. Motion Design

Motion should be calm and functional.

Use motion for:

* Loading brief generation
* Showing AI extraction progress
* Expanding evidence
* Revealing brief sections
* Completing tasks

Motion duration:

```css
--motion-fast: 120ms;
--motion-normal: 180ms;
--motion-slow: 260ms;
```

Easing:

```css
cubic-bezier(0.2, 0.8, 0.2, 1)
```

Avoid:

* Bouncy motion
* Sparkle animation
* AI typing theatrics
* Excessive loading animations
* Looping decorative motion

## 14.1 Layout stability

Reserve space for fonts, async content, and validation messages. Apply
`scrollbar-gutter: stable` to the actual scrolling container when needed; the Tauri
shell may scroll a pane rather than `html`. Verify route changes and long lists;
this technique alone does not prove zero layout shift.

Honor `prefers-reduced-motion` and native reduced-motion settings: remove decorative
translation, scaling, shimmer, and smooth scrolling while preserving immediate
state feedback. Animate opacity/transform where useful; do not make task completion
depend on an animation. A static progress label must remain meaningful.

Use the existing 120/180/260ms timings. Never animate every row of a long queue,
steal focus for progress updates, or continuously announce logs to a screen reader.

When the runtime actually observes these phases, example copy is:

When Lumi generates a brief, use language:

```text
Lumi is reviewing yesterday’s updates...
Finding commitments...
Checking overdue items...
Preparing the CEO brief...
```

No magical animation needed.

---

# 15. Voice and Copy

## 15.1 Brand Voice

Lumi speaks like:

* A precise operating assistant
* A calm chief of staff
* A trustworthy analyst
* A clear editor

Lumi does not speak like:

* A motivational coach
* A hype AI tool
* A playful chatbot
* A corporate consultant using jargon

## 15.2 Copy Rules

Use:

* Short sentences
* Specific nouns
* Action verbs
* Clear ownership
* Evidence-based claims

Avoid:

* “Unlock productivity”
* “Supercharge your team”
* “10x your workflow”
* “AI-powered magic”
* “Revolutionize operations”
* “Seamlessly leverage synergy”

## 15.3 Preferred Language

Good:

```text
3 decisions are waiting for CEO review.
5 commitments are overdue.
ABC has not responded to a 120M VND quote for 6 days.
Finance needs to confirm the payment date today.
```

Bad:

```text
Your team has several exciting opportunities to improve operational excellence.
```

## 15.4 Vietnamese Copy Tone

Use:

```text
rõ
ngắn
thẳng
không quá Tây
không quá corporate
không dùng jargon AI
```

Example:

```text
Hôm nay có 3 việc cần CEO quyết.
```

Not:

```text
Lumi đã tối ưu hóa năng suất bằng trí tuệ nhân tạo để nâng cao hiệu quả vận hành.
```

---

# 16. Accessibility

Lumi must feel premium because it is usable.

## 16.1 Contrast

* Body text must meet WCAG AA
* Primary blue on white must pass
* Avoid pale gray text
* Do not use color alone to communicate risk

Require measured evidence, not a blanket compliance claim. Normal text needs at
least 4.5:1 and qualifying large text at least 3:1. Essential control/state indicators
need 3:1 against adjacent colors where applicable. Test actual composed colors,
including alpha, gradients, hover, selected, and focus states. Pale borders, shadows,
or a focus-only ring do not automatically identify a resting input accessibly.

Keep the palette intact: use an existing stronger ink/blue token for required
boundaries and text. Signal Amber remains the warning accent, not small text on
white; use the existing warning text treatment from §10.5. Color never replaces a
label, icon meaning, or error message. Do not cite a companion test path as passing
CI here; attach the actual contrast results and test scope to the implementation PR.

Reference: [WCAG 2.2](https://www.w3.org/TR/WCAG22/) and
[non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).

## 16.2 Font Size

Use 16px minimum body/input text and 12px minimum metadata at default scale.
The compact §19 token ramp remains unchanged; clamp its use upward for these roles.
Never shrink trust-bearing copy, clip Vietnamese diacritics, or disable platform
text scaling to preserve a layout. Let controls grow beyond their nominal heights.

Test 200% text resizing and 320 CSS-pixel equivalent reflow; contain genuinely
two-dimensional tables/code in their own labelled region. Keep approvals and error
recovery usable with long names, large text, and the keyboard open.
See [WCAG reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).

## 16.3 Click Targets

Default desktop controls retain their 40px visual size; compact 32px variants are
for pointer-dense tools. Target size concerns the full hit area, not just the glyph.
Prefer 44px web touch areas, 44pt on iOS, and 48dp on Android. Compact controls need
adequate non-overlapping hit areas and spacing; never compress a mobile approval
or destructive action to fit more controls.

These are Lumi usability targets. WCAG 2.2 AA has a 24×24 CSS-pixel minimum with
specified exceptions; do not mislabel the brand preference as that standard.
See [target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

## 16.4 Keyboard Navigation

All app controls must be reachable by keyboard:

* buttons
* links
* form fields
* modals
* dropdowns
* chat input

Use semantic buttons/links and programmatic labels. Associate hints/errors with
inputs; give icon actions accessible names and meaningful tables headers. Dialogs
need a name, deliberate initial focus, contained tab order, and return focus to
the trigger on close. Escape closes a dismissible layer, never silently approves
or cancels a consequential operation. Keep focus visible beneath sticky bars and
announce important status changes without streaming every intermediate update.

## 16.5 Focus States

Focus states must be visible — and the brand blue is sourced from the token layer
(`--color-lumi-blue`), never a hardcoded literal, so the focus ring and the text-selection
highlight track one colour:

```css
:focus-visible {
  outline: 2px solid var(--color-lumi-blue);
  outline-offset: 2px;
}
```

**Touch feedback.** On touch devices the browser's default tap highlight is an opaque
grey box that reads as unfinished. Replace it with a faint branded tint rather than
removing it outright — feedback stays, but in the product's blue:

```css
body {
  -webkit-tap-highlight-color: color-mix(in oklch, var(--color-lumi-blue) 12%, transparent);
}
```

`:active` / `:focus-visible` still carry the considered states on top. Test forced-colors
and high-contrast modes; allow system colors when needed. This accessibility behavior
is not a new Lumi theme. Never suppress the browser focus indicator without a tested replacement.

---

# 17. Landing Page Direction

## 17.1 Landing Page Strategy

Avoid a typical AI-startup landing page.

Avoid:

* Big 3D orb
* Gradient AI brain
* Floating cards everywhere
* Cartoon team workflow
* Fake dashboard overload

Use:

* Strong typography
* Warm paper background
* Product screenshots
* Short CEO-focused copy
* Evidence-based sections
* Calm structure

## 17.2 Hero

Hero copy:

```text
Run the company with a clearer morning brief.

Team updates, tasks, projects, and recurring work —
turned into a daily operating brief for the CEO.
```

Vietnamese version:

```text
Mỗi sáng, CEO nắm rõ công ty đang kẹt ở đâu.

Team cập nhật việc hằng ngày.
Lumi tổng hợp thành brief điều hành:
việc trễ, khách rủi ro, tiền kẹt,
và quyết định đang chờ.
```

CTA:

```text
Start a 14-day pilot
See example brief
```

## 17.3 Landing Page Structure

```text
1. Hero
2. Example Morning Brief
3. How Lumi Works
4. What Lumi Tracks
5. Who It Is For
6. Pilot Offer
7. FAQ
8. Final CTA
```

## 17.4 Example Section

Show a real-looking brief instead of abstract illustration.

```text
Today’s Lumi Brief

3 decisions need CEO review.
5 commitments are overdue.
2 customer risks need follow-up.
1 payment date needs confirmation.
```

This is more convincing than any AI illustration.

---

# 18. App Layout

The navigation and home routes below describe the companion SME workspace. Lumi
Agents follows its existing Project/Task surfaces and Spec 23; reuse the calm shell
and hierarchy without importing this menu wholesale. Navigation exposes supported
jobs only, preserves active context, and does not silently retarget a running task.

## 18.1 Default App Layout

```text
┌──────────────────────────────────────────┐
│ Sidebar  │ Top bar                       │
│          ├───────────────────────────────┤
│          │ Page content                  │
│          │                               │
└──────────────────────────────────────────┘
```

Sidebar should be calm and structured.

Navigation groups:

```text
Work
- Today
- Projects
- Tasks
- Recurring

Lumi
- Daily Pulse
- CEO Brief
- Commitments
- Risks
- Decisions
- Chat

Admin
- Teams
- Settings
```

## 18.2 CEO Home

Default CEO route:

```text
/brief
```

CEO should not land on task lists first.

## 18.3 Member Home

Default member route:

```text
/today
```

Member should see:

* Today’s tasks
* Daily pulse reminder
* Assigned commitments
* Overdue items

---

# 19. Design Tokens

Use this base token file.

```css
:root {
  /* Brand — anchored to the OKLCH blue ramp (§5.3) */
  --color-lumi-blue: #006093;          /* blue-600 */
  --color-lumi-blue-hover: #004F80;    /* blue-700 */
  --color-lumi-blue-active: #003E6A;   /* blue-800 */
  --color-lumi-blue-soft: #E4F3FC;

  /* Text */
  --color-civic-navy: #102A43;
  --color-ink: #172033;
  --color-soft-slate: #5E6677;         /* AA ≥4.5:1 on paper */

  /* Surfaces */
  --color-paper-white: #F4F0E8;
  --color-surface-white: #FFFFFF;
  --color-archive-gray: #E7EAF0;
  --color-border-subtle: #E7EAF0;
  --color-border: #D9DEE8;
  --color-border-strong: #C8D0DE;

  /* States */
  --color-signal-amber: #F4A62A;
  --color-amber-soft: #FFF4DC;
  --color-risk-red: #C2410C;
  --color-red-soft: #FFF1EC;
  --color-success-green: #1F7A4D;
  --color-green-soft: #E9F7EF;

  /* Dark-ground status tints (§5.5). Web/print sales surfaces only — these are
     deliberately OUTSIDE the §19.1 platform-parity contract: no native shell has
     a navy panel, so mirroring them would add dead tokens to every platform. */
  --color-amber-on-navy: #F4A62A;
  --color-red-on-navy: #FF9E7A;
  --color-green-on-navy: #6FD39F;

  /* Typography — Geist (one brand family, display = weight/tracking; §6.1).
     Noto families are a named glyph fallback (OS-provided), never self-hosted. */
  --font-sans: Geist, "Noto Sans", "Noto Sans Thai", "Noto Sans Arabic", "Noto Sans Devanagari", "Noto Sans JP", "Noto Sans KR", "Noto Sans SC", "Noto Sans TC", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-display: var(--font-sans);
  --font-mono: "Geist Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;

  /* Fluid type scale — clamp(min, preferred, max); ~1.2 minor third (§6.2) */
  --text-xs: clamp(0.75rem, 0.73rem + 0.10vw, 0.8125rem);
  --text-sm: clamp(0.8125rem, 0.79rem + 0.12vw, 0.875rem);
  --text-base: clamp(0.9375rem, 0.91rem + 0.16vw, 1rem);
  --text-lg: clamp(1.0625rem, 1.01rem + 0.28vw, 1.1875rem);
  --text-xl: clamp(1.25rem, 1.16rem + 0.45vw, 1.5rem);
  --text-2xl: clamp(1.5rem, 1.34rem + 0.80vw, 2rem);
  --text-3xl: clamp(1.875rem, 1.60rem + 1.35vw, 2.75rem);
  --text-display: clamp(2.5rem, 1.90rem + 3.00vw, 4.5rem);

  /* Letter-spacing — tighten as type grows */
  --tracking-tight: -0.02em;
  --tracking-snug: -0.01em;
  --tracking-normal: 0em;
  --tracking-wide: 0.08em;

  /* Radius */
  --radius-xs: 2px;
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-card: 8px;
  --radius-control: 8px;
  --radius-popover: 12px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-pill: 999px;

  /* Borders */
  --border-hairline: 1px;
  --border-focus: 2px;
  --border-rail: 3px;

  /* Spacing */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;
  --space-20: 80px;

  /* Elevation — navy-tinted 4-tier ramp (§8.3) */
  --elevation-1: 0 1px 2px rgba(16, 42, 67, 0.05);
  --elevation-2: 0 8px 24px -6px rgba(16, 42, 67, 0.10), 0 2px 6px -2px rgba(16, 42, 67, 0.06);
  --elevation-3: 0 16px 40px -8px rgba(16, 42, 67, 0.14), 0 4px 10px -4px rgba(16, 42, 67, 0.08);
  --elevation-4: 0 28px 60px -12px rgba(16, 42, 67, 0.20), 0 8px 18px -6px rgba(16, 42, 67, 0.10);

  /* Lit tokens — lighting, not just elevation (§8.3 / §10.1 / §10.2). Each pairs
     an inner top highlight (lit from above) with a navy drop:
       shadow-lit     — badges, chips, active nav pills, active tabs
       shadow-card    — cards (+ shadow-card-hover for interactive cards)
       shadow-raised  — sticky bars and hovered raised sheets
       shadow-button  — the primary CTA
       shadow-input   — the recessed inverse, for form fields
       shadow-overlay — floating panels (selects, popovers, dropdowns, the dock)
       shadow-modal   — dialogs, command palette, sheets */
  --shadow-lit: inset 0 1px 0 0 color-mix(in oklch, white 70%, transparent), inset 0 -1px 1px 0 color-mix(in oklch, var(--color-civic-navy) 5%, transparent);
  --shadow-card: inset 0 1px 0 0 color-mix(in oklch, white 60%, transparent), 0 1px 2px -1px color-mix(in oklch, var(--color-civic-navy) 8%, transparent), 0 8px 20px -10px color-mix(in oklch, var(--color-civic-navy) 10%, transparent);
  --shadow-card-hover: inset 0 1px 0 0 color-mix(in oklch, white 68%, transparent), 0 2px 6px -2px color-mix(in oklch, var(--color-civic-navy) 10%, transparent), 0 12px 28px -14px color-mix(in oklch, var(--color-civic-navy) 14%, transparent);
  --shadow-raised: inset 0 1px 0 0 color-mix(in oklch, white 72%, transparent), 0 8px 24px -6px color-mix(in oklch, var(--color-civic-navy) 10%, transparent), 0 2px 6px -2px color-mix(in oklch, var(--color-civic-navy) 6%, transparent);
  --shadow-button: inset 0 1px 0 0 color-mix(in oklch, white 22%, transparent), 0 1px 2px 0 color-mix(in oklch, var(--color-civic-navy) 22%, transparent);
  --shadow-input: inset 0 1px 1px 0 color-mix(in oklch, var(--color-civic-navy) 4%, transparent);
  --shadow-overlay: inset 0 1px 0 0 color-mix(in oklch, white 75%, transparent), 0 16px 40px -8px color-mix(in oklch, var(--color-civic-navy) 14%, transparent), 0 4px 10px -4px color-mix(in oklch, var(--color-civic-navy) 8%, transparent);
  --shadow-modal: inset 0 1px 0 0 color-mix(in oklch, white 80%, transparent), 0 28px 60px -12px color-mix(in oklch, var(--color-civic-navy) 20%, transparent), 0 8px 18px -6px color-mix(in oklch, var(--color-civic-navy) 10%, transparent);

  /* Approved control lighting — the primary-button sheen (§10.1) */
  --gradient-primary: linear-gradient(180deg, color-mix(in oklch, white 10%, var(--color-lumi-blue)) 0%, var(--color-lumi-blue) 52%, var(--color-lumi-blue-hover) 100%);

  /* Canvas atmosphere — a fixed, very soft top-down light under the paper grain so
     the background reads as a lit surface in a calm room, never a dead sheet (§1.2). */
  --canvas-glow: radial-gradient(115% 50% at 50% -6%, color-mix(in oklch, white 60%, transparent) 0%, transparent 58%);

  /* Liquid glass — translucent floating-chrome materials (§8.0). Derived from the
     existing surface/border tokens; adds no palette. Web/desktop-webview materials,
     deliberately OUTSIDE the §19.1 palette-parity table (see its scope note). */
  --glass-tint: color-mix(in oklch, var(--color-surface-white) 72%, transparent);
  --glass-tint-strong: color-mix(in oklch, var(--color-surface-white) 88%, transparent);
  --glass-border: color-mix(in oklch, var(--color-border) 60%, transparent);
  --glass-blur: 18px;
  --glass-blur-strong: 32px;
  --glass-saturate: 1.4;

  /* Motion */
  --motion-fast: 120ms;
  --motion-normal: 180ms;
  --motion-slow: 260ms;
  --ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);
}
```

> Companion web implementations may define full OKLCH ramps (`--blue-50…950`, etc.) and a
> `@media (color-gamut: p3)` enrichment block — see §5.3 and
> `frontend/src/index.css`. Those are the *generator*; the hexes above are the
> *contract* every platform mirrors.

## 19.1 Cross-Platform Token Parity (contract)

The values above are canonical. Each native platform keeps a hand-mirrored copy;
they must match this table exactly — a drift here is a defect (it is how Mac/Watch
once shipped `#0B3397`/`#667085` after web had moved on). When a token changes,
coordinate every affected project/platform before release and record each adoption.
Separate repositories may require linked PRs; do not claim cross-project parity
from a change in this file alone. Palette changes require explicit brand approval.

| Token | Web (`index.css`) | iOS / Mac / Watch (`Color`) | Android (`Color.kt`) |
|-------|-------------------|-----------------------------|----------------------|
| lumi-blue | `#006093` | `lumiBlue` | `LumiBlue` |
| lumi-blue-hover | `#004F80` | `lumiBlueHover` | `LumiBlueHover` |
| lumi-blue-active | `#003E6A` | `lumiBlueActive` | `LumiBlueActive` |
| lumi-blue-soft | `#E4F3FC` | `lumiBlueSoft` | `LumiBlueSoft` |
| civic-navy | `#102A43` | `civicNavy` | `CivicNavy` |
| ink | `#172033` | `ink` | `Ink` |
| soft-slate | `#5E6677` | `softSlate` | `SoftSlate` |
| paper-white | `#F4F0E8` | `paperWhite` | `PaperWhite` |
| surface-white | `#FFFFFF` | `surfaceWhite` | `SurfaceWhite` |
| archive-gray | `#E7EAF0` | `archiveGray` | `ArchiveGray` |
| border-subtle | `#E7EAF0` | `borderSubtle` | `BorderSubtle` |
| border | `#D9DEE8` | `border` | `Border` |
| border-strong | `#C8D0DE` | `borderStrong` | `BorderStrong` |
| signal-amber | `#F4A62A` | `signalAmber` | `SignalAmber` |
| amber-soft | `#FFF4DC` | `warningBanner` | `AmberSoft` |
| risk-red | `#C2410C` | `riskRed` | `RiskRed` |
| red-soft | `#FFF1EC` | — | `RedSoft` |
| success-green | `#1F7A4D` | `successGreen` | `SuccessGreen` |
| green-soft | `#E9F7EF` | — | `GreenSoft` |

**Scope of this contract.** It binds the product palette above. The §5.5
dark-ground tints (`amber/red/green-on-navy`) are intentionally absent: they exist
only for web and print sales surfaces that invert one panel to navy, a surface no
native shell has. Adding them to the native mirrors would ship dead tokens. If a
native surface ever needs a navy ground, add the row here in that PR. The §8.0
liquid-glass tokens (`--glass-*`) are likewise outside this table: they are
web-webview materials with no native mirror yet. If a native shell adopts glass,
mirror by role — platform-idiomatic materials where they exist — and add the rows
in that PR.

Material shape tokens must also mirror by role, even when native platforms express
them as `CGFloat`, `Dp`, or component defaults:

| Role | Web token | iOS / Mac / Watch | Android |
|---|---|---|---|
| tiny radius | `--radius-xs: 2px` | `radiusXS = 2` | `RadiusXS = 2.dp` |
| small radius | `--radius-sm: 4px` | `radiusSM = 4` | `RadiusSM = 4.dp` |
| card/control radius | `--radius-card/control: 8px` | `radiusCard = 8` | `RadiusCard = 8.dp` |
| popover radius | `--radius-popover: 12px` | `radiusPopover = 12` | `RadiusPopover = 12.dp` |
| modal radius | `--radius-xl: 16px` | `radiusXL = 16` | `RadiusXL = 16.dp` |
| hairline border | `--border-hairline: 1px` | `1 / displayScale` | `1.dp` or platform hairline |
| focus ring | `--border-focus: 2px` | `2` | `2.dp` |
| severity rail | `--border-rail: 3px` | `3` | `3.dp` |

**No dark column** — by design (§5). Native shells force light
(`UIUserInterfaceStyle = Light` / `.preferredColorScheme(.light)` /
light-only `LumiTheme`); web sets `color-scheme: light` and keeps the `dark:`
variant inert (pinned to a never-applied `.dark` class).

---

# 20. Tailwind Theme Guidance

Use the host's existing styling system. Lumi Agents currently uses plain desktop
CSS; this section is an adapter example for companion projects using Tailwind, not
an instruction to install it. Map component colors to §19 semantic tokens. Do not
add stock palette classes or duplicate hex values inside feature components.

A companion may have `frontend/scripts/check-design-tokens.mjs`; locate and run the
actual host check before claiming enforcement. Framework syntax varies by installed
version. The example below preserves the brand values; a real adapter should refer
to the canonical token layer where supported instead of maintaining another palette.

Example Tailwind extension:

```js
export default {
  theme: {
    extend: {
      colors: {
        lumi: {
          blue: "#006093",
          hover: "#004F80",
          soft: "#E4F3FC"
        },
        civic: {
          navy: "#102A43"
        },
        paper: {
          white: "#F4F0E8"
        },
        archive: {
          gray: "#E7EAF0"
        },
        signal: {
          amber: "#F4A62A"
        },
        risk: {
          red: "#C2410C"
        },
        success: {
          green: "#1F7A4D"
        }
      },
      borderRadius: {
        sm: "4px",
        md: "8px",
        lg: "12px",
        xl: "16px"
      },
      fontFamily: {
        sans: ["Geist", "Noto Sans", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["Geist Mono", "ui-monospace", "SFMono-Regular", "monospace"]
      }
    }
  }
};
```

---

# 21. Anti-Patterns

Do not use AI glow, neon or purple-blue startup gradients, ad-hoc glassmorphism (translucent
material is allowed only through the §8.0 liquid-glass recipes for floating desktop chrome —
never content surfaces, marketing surfaces, or the logo), floating 3D dashboards,
robot illustrations, brain icons, circuit-board patterns, excessive sparkles, cartoon mascots, huge
pill buttons, generic SaaS avatars, fake stock-office photography, template landing-page waves,
dashboard overload, red-heavy fear UI, or surveillance language.

Do not say:

```text
AI-powered productivity revolution
10x your team
Supercharge your workflow
Command your company with AI
Automate your CEO
```

Say:

```text
Know what needs attention.
See what is stuck.
Turn daily updates into a morning brief.
Keep work clear without more meetings.
```

---

# 22. Unique Unconventional Edge

The unconventional move is restraint. Most AI products signal intelligence with glow, gradients,
magic, animation, chatbot bubbles, or fake dashboards; Lumi signals it with edited information,
source-backed insights, strong typography, calm surfaces, evidence trails, clear next actions, and
human-readable operating memory.

The product should feel like:

> A serious organization has reviewed the company’s operating signals and prepared a brief.

Not:

> A chatbot generated a summary.

That distinction is the brand.

---

# 23. Example Product Copy

## Homepage hero

```text
A clearer morning brief for running the company.

Lumi turns daily team updates, tasks, projects, and recurring work
into a focused operating brief for the CEO.
```

## Vietnamese hero

Use the canonical Vietnamese hero in [§17.2](#172-hero).

## Product description

```text
Lumi is an AI operating workspace for SME teams.
Team members update daily pulse, tasks, projects, and recurring work.
Lumi turns that information into commitments, risks, decisions,
and a morning brief for leadership.
```

## Empty state

```text
No brief yet.

Ask your team to submit today’s pulse.
Lumi will use those updates to prepare your first operating brief.
```

## Error state

```text
The report could not be saved.
Your draft is still available. Choose a writable folder and save again.
```

Use this only when the draft is actually preserved and no save effect is ambiguous.
Missing information is an empty/incomplete state, not a system error.

## Low confidence state

```text
Lumi found this item, but the source is incomplete.
Please confirm before acting.
```

---

# 24. Design QA Checklist

Review the changed journey, not every screen in the product. Attach before/after
captures at the same viewport, the exercised states, and check results to the PR.
A documentation-only edit checks contracts and examples; it does not certify UI.

- [ ] Existing palette values, Geist hierarchy, light-only paper, logo, and material language are preserved.
- [ ] The page has one clear job and next action; every control supports a real capability.
- [ ] Shared primitives/tokens are reused; no new variant or setting without demonstrated need.
- [ ] Small-laptop and narrow layouts keep context and important actions visible without nested panel clutter.
- [ ] Loading, empty, denied, error, stale/partial, approval, cancellation, and completion states are covered where applicable.
- [ ] Planned, executed, verified, draft, and published labels match actual evidence; uncertain effects cannot invite unsafe replay.
- [ ] Keyboard-only operation, focus return, labels, screen-reader status, and target sizes work.
- [ ] Text/control contrast is measured on actual backgrounds; color is not the only signal.
- [ ] Large text, reflow, Vietnamese/long labels, supported RTL, and reduced-motion settings are checked.
- [ ] User input, scroll, and focus survive refresh/recovery; overlays do not hide the active control.
- [ ] Materials follow §8, severity rails use the 3px token, and only approved lighting treatments appear.
- [ ] Glass surfaces follow the §8.0 liquid-glass rules: floating chrome only, blur budget respected, opaque fallback verified (reduced transparency / no `backdrop-filter`), text contrast measured over real content.
- [ ] No new dependency, visual feature, or runtime-readiness claim is hidden in a polish change.

If a required check fails, fix or explicitly block the affected scope; do not mark
it complete because the happy-path screenshot looks finished. Keep existing brand
values stable when fixing a pairing, hierarchy, or interaction defect.

---



# 25. Final Design Statement

Lumi’s design should be:

> Calm enough for daily use, serious enough for executive decisions, warm enough for teams, and precise enough to trust.

The logo supplies institutional blue, geometric structure, and disciplined negative space. Do not
decorate it; build the whole product around what it says:

> Structure. Clarity. Guidance. Trust.
