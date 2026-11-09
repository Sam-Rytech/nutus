# Nutus — build spec

*Nutus* (Latin): a nod; also a command, a will. *Nutu* — by a nod.
**One line:** Your DAO pays people even when the council is busy.
Event: NEAR Hackathon 2026 · Track: Social Money · Team: two builders · Scope: the full product (all six parts), not a time-boxed cut.

This spec supersedes the scope notes in the earlier plan. Facts marked **[verified]** were read from the Sputnik DAO v2 source (`near-daos/sputnik-dao-contract`, `sputnikdao2/src`) or NEAR docs on 2026-11-08.

---

## 1. Facts the design rests on

| # | Fact | Source | Consequence for Nutus |
|:--|:--|:--|:--|
| V1 | `add_proposal` requires the attached deposit to **equal** `policy.proposal_bond` exactly (`ERR_MIN_BOND`). Default bond is 1 NEAR; each DAO can change it. | [verified] `proposals.rs` | Escalation reads the DAO's `get_policy().proposal_bond` (async) and attaches exactly that. The instance keeps a NEAR **bond float**. |
| V2 | The bond is returned to the proposer when the proposal is **approved, rejected, or finalized as expired**. It is kept only if the proposal is **removed**. | [verified] `internal_return_bonds`, `internal_reject_proposal`, `Action::Finalize` | Escalation is close to free: the bond comes back to the Nutus instance. The float only needs to cover proposals still open. |
| V3 | Expired proposals return the bond only after someone calls `act_proposal(Finalize)`, which by default only the **council** may do. | [verified] default policy | The council inbox shows "Finalize to recover bond" on expired escalations. The float is sized for this. |
| V4 | Default policy: role `all` (everyone) has `*:AddProposal`. Custom policies may restrict it. | [verified] `default_policy` | Usually the instance can file proposals with no setup. The report checks `get_policy`; if restricted, setup adds a second proposal (`ChangePolicyAddOrUpdateRole`) granting the instance `transfer:AddProposal`. |
| V5 | A `FunctionCall` proposal targets **one** `receiver_id` but may carry **several actions**, each with its own deposit and gas. | [verified] `internal_execute_proposal` | Setup fits in **one** proposal per budget token (see §4). |
| V6 | Vote thresholds are either `Weight(n)` (a fixed count) or `Ratio(num, den)`, where required = `num*total/den + 1`, capped at total. Policies can be per role and per proposal kind. | [verified] `policy.rs` | Seat watch's freeze maths uses this formula per role, for the `transfer` kind. |
| V7 | Proposal views: `get_policy`, `get_proposals(from_index, limit)`, `get_proposal(id)`, `get_last_proposal_id`. | [verified] `views.rs` | The report, seat watch and on-chain settlement (§3.6) use these. |
| V8 | **Global contracts (NEP-591)** let a factory deploy instances that reference shared code. Per-instance cost is ≈0.2 NEAR (state only) against ≈3 NEAR for full bytecode. near-sdk supports this through the `global-contracts` feature. | NEAR docs | The factory uses a global contract **by hash** (immutable), never by account ID, so nobody, including us, can change a DAO's instance code later. |

---

## 2. Architecture

```
                 ┌──────────────────────────── on-chain ────────────────────────────┐
  DAO (Sputnik) ─┤ proposal (FunctionCall) ─► nutus.near (factory)                  │
                 │                              └─ creates <dao>.nutus.near         │
                 │                                   (global contract by hash)      │
                 │  <dao>.nutus.near ── add_proposal ──► DAO   (escalation)         │
                 │  <dao>.nutus.near ── get_policy/get_proposal ──► DAO (async reads)│
                 │  <dao>.nutus.near ── ft_transfer / NEAR transfer ──► recipients  │
                 └──────────────────────────────────────────────────────────────────┘
  off-chain:  indexer/report service · seat watch · preflight · keeper · web app
```

- **On-chain:** the factory and one instance per DAO. Everything that holds or moves money, plus the rules.
- **Off-chain:** the report, seat watch, preflight, keeper and web app. They read public data and draft proposals. They never hold keys that move money.
- **Trust statement (for the README):** the instance code is fixed by hash. Only the DAO account can configure, fund, pause or withdraw. Any account can trigger a release or payment that is already due. The builders have no admin role.

---

## 3. The instance contract (`<dao>.nutus.near`)

