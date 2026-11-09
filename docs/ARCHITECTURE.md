# Nutus — Architecture

*Nutus* (Latin): a nod; also a command, a will.
**Your DAO pays people even when the council is busy.**

Nutus is an operating layer that sits beside a NEAR DAO treasury (Sputnik DAO v2, which Trezu also runs on). The council decides once; small payouts then go through unless someone objects, recurring pay runs with guaranteed notice, silent seats are flagged before they freeze the treasury, and every payout is checked before the vote. The DAO's own contract is never changed.

Related docs: `NUTUS_SPEC.md` (full behaviour), `PROGRESS.md` (tracker), `THREAT_MODEL.md` (to be written), `PITCH.md`.

---

## 1. Design principles

1. **The DAO stays in charge.** Only the DAO account can configure, fund, pause or withdraw. Every change goes through an ordinary DAO proposal.
2. **Nobody else holds power.** Instance code is pinned by hash (NEP-591 global contract). There's no admin key, no upgrade method, and no builder privilege.
3. **Money never goes missing.** Every outgoing transfer has a pending state and a callback. A failure restores the budget.
4. **Promises are enforced by code.** Locked notice money can't be withdrawn, even by a DAO vote.
5. **Silence never kills a payout.** An objection or a timeout files a normal DAO proposal automatically.
6. **Only what moves money is on chain.** The report, seat watch, preflight and UI read public data. Anyone can rebuild them.

---

## 2. System overview

```
┌──────────────────────────────── NEAR (on-chain) ─────────────────────────────────┐
│                                                                                  │
│   ┌──────────────┐  setup proposal (FunctionCall)   ┌────────────────────────┐   │
│   │  DAO         │ ───────────────────────────────► │  nutus.near            │   │
│   │  (Sputnik v2 │                                  │  FACTORY               │   │
│   │   / Trezu)   │                                  │  creates instance,     │   │
│   │              │                                  │  global code by hash   │   │
│   │  treasury    │                                  └───────────┬────────────┘   │
│   │  policy      │                                              │ creates        │
│   │  proposals   │ ◄── add_proposal (escalation) ──┐            ▼                │
│   │              │ ◄── get_policy / get_proposal ──┤  ┌────────────────────────┐ │
│   │              │ ── configure / fund / pause ──► └──│  <dao>.nutus.near      │ │
│   └──────────────┘    / withdraw / add_standing       │  INSTANCE              │ │
│                                                       │  lanes · tiers         │ │
│   ┌──────────────┐ ◄─ storage_deposit / ft_transfer ──│  payouts · objections  │ │
│   │ NEP-141      │                                    │  standing + notice     │ │
│   │ USDC / USDT  │ ── ft_on_transfer (funding) ─────► │  records · bond float  │ │
│   └──────────────┘                                    └───────────┬────────────┘ │
│                                                                   │ NEAR / FT    │
│                                                                   ▼              │
│                                                          contributors            │
└──────────────────────────────────────────────────────────────────────────────────┘
           ▲ views + NEP-297 events                     ▲ signed txs (wallet)
           │                                            │
┌──────────┴──────────────────── off-chain ─────────────┴──────────────────────────┐
│  report service ─ seat watch ─ preflight ─ Fix-this builders   (packages/report, │
│                                                                 packages/core)   │
│  keeper (release · escalate · pay_due · settle)                (packages/keeper) │
│  notifications (Telegram)                                      (packages/notify) │
│  web app: Report · Get paid · Council inbox · Setup · Board · Ecosystem   (app/) │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Components

| # | Component | Where | Language | Owner | Responsibility |
|:--|:--|:--|:--|:--|:--|
| C1 | Instance contract | `contracts/instance` | Rust, near-sdk 5.x | **A** | Budget, lanes, tiers, objections, escalation, standing payments, locked notice, records, bond float |
| C2 | Factory contract | `contracts/factory` | Rust, near-sdk (`global-contracts`) | **A** | Creates `<dao>.nutus.near` from a pinned code hash; one-proposal setup via `ft_on_transfer` / `create` |
| C3 | Contract tests | `contracts/tests` | Rust, near-workspaces | **A** | Integration tests against the real Sputnik v2 wasm, plus invariant property tests |
| C4 | Keeper | `packages/keeper` | TypeScript | **A** | Triggers due actions; idempotent; anyone can run it |
| C5 | Core library | `packages/core` | TypeScript | **B** | Shared types (from the ABI), proposal builders, vote-threshold maths, preflight |
| C6 | Report service | `packages/report` | TypeScript, SQLite cache | **B** | Reads DAO history over RPC; F1–F5 metrics; Fix-this proposals; ecosystem stats |
| C7 | Notifications | `packages/notify` | TypeScript (Telegram) | **B** | Pushes window starts, shortfalls, quiet seats, bonds to recover |
| C8 | Web app | `app/` | Next.js, NEAR wallet selector | **B** | Six screens (§7) |
| C9 | Docs and demo | `docs/` | Markdown, video | **A + B** | README, THREAT_MODEL, PITCH, demo video |

---

## 4. On-chain design

### 4.1 Instance state

```
dao               AccountId            owner; sole configurer
paused            bool
council           Set<AccountId>       objectors/approvers, synced from DAO policy
tokens            Map<TokenId, TokenBook>
lanes             Map<LaneId, Lane>
payouts           Map<PayoutId, Payout>
standing          Map<StandingId, Standing>
records           Map<AccountId, Record>
bond_float        NearToken
record_steps      Vec<(paid_jobs, small_max)>
```

**TokenBook:** `balance`, `reserved`, `committed_notice`, `standing_buffer`, where
`available = balance − reserved − committed_notice − standing_buffer`.

### 4.2 Invariants (tested after every step)

| ID | Invariant |
|:--|:--|
| I1 | `balance ≥ reserved + committed_notice + standing_buffer`, for every token, after every call and callback |
| I2 | `withdraw` can never reduce `committed_notice`, whoever calls it |
| I3 | A payout enters `Sending` at most once, so double releases are no-ops |
| I4 | Only `dao` can configure, fund (via `ft_on_transfer`), pause, withdraw or seed records |
| I5 | Every record point references a real payout or DAO proposal |

### 4.3 Payout state machine

```
                file_payout
                     │
                     ▼
     ┌──────────── Waiting ───────────────┐
     │ object (Small,     │ window passed  │ approve (Medium)
     │ in window)         │ → release      │
     ▼                    ▼                ▼
  Objected ──► Escalated   Sending ◄───────┘
     ▲         (DAO proposal id)    │
     │ Medium timeout → escalate    ├─ ok ──► Paid
     │                              └─ fail ► Failed (budget restored)
  (needs_manual_filing if bond short / permission denied)
