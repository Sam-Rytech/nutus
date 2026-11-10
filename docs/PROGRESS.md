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
| Interfaces frozen | A → B | [~] ABI committed; B to generate types.ts. H2/H3 ready: `deployments/testnet.env` |
| Instance contract | A | [x] every §4.5 method implemented and tested; v2 live on testnet |
| Factory and setup | A | [x] v2 factory on testnet; demo DAO set up through a real proposal |
| Contract tests | A | [x] 84 instance + 15 factory unit, property test (I1–I5), 8 sandbox scenarios vs real Sputnik (CI) |
| Keeper | A | [x] `packages/keeper`; hourly GitHub Actions round as keeper.nutus-dev.testnet (needs the `KEEPER_PRIVATE_KEY` secret) |
| Report port | B | [~] rebuilt from scratch (old scan lost); `packages/report` + `DEFINITIONS.md`; mainnet rescan running |
| Core (builders, preflight, maths) | B | [x] `packages/core`: ABI types, client, threshold maths, builders, preflight (19 tests, live-checked) |
| Web app | B | [~] all six screens live at https://nutus.vercel.app (testnet v2); wallet signing not yet exercised |
| Seat watch | B | [x] silent seats + freeze distance in the report and the council inbox; seat changes drafted, never filed |
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
- [x] **A** `cargo near abi` → ABIs committed in `packages/core/abi/` (instance: 40 functions, factory: 9). Regenerate with `sh scripts/abi.sh`
- [x] **B** Generate `packages/core/types.ts` from `packages/core/abi/*.json` — **H1: interfaces frozen** (`pnpm --filter @nutus/core gen` → `src/generated/`)
- [x] **B** ~~Mock contract client~~ Not needed: the app reads the live testnet instance through the typed client
- [x] **AB** Kill check: read Social Money entries (Petty Cash, Patch Fund, Chai Pot, NDBOT) and the Trezu roadmap; record findings below. **Not killed** — see *Kill check (2026-11-10)*
- [x] **AB** Recheck event rules and submission fields on the event site — see *Event rules (2026-11-10)*. **Deadline 14 Nov 23:59 UTC; repo must be public**

## Phase 2: Core build (in parallel)
**A: Instance contract**
- [x] State, TokenBook, I1 accounting helpers (`put_book` checks I1 on every write)
- [x] Funding: `ft_on_transfer` (DAO-only; `fund`, `fund_standing:<id>`), `fund_near`, `fund_bond_float`
- [x] Lanes: `configure_lane`, `remove_lane`, period cap and reset
- [x] `file_payout`: tier check, record step, cap, reserve, anti-spam deposit (payout storage paid from it)
- [x] Release path: `release`, recipient storage registration, `ft_transfer` / NEAR, `on_sent` callback (Paid / Failed, budget restored)
- [x] `object` (window, objectors), `approve` (Medium). `silent_can_object` is advisory only (see decisions)
- [x] `pause` / `unpause`, `withdraw` (I2), `set_bond_float`
- [x] Views
- [x] Unit tests for each (52 in `contracts/instance/src/tests.rs`)

**B: Report and core**
- [x] RPC reader: `get_proposals` paging, `get_policy`, JSON-file cache (not SQLite), 429 back-off
- [x] ~~Port `scripts/deeper.py`~~ The script and data are lost; F1–F5 rewritten from the spec with written definitions
- [x] ~~Regression tests reproduce the old numbers~~ **Old numbers retired** (nothing reproduces them). Fixture tests for each metric; the new scan's summary is the source for the pitch
- [x] Vote-threshold maths (Weight / Ratio `num*total/den + 1`, quorum floor) with tests
- [x] Report screen (live RPC, any DAO, mainnet or testnet)

## Phase 3: Escalation, standing, records
**A**
- [x] Escalation: `get_policy` → bond → `add_proposal(Transfer)` → `Escalated`; `needs_manual_filing` fallback (done early, with Phase 2)
- [x] `escalate` (Medium timeout, and retry of `needs_manual_filing`)
- [x] Standing: `add_standing`, `fund_standing:<id>` (+ `fund_standing_near`), `pay_due`, `stop_standing`, notice from committed money, `standing_short`, `standing_failed`, end date
- [x] Records: `set_record_steps`, `seed_records` (one point per proposal id), `settle_escalation`, objection cooldown
- [x] `sync_council` from DAO policy (also caches Group role members for role-based filers)