Rust, `near-sdk` 5.x. NEP-297 JSON events on every state change (`standard: "nutus"`, `version: "1.0.0"`).

### 3.1 State

```
dao: AccountId                       // owner; the only configurer
paused: bool
council: UnorderedSet<AccountId>     // objectors/approvers; synced from DAO policy
tokens: Map<TokenId, TokenBook>      // TokenId = "near" | NEP-141 account
lanes: Map<LaneId, Lane>
payouts: Map<PayoutId, Payout>
standing: Map<StandingId, Standing>
records: Map<AccountId, Record>
bond_float: NearToken                // reserved NEAR for escalation bonds
seat_rules, record_steps            // config
```

**TokenBook** (all u128):
- `balance`: what the instance holds.
- `reserved`: payouts waiting for their window.
- `committed_notice`: locked notice money for standing payments.
- `standing_buffer`: money set aside for upcoming standing payments.
- `available = balance − reserved − committed_notice − standing_buffer`.

**Invariant I1:** `balance ≥ reserved + committed_notice + standing_buffer` after every call and every callback.

**Lane:**
```
id, name, token,
small_max, medium_max,               // small ≤ small_max < medium ≤ medium_max; above → full DAO vote
window_ns (default 48h), medium_timeout_ns (default 7d),
period_cap (default 30-day period), period_start, spent_this_period,
objectors: Option<Set>  (None = whole council),
filers: Filers::Anyone | Members(Set) | DaoMembersOfRole(String),
silent_can_object: bool (default true)
```

**Payout:**
```
id, lane, recipient, amount, token, link, memo, tier: Small|Medium,
filed_at, deposit (anti-spam, refundable),
status: Waiting | Objected{by,reason} | Escalated{proposal_id} | Sending | Paid | Failed{reason} | Cancelled
```

**Standing:**
```
id, recipient, token, amount, period_ns, next_due_ns, ends_at_ns,
notice_periods (count), state: Active | Noticed{notice_started, remaining} | Ended
```

**Record** (per recipient): `paid_jobs: u32`, `last_objection_ns`, `sources: Vec<SourceRef>`, where `SourceRef = DaoProposal(id) | NutusPayout(id)`. Every point traces to a real payment.

### 3.2 Methods

**DAO only** (`predecessor == dao`):

| Method | Does |
|:--|:--|
| `configure_lane(lane)` / `remove_lane(id)` | Add or replace a lane. Removing requires no Waiting payouts. |
| `set_record_steps(steps)` | E.g. `[(0,20),(3,40),(10,80)]` paid jobs → small_max in token units, with a 90-day objection cooldown. |
| `seed_records(entries)` | One-time import of past payments from the report. Each entry lists DAO proposal IDs. Because the DAO votes on it, it is DAO-authorised and traceable. |
| `add_standing(s)` | Requires `available ≥ notice_amount`, then moves it to `committed_notice`. |
| `stop_standing(id)` | Starts the notice period; payments continue from committed money. |
| `pause()` / `unpause()` | While paused: no new filings, no releases; objections still work. |
| `withdraw(token, amount, to)` | Fails if `amount > available` (**I2: notice money is untouchable**). |
| `set_bond_float(n)` | — |

**Funding:**
- `ft_on_transfer(sender, amount, msg)` accepts only from `dao`. Messages: `"fund"`, `"fund_standing:<id>"`, or `"setup:<json>"` (see §4). Any other sender's tokens are refunded.
- NEAR arrives through payable `fund_near()`.

**Council, individually:**
- `object(payout_id, reason)`: only during the window, only by objectors, only Small payouts.
- `approve(payout_id)`: Medium payouts; first approver releases.

**Permitted filers:** `file_payout(lane, recipient, amount, link, memo)`, payable with the anti-spam deposit (default 0.1 NEAR).
- Checks: not paused; tier by amount (above `medium_max` → panic `USE_FULL_VOTE`); for Small, the amount must also be within the recipient's record step; period cap has room; `available` covers the amount.
- On success it reserves the amount and emits `payout_filed`.

**Anyone (keeper or UI):**

| Method | Does |
|:--|:--|
| `release(payout_id)` | Small, Waiting, window passed → `Sending` → transfer → callback. |
| `escalate(payout_id)` | Medium, Waiting, timed out → files the DAO proposal (same path as an objection). |
| `pay_due(standing_id)` | Pays every due period up to now from the standing buffer; during notice, from committed notice. |
| `sync_council()` | Async `get_policy` → sets council to the members of roles that can `VoteApprove` on `transfer`. |
| `settle_escalation(payout_id)` | Async `get_proposal(id)`; if Approved, counts it in the recipient's record and closes the payout. |