```

### 4.4 Standing payment state machine

```
add_standing ──► Active ── pay_due (from standing_buffer) ──► Active
                   │
                   │ stop_standing (DAO)
                   ▼
                Noticed ── pay_due (from committed_notice) ──► Noticed … ──► Ended
                   │
                   └─ end date reached ──► Ended (unused notice released)
```

### 4.5 Methods by caller

| Caller | Methods |
|:--|:--|
| DAO only | `configure_lane`, `remove_lane`, `set_record_steps(lane_id, steps)`, `seed_records`, `add_standing`, `stop_standing`, `pause`, `unpause`, `withdraw`, `set_bond_float`, `set_filing_deposit`, `fund_near`; funding through `ft_on_transfer` |
| Council member | `object`, `approve` |
| Permitted filer | `file_payout` (payable anti-spam deposit), `cancel_payout` (filer or DAO, Waiting only) |
| Anyone | `release`, `escalate` (Medium timeout, or retry of `needs_manual_filing`), `pay_due`, `sync_council`, `settle_escalation` |
| Views | `get_config`, `get_lanes`, `get_lane`, `get_payout`, `get_payouts`, `get_standing`, `get_record`, `get_token_books`, `get_period_usage` |

### 4.6 Events (NEP-297, `standard: "nutus"`, `version: "1.0.0"`)

`instance_created`, `funded`, `lane_configured`, `lane_removed`, `record_steps_set`, `records_seeded`, `payout_filed`, `payout_cancelled`, `payout_objected`, `payout_approved`, `payout_escalated`, `escalation_failed`, `payout_sending`, `payout_paid`, `payout_failed`, `escalation_settled`, `standing_added`, `standing_funded`, `standing_paid`, `standing_short`, `standing_stopped`, `standing_ended`, `withdrawn`, `paused`, `unpaused`, `bond_float_set`, `filing_deposit_set`, `council_synced`. Source of truth: `contracts/instance/src/events.rs`.

### 4.7 Sputnik facts the design relies on (verified in source, 2026-11-08)

| Fact | Design consequence |
|:--|:--|
| `add_proposal` needs a deposit exactly equal to `proposal_bond` (default 1 NEAR) | Escalation reads the bond first, then pays it from `bond_float` |
| The bond is refunded on approve, reject or expired-finalize; kept only on remove | Escalation is near-free; the inbox prompts the council to finalize expired ones |
| Default policy gives everyone `*:AddProposal` | The instance can escalate with no extra permission; the report detects restricted policies |
| A FunctionCall proposal can carry several actions to one receiver | Setup in one proposal |
| Threshold is `Weight(n)` or `Ratio(num/den)` → `num*total/den + 1` | Seat watch freeze maths |

---

## 5. Key flows

### 5.1 Setup (one proposal)
```
Report "Fix this" ─► core builds proposal ─► member files it ─► council votes once
USDC path:  DAO ─FunctionCall(token)─► [storage_deposit(instance), ft_transfer_call(factory, budget, "setup:{config}")]
            factory.ft_on_transfer ─► create <dao>.nutus.near ─► use global code ─► new(dao, config) ─► forward funds
