# Nutus — Threat model

Scope: the on-chain contracts (`contracts/instance`, `contracts/factory`) and how they interact with Sputnik DAO v2 and NEP-141 tokens. Off-chain parts (report, keeper, UI, notifications) hold no keys that move money, so a compromise there can only mislead people or delay calls that anyone can make.

## Assets

| Asset | Where | Who may move it |
|:--|:--|:--|
| Payout budget (per token) | Instance `TokenBook.balance` | Release / approve paths, DAO `withdraw` (only `available`) |
| Reserved money | `TokenBook.reserved` | Only the payout or standing transfer it belongs to |
| Committed notice | `TokenBook.committed_notice` | Only notice payments of the standing payment it belongs to |
| Standing buffers | `TokenBook.standing_buffer` | That standing payment; released back to `available` on stop/end |
| Bond float (spare NEAR) | Instance account balance beyond storage, NEAR budget and held deposits | Escalation bonds only |
| Filers' deposits | `deposits_held` | Refunded to the filer; storage and token registration costs only |
| Records | `Record` per recipient | Only Paid payouts, approved escalations, DAO-voted seeds |
| Factory NEAR | Factory account | Sponsoring new instance accounts (USDC path) |

## Invariants

| ID | Statement | Enforced by | Tested by |
|:--|:--|:--|:--|
| I1 | `balance ≥ reserved + committed_notice + standing_buffer` for every token, after every call and callback | Every book write goes through `put_book`, which panics otherwise | Unit tests; property test after every step; sandbox `assert_i1` |
| I2 | `withdraw` never reduces `committed_notice`, whoever calls it | `withdraw` only takes from `available` | `withdraw_cannot_touch_committed_notice`, `dao_cannot_withdraw_notice_after_stop`, property test, sandbox `standing_payment_notice_is_guaranteed` (through a real DAO proposal) |
| I3 | A payout enters `Sending` at most once | `start_send` only from `Waiting`; callback requires `Sending` | `double_release_refused`; property test (Sending ⇔ callback pending); sandbox `small_payout_released_after_window` |
| I4 | Only the DAO can configure, fund, pause, withdraw or seed records | `assert_dao` on each; `ft_on_transfer` refunds non-DAO senders | `dao_only_methods_refuse_others` (every method), `ft_funding_only_from_dao` |
| I5 | Every record point references a real Paid payout or DAO proposal | Points only in `on_sent` (Paid), `on_escalation_proposal` (Approved), `seed_records` (DAO vote, deduped) | Property test checks every source; `seed_records_counts_each_proposal_once` |

The property test also checks exact accounting after every step: `reserved` = open payouts + standing money in flight; `standing_buffer` and `committed_notice` = the per-payment shares; `deposits_held` = open payouts' deposits; each lane's `open_payouts` count; and the token balance against an outside model.

## Threats by actor

### Outsider (no role)

| Attack | Result | Why |
|:--|:--|:--|
| Call DAO-only methods | Panics `ONLY_DAO` | I4 |
| Send tokens to the instance pretending to fund | Refunded in full by `ft_on_transfer` | Only the DAO (or its factory with `"fund"`) is booked |
| A fake token claims `sender_id = dao` in `ft_on_transfer` | Creates a book for the fake token only | Books are per token contract (`predecessor`); lanes only pay in tokens the DAO configured |
| Trigger `release` / `escalate` / `pay_due` / `sync_council` / `settle_escalation` | Allowed by design | Each only does what is already due; time and state checks gate them |
| Spam `file_payout` | Each filing costs the filing deposit, which pays its own storage | Lanes can restrict filers (`Members`, `DaoMembersOfRole`) |
| Drain the factory by creating instances | Refused | Factory accepts setup only from allow-listed tokens and from DAOs that are direct children of allow-listed DAO factories (a Sputnik DAO costs ~5 NEAR to make); one instance per DAO |
| Front-run a release with an objection at the deadline | Impossible to do both | `object` needs `now < deadline`, `release` needs `now ≥ deadline` |

### Filer