**Views:** `get_config`, `get_lanes`, `get_payouts(from, limit, status?)`, `get_standing`, `get_record(account)`, `get_token_books`, `get_period_usage(lane)`.

### 3.3 Release path (shared by small payouts, medium payouts and standing payments)

1. Set status `Sending`. **I3:** a payout can only enter Sending once, so a double release is a no-op (`ALREADY_SENT`).
2. NEP-141 tokens: `storage_deposit(recipient, registration_only=true)` paid from the filer's anti-spam deposit, then `ft_transfer(recipient, amount)`.
   NEAR: a direct transfer.
3. Callback `on_sent(id)`:
   - **success:** `Paid`; reserved and balance go down; record +1; refund the remaining deposit to the filer; emit `payout_paid`.
   - **failure:** `Failed{reason}`; un-reserve the amount back to available; refund the deposit; emit `payout_failed`. **Money never disappears.**

### 3.4 Escalation (objection, or a medium payout that timed out)

1. Async `dao.get_policy()`, giving the bond amount B.
2. Callback: if `bond_float ≥ B`, call `dao.add_proposal({description, kind: Transfer{token_id, receiver_id, amount, msg: None}})` with deposit B.
   - The description carries: `[Nutus] Escalated payout #<id> · lane <name> · objected by <acct>: "<reason>" · work: <link>`.
3. Callback: store the `proposal_id`, set status `Escalated`, un-reserve the amount (the DAO treasury pays now), emit `payout_escalated`.
4. If the bond float is short or the DAO refuses (permission): set `Objected` with flag `needs_manual_filing`. The UI then offers a one-click filing by any member.
5. The bond returns to the instance when the proposal is approved, rejected or finalized (V2, V3).

### 3.5 Standing payments
- On creation: `committed_notice += amount × notice_periods`.
- The DAO tops up `standing_buffer` with `fund_standing:<id>`.
- `pay_due` pays only from `standing_buffer` while Active.
  - If the buffer is short, the payment stays due (`standing_short` event); the inbox warns the DAO.
- After `stop_standing`: the remaining notice payments come from `committed_notice`, which is released as each is paid. When notice ends, the state becomes `Ended`.
- **I2** blocks `withdraw` from touching committed notice, even when the DAO itself calls it.