**B**
- [~] Fix-this builders: lane setup (budget from trailing spend) ✓, seat changes ✓, policy role grant ✓, `seed_records` builder ✓ (not yet drafted from history), standing from repeat series (described, not drafted)
- [x] Setup screen: review → checks (balance, existing instance, AddProposal permission, council) → file via wallet
- [x] Preflight: `storage_balance_of` (rewrites to storage_deposit + ft_transfer), DAO balance, missing NEAR recipient. Wrap-NEAR not done

## Phase 4: Factory and testnet
**A**
- [x] Factory: global code by hash, `create` (NEAR path), `ft_on_transfer` setup (USDC path), refund on failure (15 unit tests)
- [x] Verify gas: create + global code + init + forward in one `ft_on_transfer` — yes, ~37 TGas for the whole chain on testnet
- [x] Deploy global code, factory and test tokens to testnet — **H2/H3**: addresses in `deployments/testnet.env` and `docs/TESTNET.md`
- [x] Testnet DAO with 3 council members (Sputnik v2): `nutus-demo.sputnikv2.testnet`

**B**
- [x] Live testnet calls throughout
- [x] Get-paid screen (tier and timing preview from lane + record)
- [x] Council inbox (Object, Approve, release / escalate / settle / pay_due, short buffers, seat health, manual-filing list). Finalize-to-recover-bond not shown
- [x] Public board (views; the objection window as a live time bar)

## Phase 5: Integration tests and hardening
**A**
- [x] near-workspaces with real Sputnik wasm: setup via real proposal (USDC and NEAR), refund on failed setup (`contracts/tests`, 8 scenarios, CI)
- [x] Boundaries: small / medium / full vote (sandbox), record steps, cap reset (unit)
- [x] Objection in window → real proposal with the right kind, amount and description; bond returns on approve, reject and expire-then-finalize (sandbox)
- [x] Objection after window refused; non-objector refused
- [x] Medium approve and timeout
- [x] Double release no-op; failed transfer restores budget
- [x] Standing: periods, notice, `withdraw` into notice refused even from the DAO (through a real DAO proposal)
- [x] Pause semantics; `sync_council` with a custom policy; `settle_escalation`
- [x] Property test: random sequences, I1–I5 after every step (plus exact accounting vs an outside model; callbacks out of order; coverage guard)
- [x] Keeper: release / escalate / pay_due / settle, idempotent (17 tests; skips short buffers and manual-filing cases instead of burning gas)
- [x] `THREAT_MODEL.md` (actors, invariants → tests, residual risks)
- [x] Stuck-transfer recovery: DAO-only `resolve_stuck_payout` / `resolve_stuck_standing` after 24 h in flight (unit + property tests)
- [x] Hosted keeper: `.github/workflows/keeper.yml`, hourly, as `keeper.nutus-dev.testnet`

**B**
- [x] Seat watch: silent in 60 days, freeze distance, drafted seat proposals (person files)
- [x] Ecosystem screen (mainnet scan: 174 DAOs, 8,339 proposals)
- [ ] Telegram notifications (account link by signature; window, shortfall, quiet seat, bond to recover)
- [ ] UI pass: HIG structure, self-hosted fonts, legal pages, empty and error states

## Phase 6: End-to-end, docs, submission (AB)
- [ ] Run every flow on the testnet DAO with real transactions; log tx hashes below
- [ ] Every Fix-this proposal files and executes on the demo DAO
- [ ] Preflight fixes an unregistered recipient end to end
- [x] README (setup, trust statement, how to run keeper)
- [ ] Demo video (60s script in the plan)
- [ ] PITCH.md trimmed to verified claims only
- [ ] Optional: ask 1–2 active DAO operators whether they'd vote in a lane; quote if yes
- [ ] Submit

---

