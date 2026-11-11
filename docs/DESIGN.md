# Nutus — design direction

The redesign of https://nutus.vercel.app (landing page and the five app screens). Brand is fixed: see `app/public/brand/`.

## The idea: the window fills

Nutus has one object nobody else has: a payout's **objection window**. While it's open the council can stop the payment; when it closes, the payment goes out. We draw it as a **glass tube filling with tidal-cyan water**. Water level is time: an empty tube was just filed, a full one pays. If someone objects, the water drains into a DAO vote.

That object carries the whole site: the hero (a live testnet payout, not an illustration), every payout row in the app, the "how it works" sequence, and the loading states.

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

1. **Navigation**: floating glass pill — logo, Payouts · Council · Get paid · Report, and a white "Connect wallet" pill.
2. **Hero** (dark): two-tone headline, one line of explanation, "Open the council inbox" (tidal) and "Read your DAO" (ghost). Beside it, the **live window**: the newest waiting payout on testnet, amount and recipient in mono, countdown, water rising in real time. A faint tidal bloom behind it.
3. **What we found on mainnet** (light `paper` section): 8,339 proposals as a field of small tiles; a tidal scan line passes; the tiles sort into three findings in big light numerals over thin rules — **34%** of council seats silent · **171** proposals passed then failed · **84 of 115** people never paid.
4. **How it works** (dark, pinned, scrolls sideways): `01 Filed` → `02 Window open` (water rising) → `03 Paid` or `Objected` (water drains to a DAO vote) → `04 On the record`. Each step shows a real fragment of the app.
5. **Four ways to pay**: glass cards — Small, Medium, Large, Recurring — each with its own window variant.
6. **It runs itself** (dark): the keeper every five minutes (a mono ticker), and a real Telegram alert card from @nutusalertbot.
7. **Read your DAO**: one large glass input → opens the report for any Sputnik DAO.
8. **Footer**: the giant wordmark with cyan n and u, fading out; links and the testnet note.

**Motion** — one orchestrated moment on load (the mark draws its two strokes, then the hero window starts filling), the scan in section 3, the sideways pin in section 4. Everything else is still. `prefers-reduced-motion` turns all of it off. GSAP + ScrollTrigger.

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