NEAR path:  DAO ─FunctionCall(factory)─► create({config}) + deposit
Restricted policy only: + ChangePolicyAddOrUpdateRole(instance: transfer:AddProposal)
```

### 5.2 Small payout
```
contributor ─file_payout(+0.1 NEAR)─► Waiting (amount reserved) ── 48h, no objection ──►
keeper/anyone ─release─► Sending ─► storage_deposit(recipient) + ft_transfer ─► on_sent ─► Paid (+record, deposit refunded)
```

### 5.3 Objection → escalation
```
council member ─object(reason)─► Objected ─► get_policy (bond) ─► add_proposal(Transfer, bond) ─► Escalated(id)
amount un-reserved · DAO votes normally · keeper ─settle_escalation─► get_proposal ─► Approved? +record
```

### 5.4 Standing payment with guaranteed notice
```
DAO add_standing ─► committed_notice += amount × notice_periods
due ─► pay_due ─► from standing_buffer
DAO stop_standing ─► Noticed ─► pay_due from committed_notice ─► Ended
DAO withdraw into committed_notice ─► REFUSED (I2)
```

---

## 6. Off-chain design

| Part | Inputs | Outputs |
|:--|:--|:--|
| Report | DAO id → RPC `get_proposals`, `get_policy` | F1–F5 findings; freeze distance; Fix-this proposal JSON |
| Seat watch | Vote records, policy | Seat status (active < 30 days, quiet 30–60, silent > 60), freeze distance, drafted seat proposals (filed by a person) |
| Preflight | Draft proposal, token, recipient | Adds `storage_deposit` / `near_deposit` actions, or warnings |
| Keeper | Instance views and events | `release`, `escalate`, `pay_due`, `settle_escalation` calls |
| Notify | Events | Telegram messages to linked council members |
| Ecosystem | Whole-network scan | Landing-page stats (138 DAOs, 5,941 proposals) |

The report port is regression-tested against the saved mainnet scan in `data/` (24% vs 3% lapse rate, 62/136 zero-vote, 216/1,835 repeats, 199/496 silent seats, 125 failed executions, 0 bounties).

---

## 7. Web app screens

| Screen | User | Shows / does |
|:--|:--|:--|
| Report | Anyone | Any DAO's findings, each with Fix this |
| Setup | Member | Review drafted proposals; preflight; file |
| Get paid | Contributor | File payout; tier, ETA, record, countdown, outcome |
| Council inbox | Council | Object / Approve, standing due or short, seat warnings, preflight warnings, finalize to recover bond |
| Public board | Anyone | Waiting payouts, objections and reasons, standing and notice, records, seat health, period budget |
| Ecosystem | Anyone | Network-wide findings |

---

## 8. Roles of the two builders

### Builder A: Chain lead
**Mission:** everything that holds or moves money, and the proof it's safe.

Owns:
- C1–C4: instance contract, factory, contract tests, keeper.
- Contract ABI and event schema: **A publishes, B consumes.** Changes after the freeze need both to agree.
- Testnet deployments: global code, factory, demo DAO with 3 council members.
- `THREAT_MODEL.md`: every way a DAO, council member, filer, keeper or outsider could misuse the contracts, and which invariant stops it.

Done means:
- every method in §4.5 implemented;
- invariants I1–I5 covered by integration and property tests against the real Sputnik wasm;
- deployed on testnet;
- keeper running.

### Builder B: Data and product lead
**Mission:** what people see and do, and the evidence that the problem is real.

Owns:
- C5–C8: core library, report service, notifications, web app.
- The mainnet scan port and its regression tests; all numbers used in the pitch.
- Proposal builders (Fix-this, setup, seat changes) and preflight. These must produce JSON the contracts and Sputnik accept, and A reviews them.
- UI quality: HIG structure, self-hosted fonts, legal pages.

Done means:
- the report reproduces the scan numbers;
- all six screens work against testnet;
- every Fix-this proposal files and executes on the demo DAO;
- preflight fixes an unregistered recipient end to end.

### Shared
- Freezing interfaces at the start (`packages/core/types.ts` generated from `cargo near abi`).
- End-to-end runs on the testnet DAO, the README, the demo video, and the final pitch (claims limited to what's verified).
- Code review: A reviews B's proposal builders and preflight; B reviews A's events and views for UI needs.

### Hand-off points
| # | From → To | What | Unblocks |
|:--|:--|:--|:--|
| H1 | A → B | Frozen ABI, events, view shapes | B builds UI against mocks |
| H2 | A → B | Instance on testnet | B swaps mocks for live calls |
| H3 | A → B | Factory and global code on testnet | Setup screen files real proposals |
| H4 | B → A | Proposal builders | A adds setup-via-real-proposal tests |
| H5 | B → A | Event-driven board needs | A confirms event coverage |

---

## 9. Repo layout

```
nutus/
  contracts/{instance,factory,tests}
  packages/{core,report,keeper,notify}
  app/
  data/  scripts/          # existing mainnet scan, kept as fixtures
  docs/{ARCHITECTURE.md,PROGRESS.md,NUTUS_SPEC.md,THREAT_MODEL.md,PITCH.md}
```

## 10. Conventions
- Branches: `a/<topic>` and `b/<topic>`; PRs into `main`, reviewed by the other builder.
- Amounts are always token base units (`U128` strings in JSON). Times are nanoseconds on chain and ISO in the UI.
- Every new contract method gets an event and a test before merge.
- `PROGRESS.md` is updated in the same PR as the work it records.