## Open questions
| # | Question | Owner | Status |
|:--|:--|:--|:--|
| Q1 | Mainnet USDC/USDT storage deposit amount; auto-registration? | A | [x] Both `storage_balance_bounds` min = max = 0.00125 NEAR (read on mainnet 2026-11-10); no auto-registration, so Nutus registers recipients on release and on escalation |
| Q2 | Can one `ft_on_transfer` create, attach global code, init and forward within gas? | A | [x] Yes. Whole chain burned ~37 TGas on testnet (create batch 10.4) |
| Q3 | How does Trezu display FunctionCall proposals to arbitrary contracts? | B | [ ] |
| Q4 | Overlap with the four Social Money entries / Trezu roadmap? | AB | [x] Partial overlap with Petty Cash on fast small payouts; nothing else close; Trezu has none of our features. See *Kill check* |
| Q5 | Instance name = first label of the DAO account (`x.sputnik-dao.near` → `x.nutus.near`). Two DAOs with the same first label under different factories would collide; hash or full-name scheme? | A | [x] Factory only accepts direct children of allow-listed DAO factories; a collision fails account creation and refunds the DAO |
| Q6 | Native `cargo test` on Windows needs the aws-lc toolchain (via near-sdk → near-crypto) | A | [x] `AWS_LC_SYS_PREBUILT_NASM=1` (README) |

## Kill check (2026-11-10)

**Verdict: not killed, but the pitch must lead with what only Nutus does.** Fast small payouts on Sputnik are no longer unique.

