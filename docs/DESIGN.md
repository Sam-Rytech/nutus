# Nutus — design direction

The redesign of https://nutus.vercel.app (landing page and the five app screens). Brand is fixed: see `app/public/brand/`.

## The idea: the glass ledger

Black, white type, generous space, few words (Fragment's world). Tidal cyan is a hint, never a fill: status dots, one underline, thin progress lines, focus rings, and the n and u in the wordmark.

The one 3D object sits on the right of the hero, behind the words: **a stream of dark glass slips, each a real testnet payout etched in mono, flowing out of the distance through a chrome arch shaped like the n's curve.** The arch is the objection window; slips that pass through it pick up a thin cyan edge — paid. (`app/src/brand/GlassLedger.tsx`, three.js.)

Superseded on 11 Nov: the water-filled window and the full-hero 3D mark.

## What we took from the references (and what we didn't)

| Reference | Taken | Not taken |
|---|---|---|
| raycast.com | Near-black canvas; the one accent used as *light*, not paint; the real product as the hero; two-tone headings (white phrase, grey continuation) | Their red streaks, the launcher window, the keyboard |
| buzzabout.ai | Data turning into findings as you scroll (their tiles → scan line → stacked bars) | The sphere of social posts; their blue; Geist |
| mckp.live | Restraint: small confident headings, quiet numbered steps, the working product embedded instead of screenshots | The device mockup studio |
| fragment.im | Glossy glass as a material; big light-weight numerals over thin rules; text revealed word by word | The chrome tile ribbon; tracked all-caps labels |
| premotio.com | Floating glass pill navigation; one playful kinetic headline moment | The preloader counter, the card ring, the RGB-split blur |

## Tokens

**Colour**

| Token | Hex | Use |
|---|---|---|
| `ink-950` | `#07090C` | Page background (dark) |
| `ink-900` | `#0E1116` | Brand black; raised surfaces on dark |
| `ink-800` | `#161B22` | Cards, inputs on dark |
| `line` | `#FFFFFF` at 8% | Hairlines on dark |
| `grey-500` | `#8A8F98` | Secondary text on dark; the grey half of two-tone headings |
| `ash-200` | `#D9DDE2` | Hairlines and borders on light |
| `paper` | `#F5F7F9` | Light sections (the mainnet findings) |
| `white` | `#FFFFFF` | Primary text on dark |
| `tidal` | `#13B5CB` | The accent: water, primary buttons, focus, the wordmark's n and u |
| `tidal-deep` | `#0B8FA3` | Cyan text and links on light backgrounds (contrast) |
| `tidal-glow` | `#13B5CB` at 12–35% | Glass tint, light blooms, caustics |
| `alert` | `#E5484D` | Errors only (failed transfer, wallet error) |

Status uses the water, not new colours: **waiting** = tube part-full, **paid** = full tidal, **objected** = water drained to grey, **failed** = alert outline.

**Type**

- **Public Sans** (already the wordmark's face): headings 600 weight, tracking −0.035em; display 72 / 56 / 40 px, body 17 px / 1.6.
- **Geist Mono**: every amount, account name, countdown, proposal id and step number. On-chain things look on-chain.
- Two-tone headings: `Your DAO pays people.` (white) `Even when the council is busy.` (grey).
- Sentence case everywhere; no tracked all-caps labels.

**Material**

- Glass panels: `ink-800` at 60% + 16 px backdrop blur + 1 px top highlight; on light, white at 70%.
- Water: an SVG/canvas wave clipped to a rounded tube, with a soft caustic shimmer. Pure CSS/SVG/canvas, no 3D assets.
- Radius: 14 px cards, 999 px pills, 22 px app icon. No drop shadows on dark; light uses one soft shadow.

## Landing page

Every section answers something a judge or a DAO needs to know; each shows real data where it can.

1. Hero — headline, one line, "Try it on testnet", "Read your DAO"; the glass ledger on the right.
2. The idea in one paragraph, lit word by word as it scrolls.
3. The problem, measured on mainnet — 34% silent seats, 171 passed-then-failed, 84 of 115 never paid.
4. How a payout moves — four rows.
5. What you get — council inbox, get paid, payouts, DAO report, Telegram alerts; each with a live mini-view.
6. Safe by design — six facts (contract unchanged, code fixed by hash, DAO-only money, locked notice, preflight, tests).
7. Proof it works — the live payout row and six real transactions with explorer links.
8. Set it up — read, vote, run; the "read your DAO" input.
9. Open by default — code, run a keeper, Telegram bot, the spec.
10. Questions — five.
11. Footer — the wordmark alone, fading in from the top.

## App screens

Payouts, Council inbox, Get paid, DAO report, Set up — **dark by default**, the glass top navigation replaces the sidebar, content max 1,120 px.

- Every payout row: recipient and amount in mono, the water window, the one action that matters (Object / Approve / Release).
- Section heads two-tone; empty states are invitations with one action.
- The Report keeps its findings layout but borrows section 3's numerals.

## Build order

1. Tokens, fonts, glass and water primitives (`Window` component rewritten as the tube).
2. Landing page; review on a local preview before deploying.
3. App screens on the new shell.
4. Video capture on the 12th–13th uses the new site.
