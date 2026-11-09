# Nutus — Progress

Shared tracker for both builders. Update it in the same PR as the work.
Status keys: `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked (say why).
Owners: **A** = Chain lead · **B** = Data and product lead · **AB** = both.

| Builder | Name | GitHub | Role |
|:--|:--|:--|:--|
| A | Temitayo | Sam-Rytech | Chain lead: contracts, tests, keeper, testnet, threat model |
| B | _fill in_ | KayProject | Data and product lead: report, core, preflight, seat watch, web app, notifications |

---

## Snapshot

| Area | Owner | Status |
|:--|:--|:--|
| Planning and naming | AB | [x] done |
| Interfaces frozen | A → B | [~] stubs + ABI on `a/foundations` |
| Instance contract | A | [~] interface, views, pause |
| Factory and setup | A | [~] interface, views |
| Contract tests | A | [ ] |
| Keeper | A | [ ] |
| Report port | B | [ ] |
| Core (builders, preflight, maths) | B | [ ] |
| Web app | B | [ ] |
| Seat watch | B | [ ] |
| Notifications | B | [ ] |
| Testnet end-to-end | AB | [ ] |
| Docs, video, pitch | AB | [ ] |

---

## Phase 0: Planning (done)
- [x] Mainnet scan: 138 DAOs, 5,941 proposals, five failures measured (`data/`, `scripts/`)
- [x] Product plan and explainer
- [x] Renamed Quiet Yes → **Nutus** (2026-11-08; no clashes found)
- [x] Scope: full product, all six parts, no time-boxing
- [x] Sputnik v2 source verified: bond rules, refunds, default policy, multi-action FunctionCall, vote threshold maths
- [x] `NUTUS_SPEC.md`, `ARCHITECTURE.md`, `PROGRESS.md`

## Phase 1: Foundations
- [x] **AB** Create monorepo per the ARCHITECTURE §9 layout; CI (fmt, clippy, cargo test, wasm build + ABI drift check; pnpm job switches on once a lockfile exists). near-workspaces joins CI in Phase 5
- [~] **AB** Fill in builder names and GitHub handles above (B's name still needed)
- [x] **A** Write instance method signatures, structs and events (stubs compile): `contracts/{common,instance,factory}`; init, guards, views, pause/unpause, `set_bond_float`, `set_filing_deposit` already work
- [~] **A** `cargo near abi` → **B** generates `packages/core/types.ts` — **H1: interfaces frozen**. A: run `sh scripts/abi.sh`, ABIs land in `packages/core/abi/`
- [ ] **B** Mock contract client for UI work
- [ ] **AB** Kill check: read Social Money entries (Petty Cash, Patch Fund, Chai Pot, NDBOT) and the Trezu roadmap; record findings below
- [ ] **AB** Recheck event rules and submission fields on the event site

## Phase 2: Core build (in parallel)
**A: Instance contract**
- [ ] State, TokenBook, I1 accounting helpers
- [ ] Funding: `ft_on_transfer` (DAO-only), `fund_near`
- [ ] Lanes: `configure_lane`, `remove_lane`, period cap and reset
- [ ] `file_payout`: tier check, record step, cap, reserve, anti-spam deposit
- [ ] Release path: `release`, recipient storage registration, `ft_transfer` / NEAR, `on_sent` callback (Paid / Failed, budget restored)
- [ ] `object` (window, objectors, silent-can-object), `approve` (Medium)
- [ ] `pause` / `unpause`, `withdraw` (I2), `set_bond_float`
- [ ] Views
- [ ] Unit tests for each

**B: Report and core**
- [ ] RPC reader: `get_proposals` paging, `get_policy`, SQLite cache
- [ ] Port `scripts/deeper.py` metrics F1–F5
- [ ] Regression tests reproduce scan numbers (24%/3%, 62/136, 18 never repaid, median 35 days, 216/1,835, 46 series in 17 DAOs, 199/496, 23 + 12 frozen roles, 125 failed, 0 bounties, 95/138)
- [ ] Vote-threshold maths (Weight / Ratio `num*total/den + 1`) with tests
- [ ] Report screen (mock data → live RPC)

## Phase 3: Escalation, standing, records
**A**
- [ ] Escalation: `get_policy` → bond → `add_proposal(Transfer)` → `Escalated`; `needs_manual_filing` fallback
- [ ] `escalate` (Medium timeout)
- [ ] Standing: `add_standing`, `fund_standing:<id>`, `pay_due`, `stop_standing`, notice from committed money, `standing_short`
- [ ] Records: `set_record_steps`, `seed_records`, `settle_escalation`, objection cooldown
- [ ] `sync_council` from DAO policy

**B**
- [ ] Fix-this builders: lane setup (budget from trailing spend), standing from repeat series, `seed_records` from history, seat changes, policy role grant when restricted
- [ ] Setup screen: review → preflight → file via wallet
- [ ] Preflight: `storage_balance_of`, DAO balance, wrap NEAR, known-cause warnings; adds actions into proposals

## Phase 4: Factory and testnet
**A**
- [ ] Factory: global code by hash, `create` (NEAR path), `ft_on_transfer` setup (USDC path), refund on failure
- [ ] Verify gas: create + global code + init + forward in one `ft_on_transfer` (else split)
- [ ] Deploy global code, factory and test tokens to testnet — **H2/H3**
- [ ] Testnet DAO with 3 council members (Sputnik v2)

**B**
- [ ] Swap mocks for live testnet calls
- [ ] Get-paid screen
- [ ] Council inbox (Object, Approve, standing due/short, seat and preflight warnings, finalize to recover bond)
- [ ] Public board (events + views)

## Phase 5: Integration tests and hardening
**A**
- [ ] near-workspaces with real Sputnik wasm: setup via real proposal (USDC and NEAR), refund on failed setup
- [ ] Boundaries: small / medium / full vote, record steps, cap reset
- [ ] Objection in window → real proposal with the right kind, amount and description; bond returns on approve / reject / finalize
- [ ] Objection after window refused; non-objector refused
- [ ] Medium approve and timeout
- [ ] Double release no-op; failed transfer restores budget
- [ ] Standing: periods, notice, `withdraw` into notice refused even from the DAO
- [ ] Pause semantics; `sync_council` with a custom policy; `settle_escalation`
- [ ] Property test: random sequences, I1–I5 after every step
- [ ] Keeper: release / escalate / pay_due / settle, idempotent
- [ ] `THREAT_MODEL.md`

**B**
- [ ] Seat watch: status bands, freeze distance, drafted seat proposals (person files)
- [ ] Ecosystem screen
- [ ] Telegram notifications (account link by signature; window, shortfall, quiet seat, bond to recover)
- [ ] UI pass: HIG structure, self-hosted fonts, legal pages, empty and error states

## Phase 6: End-to-end, docs, submission (AB)
- [ ] Run every flow on the testnet DAO with real transactions; log tx hashes below
- [ ] Every Fix-this proposal files and executes on the demo DAO
- [ ] Preflight fixes an unregistered recipient end to end
- [ ] README (setup, trust statement, how to run keeper)
- [ ] Demo video (60s script in the plan)
- [ ] PITCH.md trimmed to verified claims only
- [ ] Optional: ask 1–2 active DAO operators whether they'd vote in a lane; quote if yes
- [ ] Submit

---

## Open questions
| # | Question | Owner | Status |
|:--|:--|:--|:--|
| Q1 | Mainnet USDC/USDT storage deposit amount; auto-registration? | A | [ ] |
| Q2 | Can one `ft_on_transfer` create, attach global code, init and forward within gas? | A | [ ] |
| Q3 | How does Trezu display FunctionCall proposals to arbitrary contracts? | B | [ ] |
| Q4 | Overlap with the four Social Money entries / Trezu roadmap? | AB | [ ] |
| Q5 | Instance name = first label of the DAO account (`x.sputnik-dao.near` → `x.nutus.near`). Two DAOs with the same first label under different factories would collide; hash or full-name scheme? | A | [ ] |
| Q6 | Native `cargo test` on Windows needs the aws-lc toolchain (via near-sdk → near-crypto) | A | [x] `AWS_LC_SYS_PREBUILT_NASM=1` (README) |

## Decisions log
| Date | Decision | Why |
|:--|:--|:--|
| 2026-11-08 | Name: **Nutus** | Latin "a nod / a command"; no clashes found |
| 2026-11-08 | Full scope, all six parts | Builder call: time is not the constraint |
| 2026-11-08 | Global contract **by hash** for instances | Immutable, so nobody (including us) can change a DAO's instance; ≈0.2 NEAR per instance |
| 2026-11-08 | Setup = one FunctionCall proposal per budget token | Sputnik allows multi-action FunctionCall to one receiver |
| 2026-11-08 | Escalation pays the DAO's exact bond from a bond float | `add_proposal` requires deposit == bond; refunded on approve / reject / finalize |
| 2026-11-08 | Records = Nutus Paid + settled escalations + DAO-voted seed | Every point traceable; no invented score |
| 2026-11-08 | Recipient storage registered on release from the anti-spam deposit | Removes the commonest "approved but not paid" cause |
| 2026-11-08 | Seat watch drafts; a person files | Never removes anyone itself |
| 2026-11-09 | Record steps are **per lane** (`set_record_steps(lane_id, steps)`) | Steps are in token units and lanes can use different tokens |
| 2026-11-09 | Payout statuses add `Escalating` (async in flight) and `Settled{approved}` | Blocks double escalation during async calls; gives `settle_escalation` a terminal state |
| 2026-11-09 | Added `cancel_payout` (filer or DAO, Waiting only), `set_filing_deposit`, `get_lane`, `get_payout`; `escalate` also retries `needs_manual_filing` | Spec listed `Cancelled` with no method; deposit needs a setter; UI needs single lookups |
| 2026-11-09 | Shared Rust types in `contracts/common` (`SetupConfig`, `LaneConfig`, `Filers`, `RecordStep`) | Factory and instance accept the same setup JSON |
| 2026-11-09 | Ids and times are `U64` strings in JSON; amounts `U128` strings | JS number precision |

## Testnet log
| Date | Action | Tx / account | By |
|:--|:--|:--|:--|
| | | | |

## Blockers
_None yet._