| Entry | What it is | Overlap with Nutus |
|:--|:--|:--|
| [Petty Cash](https://github.com/kasbsquall/petty-cash) (Social Money + Real-World Money) | DAO pre-approves budgets with rules (holders, per-payment cap, per-period cap, categories, end date). In-rule spends are paid in seconds via a `pettycash` DAO role that approves its own Transfer proposal; out-of-rule spends become ordinary DAO proposals; anyone can `settle`. One shared contract (`pettycash.testnet`), money stays in the DAO treasury, testnet only, monthly CSV report. | **Real, on one pillar:** small payouts without a council vote, period caps, escalation as a normal proposal, settle. **None** of: objection windows, Medium tier, records/reputation, standing pay with locked notice, seat watch, preflight, network evidence. |
| [Patch Fund](https://github.com/emilhuseyn/patchfund-demo-target) | Security bug bounties paid from a DAO when the fix PR merges. | Low: bounty payouts, not budgets/recurring pay. |
| Chai Pot | No NEAR entry found. The only "Chai Pot" projects are a PayPal AI Hackathon group wallet and a self-help-group savings agent. | None found. |
| NDBOT | Telegram trading bot for NEAR memecoins (lists Social Money among four tracks). | None. |
| [Trezu](https://github.com/NEAR-DevHub/trezu) (README + all open milestones) | Treasuries, single/bulk payments, Intents, vesting schedules, lockup dashboard, confidential treasury, Telegram notifications, staking/vaults planned. | **None of ours** in README or milestone descriptions: no objection/default-pay, no spending limits that skip a vote, no recurring pay with guarantees, no notice locks, no reputation, no seat health, no pre-vote payment checks. Partial: vesting only. Individual issues not read. |

Also seen in search (not read): Hat Tip ("three approval tiers in a Sputnik DAO"), FairShare, AllTogether, Koperasi. The track's own example prompt is *tiered approvals + reputation from finished bounties*, so expect several tier/reputation entries.

**What only Nutus does (lead with these):**
1. **Silence never kills a payout:** objection windows (default-pay, any council member can stop it) and Medium timeouts that file a normal DAO proposal. Petty Cash auto-pays inside rules with no objection path.
2. **Guaranteed notice for recurring pay:** money locked so even a DAO vote can't withdraw it; paid while paused. Nobody else has standing pay at all.
3. **Payouts that don't fail:** recipient registered on release and on escalation (found by our sandbox suite; Petty Cash pays registration too, Trezu has an open P0 about bulk USDC payouts going missing).
4. **Evidence from mainnet:** the scan (138 DAOs, 5,941 proposals) and seat watch — no other entry measures the problem. *Depends on Builder B's report.*
5. Records traceable to real payments that raise limits (the track's own example — expect competition here).

**Honest differences to be ready for:** Petty Cash keeps money in the DAO treasury until each payment; Nutus moves a budget into the instance (so it can lock notice and reserve amounts). Petty Cash deleted its contract's access keys; Nutus instances are global code by hash with no keys, which is the same guarantee.

## Event rules (2026-11-10)

Source: [nearhackathon.com](https://nearhackathon.com/), [Social Money brief](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/12-social.md).

- **Deadline: 14 Nov 2026 23:59 UTC** (development ends). Judging 16–18 Nov.
- **Repository must be public** ("Judges can't open a private one"). Sam-Rytech/nutus is private today.
- **Demo post on X** tagging @NEARProtocol and #NEARHackathon, with video or screenshots. Both the repo link and the post link are required.
- Form: project name, team lead, email, team size, tracks (multi-select allowed), NEAR wallet for the prize, repo, demo post, "What did you build?" (20–2,000 chars), optional website.
- **Screening: Claude Code and Codex check every project "runs and does what the README says"** before human judges. The README must only claim what runs.
- No rule on mainnet vs testnet, deployed contracts or video length. Up to 2 projects per person.
- Prizes per track: $10K / $3K / $2K, paid in NEAR; one $55K grand prize.

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
| 2026-11-09 | Bond float = **spare NEAR** (balance − storage − NEAR budget − held deposits), not a stored counter. `set_bond_float` sets a warning target; anyone tops up with `fund_bond_float` | Sputnik returns bonds as plain transfers with no callback, so a counter would drift |
| 2026-11-09 | `silent_can_object` stored but not enforced on chain | Seat silence is computed off-chain; enforcing it would need an oracle |
| 2026-11-09 | Payout stores `deadline_ns` at filing | Changing a lane's window later can't move an existing deadline |
| 2026-11-09 | During the 90-day objection cooldown the record step uses `jobs_at_last_objection` | "Step-ups pause" without stepping anyone down |
| 2026-11-09 | Filing deposit pays the payout's own storage; the rest is refunded on Paid / Failed / Escalated / Cancelled (minus 0.00125 NEAR token registration on a Paid FT payout) | Storage stays staked after a payout closes |
| 2026-11-09 | Release sends `storage_deposit` + `ft_transfer` as one atomic batch | A failed transfer reverts the registration too, so the full deposit can be refunded |
| 2026-11-09 | A Small payout above the recipient's record step becomes Medium, not a panic | Spec §3.7: Small = ≤ min(small_max, record step) |
| 2026-11-09 | `pause` stops regular standing payments but **not** notice payments | Notice is the promise the code keeps; a DAO pause can't break it |
| 2026-11-09 | `stop_standing` returns the unused regular buffer to `available`; `Ended` releases any unused notice and buffer | Only the notice is guaranteed; the rest is the DAO's money again |
| 2026-11-09 | Standing money in flight moves to `reserved` until the callback | I1 and `available` stay exact during async transfers; failures put it back where it came from |
| 2026-11-09 | `sync_council` = Group roles with `transfer:VoteApprove` (or a wildcard); token-weighted roles skipped; refuses to leave the council empty | Only Group roles can be listed; an empty council would block all objections |
| 2026-11-09 | `settle_escalation`: Approved → record point; any other final status → `Settled{approved:false}`; `InProgress` refused | Sputnik `Failed` means approved but not executed, so not paid |
| 2026-11-09 | Fixed: Sputnik `get_proposal` returns `id` as a JSON number; `Proposal` no longer reads it | Would have broken `settle_escalation` on chain; now covered by a JSON-shape test |
| 2026-11-09 | Factory accepts setup only from allow-listed tokens and DAOs that are direct children of allow-listed DAO factories (fixed at init) | The USDC path spends the factory's NEAR (0.25 per instance); without this anyone could drain it with a junk token |
| 2026-11-09 | No set-up fee: the factory sponsors USDC-path instance accounts; the NEAR path pays its own storage | Simpler and honest to pitch; revisit only if the factory runs low |
| 2026-11-09 | Instance `new` is payable (NEAR path budget) and its `ft_on_transfer` also accepts `"fund"` from its own factory | The factory forwards the DAO's setup tokens; the factory's code is fixed by hash, so this adds no trust |
| 2026-11-09 | Token-path setup: create batch → forward with `ft_transfer_call` → return what the instance didn't take | If any step fails, `ft_resolve_transfer` returns the tokens to the DAO |
| 2026-11-09 | Test-only NEP-141 in `contracts/test-token` (anyone can mint) | Testnet demo and Phase 5 integration tests need a token we control |
| 2026-11-09 | The factory registers itself once with each setup token at deploy | Found on testnet: `ft_transfer_call` to an unregistered factory panics, failing the whole setup proposal. Registering once keeps setup at one proposal, two actions |
| 2026-11-09 | Global instance code costs ~33.5 NEAR (335 KB, burned) | Measured on testnet; matches 10 NEAR / 100 KB. One-off, same on mainnet |
| 2026-11-09 | Sandbox tests copy the Sputnik v2 wasm from a live testnet DAO at test time | Tests run against the code DAOs actually use, without vendoring a binary |
| 2026-11-09 | Test token gets a `#[private]` `deploy_global` | near-workspaces 0.24 can't publish global contract code |
| 2026-11-09 | Escalation registers the recipient with the token (from the filer's deposit) | Found by the sandbox suite: the DAO's Transfer to an unregistered recipient fails at execution and Sputnik keeps the bond |
| 2026-11-10 | Stuck transfers: the DAO settles by vote after 24 h in flight (`resolve_stuck_*`), through the callback's own code; standing transfers store what's in flight (`in_flight` replaces `sending`) | The contract can't tell if a transfer landed when its callback is lost; a person checks the explorer, the DAO votes, and a late callback is refused |
| 2026-11-10 | Report rebuilt from the spec; earlier scan figures (138 DAOs, 5,941 proposals, 24% vs 3%, …) **retired** | `scripts/deeper.py` and `data/` were never in the repo and can't be found; the pitch may only quote what `pnpm --filter @nutus/report scan` reproduces |
| 2026-11-10 | F1/F2 count a proposal's payment only when it makes exactly one | First scan: one test DAO with 200 transfers per proposal produced 1,209 of 1,222 "lapsed small payments" |
| 2026-11-10 | Times measured between proposal submissions | Sputnik stores who voted, not when |
| 2026-11-10 | Web app is Vite + React (static), not Next.js | Every screen reads public chain data and signs in the wallet; no server needed; faster to build and host |
| 2026-11-10 | MyNearWallet only | The Meteor module needs Node's Buffer in the browser and crashes the app |
| 2026-11-10 | pnpm overrides pin vite 8.3.6 / rolldown 1.2.16 | Keeps every install inside pnpm's minimum release age instead of waiving the check |
| 2026-11-10 | App deployed to Vercel as a static build (`pnpm --filter @nutus/app deploy`) | Built locally from the monorepo; SPA rewrite in `app/public/vercel.json` |
| 2026-11-10 | Hosted keeper = hourly GitHub Actions run | Free, no server; windows are 48 h, so hourly is plenty |
| 2026-11-09 | Keeper never retries `needs_manual_filing` or short standing buffers | Both would fail again and burn gas until a person acts |
| 2026-11-09 | Spec V2 needs a note: Sputnik kept the 1 NEAR bond when a proposal's execution **Failed** (proposal 0 on testnet) | V2 lists approve / reject / expire as refunding. A failed escalation would cost the bond float its bond; keep failures rare with preflight |

## Testnet log
| Date | Action | Tx / account | By |
|:--|:--|:--|:--|
| 2026-11-09 | Instance code deployed as global contract (hash `9C622Ttng5hKSgv2KYVZBSTTk8THdaW8szvAKkuq4jo9`) | `FiJgcrxrYV4CDrWU79Ufsp9bmas3h6ddVAHqUMm4aSd6` | A |
| 2026-11-09 | Council accounts c1 / c2 / c3.nutus-dev.testnet | `H8F6K9ZCZefMkLYbdpEM2Xf1AY6UEpcL72iZdu9DazCw`, `HLePzArZCkfPXgetxK65mVw2fMyFta4YXbyC9aMJN9sd`, `CscZScbUkfiwKf8DJMdhYyS24X3JLWwDdyLa4661vTMu` | A |
| 2026-11-09 | Test token tusdc.nutus-dev.testnet deployed | `4dAmSfkpumQop2c3gHEAoMMLhgeZz1CJdZaQoqzFfq4q` | A |
| 2026-11-09 | Factory nutus.nutus-dev.testnet deployed | `AXKcsDSRgB9q5t4WTDZ2rJUf5whR59Wce6FhfkKz6dTj` | A |
| 2026-11-09 | Demo DAO nutus-demo.sputnikv2.testnet created | `7HJ6DMXTqVzvLY8U87pLmtQYiZskrjEc8AuVegpYHvWB` | A |
| 2026-11-09 | 10,000 tUSDC minted to the DAO | `ALvAqbAGghbyBM6dFCFtdXybtKHqvfGnTFC4uxRas77A` | A |
| 2026-11-09 | Setup proposal 0 **failed** (factory not registered with tUSDC); bond kept by Sputnik | `HCsoukgcRKKGdBquiuSwwFyxu1ZvUk9xcqQM4rCghyns` | A |
| 2026-11-09 | Factory registered with tUSDC | `8M77YfKCfhhUqPzryjeqLyYj4KgS2onBwrbeJknFgck6` | A |
| 2026-11-09 | Setup proposal 1 filed by c1 | `2vFSWH5o5Nvn6kfMkipEe3uyv5AzbZBhxYg7gJkN974Y` | A |
| 2026-11-09 | c2 approves | `HB8WhZJuHYW8Lmypq19VdUbmQ3nz7gbh9nLdtRFkJq1r` | A |
| 2026-11-09 | c3 approves → instance nutus-demo.nutus.nutus-dev.testnet created and funded with 5,000 tUSDC (~37 TGas) | `3NgUssKdxvofTFLjaJSfKSqQygD8BAaDHPvVs2oEqTMx` | A |
| 2026-11-09 | **v2:** instance code with the escalation fix published globally (hash `3PpH8oo5K8FSecxG7Dod7ptT9dJAyusM5WgN3bxQmhAw`) | `38J71QhTr1nuisKnrrZj8Ts4YxyXPnT8RDAjYeEaW9wu` | A |
| 2026-11-09 | v2 factory v2.nutus-dev.testnet created + deployed | `8qGg4fxNXBs3wQr6DEk42PavJ71PZGAAcQUsQj76tQWt`, `6ryTi6qxJbrXJKC6HsR3uMbGbxRyDb478fd1gDB2GKRr` | A |
| 2026-11-09 | v2 factory registered with tUSDC; DAO topped up 10,000 tUSDC | `YcAdDzsw5HGvWyUXnNbYGFCn2WqMRwgrKYRKtAb9HGZ`, `73aRgrBbxwUuysaGPcsqvqLSdsn3cWMRPmfrPsppCy1y` | A |
| 2026-11-09 | Setup proposal 2 on v2: c1 files, c2 + c3 approve → nutus-demo.v2.nutus-dev.testnet with 5,000 tUSDC | `52L3UzmNyYSjA3pKUCUdPkfhnxvFMRR7xEUMG7XCGFUG`, `9t2sPtNCzuBqZpm12Phqncsz4HyiYfqWL8DReFpnxokc`, `9p8LmCDwEzTbdLoiwf1hUur5L8ryXohxxrJc21qKrM15` | A |
| 2026-11-09 | Live objection: payout #0 (50 tUSDC to unregistered nutus-fund5.testnet) filed, c2 objects → DAO proposal 3, recipient registered | `Ee2tYXA6R9vJKupVDhWNbbuLv3c6rnavDPwN6ipEWAgQ`, `7K75JTSy3YFkhbhMabcwwuUbDmzPALgAjZFzvydjWvvA` | A |
| 2026-11-09 | c1 + c3 approve proposal 3 → recipient paid 50 tUSDC by the DAO, 1 NEAR bond back to the instance | `8TiUurSaE5GY39qsJ2qodhquD54ftEo7uiXVEzCXi7D6`, `BbQCCNwrWxQem37pw1MdLy9Y3jyoJ21QFAreRsJouaM7` | A |
| 2026-11-09 | settle_escalation → payout Settled(approved), record +1 from DaoProposal 3 | `3oazo5EmFaYUvKjpiTb2Mk32EyEoHcy6A5PsFXkFWZ8V` | A |

## Blockers
_None._ (Testnet moved to v2 with the escalation fix on 2026-11-09.)