### 3.6 Track records, made concrete
Points come only from:
- Nutus payouts that reached `Paid`;
- escalations later settled as Approved (`settle_escalation`, which reads the DAO's own proposal);
- `seed_records`, which the DAO voted on, with one proposal ID per point.

Objections set `last_objection_ns`; step-ups pause for 90 days. No token, no transferable score.

### 3.7 Tiers, summarised

| Tier | Amount | Needs | Enforced where |
|:--|:--|:--|:--|
| Small | ≤ `min(small_max, record_step)` | Nobody unless objected within the window | Instance |
| Medium | ≤ `medium_max` | First approver | Instance |
| Large | above | Full DAO vote, with preflight added to the proposal | DAO; drafted in web app |

---

## 4. Setup: one proposal per budget token (V5)

**USDC/USDT budget.** One `FunctionCall` proposal with `receiver_id = <token>` and two actions:
1. `storage_deposit({account_id: "<dao>.nutus.near", registration_only: true})` with the token's storage deposit attached (registers the instance before it exists, per NEP-145).
2. `ft_transfer_call({receiver_id: "nutus.near", amount, msg: "setup:<config-json>"})` with 1 yocto.

The factory's `ft_on_transfer` then:
- creates `<dao>.nutus.near`;
- attaches the global code by hash;
- calls `new(dao=sender_id, config)` (the DAO is the token sender, so ownership can't be spoofed);
- forwards the tokens with `ft_transfer_call(instance, amount, "fund")`.

The factory **sponsors** the ≈0.2 NEAR account and state cost, with a small set-up fee repaid from the instance's first NEAR funding. If anything fails, it returns the full amount to the DAO (`ft_on_transfer` returns the unused amount).

**NEAR budget.** One `FunctionCall` proposal with `receiver_id = nutus.near`, action `create({config})`, and the budget plus storage as deposit.

**Extra proposals, only when needed** (the report detects them up front):
- the policy restricts AddProposal → `ChangePolicyAddOrUpdateRole` granting the instance `transfer:AddProposal`;
- a standing payment beyond setup → a `ft_transfer_call` with `fund_standing`, plus a `FunctionCall` to `add_standing`.

**Pitch wording that stays true:** "Set up in one proposal." Only DAOs with restricted policies need a second.

**Factory (`nutus.near`):** `create`, `ft_on_transfer`, `get_instance(dao)`, `list_instances`. The global code hash is fixed at init; a new version is a new factory with a new hash. No upgrade or admin method on instances.

---

## 5. Off-chain parts

### 5.1 Report service (TypeScript, Node)
- Input: a DAO account ID.
- Pages through `get_proposals` via public RPC. Uses `get_policy` for roles, thresholds and bond. Caches per DAO (SQLite), refreshed on view.
- Computes, matching the mainnet scan definitions (`scripts/deeper.py` is the reference; port it 1:1 and regression-test against the saved `data/`):
  - **F1** — lapsed small payouts with zero votes, people never paid again, median wait.
  - **F2** — repeat series (same recipient, token, amount, ≥ 3 times).
  - **F3** — silent seats, freeze distance (V6 maths).
  - **F4** — approved but failed, with cause classification.
  - **F5** — bounty usage.
- **Fix this** builders return ready proposal JSON:
  - setup lane, with budget = trailing small-payout spend, rounded;
  - setup plus `add_standing` for each repeat series;
  - `seed_records` from the history;
  - `RemoveMemberFromRole` / `AddMemberToRole` for seats;
  - a policy role grant if V4 applies.
- Also a whole-ecosystem view (all 138 DAOs) for the landing page stats, regenerated from data.

### 5.2 Seat watch
Per seat:
- last vote and participation in the last N proposals;
- status: active < 30 days, quiet 30–60, silent > 60 (DAO-configurable, stored client-side per DAO);
- freeze distance per role and per `transfer` threshold.

It drafts proposals; **a person files them** (one click). It never removes anyone itself.

### 5.3 Preflight
Runs on every proposal drafted through Nutus and on any pasted proposal JSON. Checks:
1. Recipient's `storage_balance_of` on the token → adds a `storage_deposit` action.
2. DAO balance of the token.
3. NEAR needs wrapping → adds `near_deposit` on `wrap.near`.
4. Known failure causes from F4 (bulk-payment storage, Intents transfer, cross-chain signing) → warns.

Output: fixes added into the proposal where the proposal kind allows it (a `FunctionCall` bundle), otherwise a warning block in the description and the UI. Large payments become a `FunctionCall` bundle on the token contract (`storage_deposit` + `ft_transfer`) instead of a bare `Transfer` when a fix is needed.

### 5.4 Keeper (open source, runnable by anyone; we host one)
Polls instance views and events. Calls:
- `release` for Small payouts past their window;
- `escalate` for Medium payouts past their timeout;
- `pay_due` for standing payments that are due;
- `settle_escalation` once escalated proposals finish.

Idempotent by design (I3). Signs with its own key, which holds only gas money.

### 5.5 Notifications (P2 surface, built)
Telegram bot: a council member links an account by signing a message. Pushes: new payout in its window, standing payment short, seat going quiet, expired escalation to finalize.

### 5.6 Web app (Next.js, NEAR wallet selector)
Screens:
1. **Report**: type a DAO name; findings with Fix-this buttons.
2. **Get paid**: contributor files a payout; sees tier, ETA, record, countdown, outcome.
3. **Council inbox**: Small with Object, Medium with Approve, standing payments due/short, seat warnings, preflight warnings, finalize-to-recover-bond.
4. **Setup**: review and file the drafted proposals.
5. **Public board**: waiting payouts, objections and reasons, standing payments and notice, records, seat health, period budget.
6. **Ecosystem**: the 138-DAO findings.

UI rules from the plan: Inertia UI and global rules, HIG structure, self-hosted fonts, legal pages.

---

## 6. Tests

**Contract (`near-workspaces`, real Sputnik v2 wasm and a test NEP-141, in sandbox):**
- Setup through a real DAO proposal: USDC path and NEAR path; failed setup refunds the DAO.
- Limits: small/medium/full-vote boundaries; record steps; period cap and reset.
- Objection inside the window → a real Sputnik proposal exists with the right kind, amount and description; the bond returns after approve, reject and finalize.
- Objection after the window → refused. Non-objector objecting → refused.
- Medium: first approve releases; timeout escalates.
- Double release → no-op. Failed transfer (unregistered recipient on a token with no auto-register; receiver that panics) → `Failed`, budget restored, I1 holds.
- Standing: pays per period; stop starts notice; notice paid from committed money; `withdraw` into committed notice → refused, even from the DAO.
- Pause semantics. `sync_council` against a custom policy. `settle_escalation` counting records. `seed_records` only by the DAO.
- Invariant checks (I1, I2, I3) after every step of a randomised sequence (property test).

**Off-chain:**
- Report metrics reproduce the scan numbers on the saved data (138 DAOs, 5,941 proposals, 24% vs 3%, 62/136, 216/1,835, 199/496, 125 failed, 0 bounties).
- Freeze maths against V6 examples.
- Preflight on fixtures.

---

## 7. Repo layout

```
nutus/
  contracts/
    instance/        # Rust, near-sdk (global contract)
    factory/         # Rust, near-sdk + global-contracts feature
    tests/           # near-workspaces integration tests (Sputnik wasm vendored)
  packages/
    core/            # TS: shared types, proposal builders, V6 maths, preflight
    report/          # TS: RPC reader, metrics (port of scripts/deeper.py), Fix-this
    keeper/          # TS: keeper loop
    notify/          # TS: Telegram bot
  app/               # Next.js web app
  data/ scripts/     # existing mainnet scan (kept as reference + regression fixtures)
  docs/              # README, THREAT_MODEL.md, PITCH.md, this spec
```

---

## 8. Work split

The interface between the two halves is fixed first: **contract method signatures, event schemas, and view return shapes (§3).** Both people work against `packages/core/types.ts`, generated from the contract ABI (`cargo near abi`).

| | **Builder A: chain** | **Builder B: data and product** |
|:--|:--|:--|
| Owns | `contracts/instance`, `contracts/factory`, `contracts/tests`, `packages/keeper` | `packages/report`, `packages/core` (builders, preflight, maths), `packages/notify`, `app/` |
| First | Instance state, events, lanes and tiers, release path (§3.1–3.3), with tests | Port `deeper.py` to `report`, regression-tested against `data/`; Report screen |
| Then | Escalation (§3.4), standing and notice (§3.5), records (§3.6), with tests | Fix-this proposal builders, Setup screen, wallet flow on testnet |
| Then | Factory and setup paths (§4); deploy global code and factory to testnet | Get-paid, Council inbox, Board screens wired to views and events |
| Then | Keeper; invariant property tests; THREAT_MODEL.md | Seat watch, Preflight, Ecosystem screen, Telegram notifications |
| Together | Testnet DAO with 3 council members; end-to-end run of every flow; demo video; README; pitch fixed to what's built | (same) |

**Hand-off points:**
- (1) ABI and events frozen → B builds UI against a mocked contract.
- (2) Instance on testnet → B swaps mocks for real calls.
- (3) Factory on testnet → B's Setup screen files real proposals.

---

## 9. Build order (dependency order, not dates)
1. Freeze interfaces (§3 signatures, events, views) → `core/types.ts`.
2. Instance core plus tests ∥ report port plus regression tests.
3. Escalation and standing plus tests ∥ Fix-this builders plus Report and Setup UI.
4. Factory, global code, testnet deploy ∥ inbox, get-paid, board.
5. Keeper, seat watch, preflight, notifications, ecosystem view.
6. Testnet DAO end-to-end, threat model, README, video, pitch.

---

## 10. Still to check
1. **Kill check:** read the four Social Money entries (Petty Cash, Patch Fund, Chai Pot, NDBOT) and the Trezu roadmap for overlap with objection lanes or protected standing payments.
2. Event rules and submission fields on the event site.
3. Mainnet USDC/USDT storage deposit amounts and whether they auto-register (affects §3.3 step 2).
4. That `ft_on_transfer` in the factory can create an account, attach global code and initialise within the gas limit; otherwise split into `create` + a fund callback chain.
5. Trezu: does its UI display `FunctionCall` proposals to arbitrary contracts clearly? (Affects how setup looks to Trezu users.)
6. Optional: ask one or two active DAO operators (e.g. open-web-academy, nearuaguild) whether they'd vote in a lane.