| Attack | Result | Why |
|:--|:--|:--|
| File above the lane's limits | `USE_FULL_VOTE` | Tier check against `medium_max` |
| Split a large payment into many small ones | Bounded | Period cap per lane; each small payout is still objectionable |
| Pay themselves (filer = recipient) | Allowed, but visible on the public board and objectionable | Self-approval of Medium is refused (`SELF_APPROVAL`) |
| Cancel after the window to dodge an objection | Only `Waiting` payouts can be cancelled; objected ones only by the DAO | `cancel_payout` |

### Council member

| Attack | Result | Why |
|:--|:--|:--|
| Approve their own Medium payout | Refused | `SELF_APPROVAL` (recipient or filer) |
| Collude with a filer to approve Medium payouts | **Possible up to `medium_max` per payout and the period cap** | By design: Medium = first approver. DAOs choose `medium_max` and the cap; the board shows who approved what |
| Object to everything (griefing) | Each objection becomes a normal DAO proposal; nobody is blocked from being paid by the DAO | Objection only moves the decision back to the DAO |
| Object after the window | Refused | `WINDOW_CLOSED` |
| Seat goes silent | Silence never stops a Small payout; Medium escalates after the timeout | Default-pay and timeout paths |

### DAO (the owner, acting by vote)

| Attack | Result | Why |
|:--|:--|:--|
| Withdraw locked notice to stiff a contributor | Refused, even by DAO vote | I2 (`withdraw` only from `available`) |
| Pause to stop notice payments | Notice still pays while paused | `pay_due` skips the pause check for `Noticed` |
| Remove a lane with open payouts / swap its token | Refused | `open_payouts` must be 0 |
| Change a lane's window to shorten an open objection window | No effect on existing payouts | `deadline_ns` fixed at filing |
| Inflate records | Only through a voted `seed_records`, one point per proposal id | I5; every point is public and traceable |

### Recipient

| Attack | Result | Why |
|:--|:--|:--|
| Be unregistered with the token to make payouts fail | Registration is paid on release; if a transfer still fails the payout becomes `Failed` and the budget is restored | Atomic `storage_deposit` + `ft_transfer` batch; `on_sent` failure path |
| Be unregistered so an *escalated* payout's DAO proposal fails (and Sputnik keeps the bond) | Escalation registers the recipient first, from the filer's deposit | `on_policy_for_escalation`; sandbox `objection_becomes_a_real_dao_proposal` (found by that test) |
| Game the record ladder | Steps only rise with paid jobs; objections freeze step-ups for 90 days | `small_limit` with `jobs_at_last_objection` |

### Token contract

The instance trusts the NEP-141 tokens the DAO configured in its lanes to behave as NEP-141 says. A malicious token chosen by the DAO could misreport transfers for its own book only. It can't touch other tokens' books or NEAR.

### Factory and builders

| Concern | Answer |
|:--|:--|
| Builders change a DAO's instance | Impossible: instances run global code **by hash**; there is no upgrade or admin method on the instance or the factory |
| Factory changes its own rules | All factory settings are fixed at init; no setters |
| Bug in instance code | Can't be patched in place (the same immutability). The DAO can `pause` and `withdraw` everything in `available`; committed notice keeps paying out as promised. A fixed version ships as a new factory and hash |

## Residual risks (known, accepted or open)

1. **Callback out of gas.** If a callback (`on_sent`, `on_standing_sent`, `on_withdrawn`) ran out of its static gas, the payout would stay `Sending` with its amount reserved. Gas is set well above the measured use (testnet setup chain: ~37 TGas total). **Open:** a DAO-only recovery for a payout stuck in `Sending` past a timeout.
2. **Sputnik keeps the bond on a `Failed` proposal** (seen on testnet). An escalated Transfer that fails at execution costs the bond float one bond. Preflight keeps this rare.
3. **`silent_can_object` is advisory.** Seat silence is computed off-chain; the contract lets every listed objector object.
4. **One colluding council member** can release Medium payouts up to `medium_max` per payout and the period cap (see Council member).
5. **Validator clock drift.** Windows use `block_timestamp`; drift is seconds against windows of hours.
6. **Token-weighted DAO roles** can't be listed on chain, so `sync_council` only uses Group roles and refuses to leave the council empty.
