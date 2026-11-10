# How the report measures things

Everything comes from public Sputnik DAO v2 views over RPC: `get_dao_list` on the factory, then each DAO's `get_policy`, `get_last_proposal_id` and `get_proposals`. No indexer, no private data. `pnpm --filter @nutus/report scan` reproduces the numbers; `pnpm --filter @nutus/report dao <account>` runs the same metrics on one DAO.

**One limit shapes everything below:** Sputnik stores *who* voted on a proposal but not *when*. So times are measured between proposal **submission** times, and "silent" means "didn't vote on any recent proposal", not "hasn't voted since date X".

## Scope

- **DAOs:** every DAO on the factory (`sputnik-dao.near`) with at least `MIN_PROPOSALS` (10) proposals **submitted** in the last `WINDOW_DAYS` (365) days.
- **Proposals:** those submitted inside the window. Older proposals are not read.

## Payments

A payment is a `Transfer` proposal (token `""` = NEAR), or a `FunctionCall` proposal whose actions include **exactly one** `ft_transfer` / `ft_transfer_call` (a "fixed" payment that registers the recipient first, say). **Bulk proposals** — several transfers in one vote — are left out of F1 and F2: they're a different flow, and counted per transfer they let one DAO swamp the rates (the first scan found a test DAO with proposals of 200 transfers each).

- **Small / large:** a payment is **small** if its amount is at or below the median amount of that DAO's payments **in the same token** (inside the window); otherwise large. Per DAO and token, so no prices are needed and a DAO paying in USDC isn't compared with one paying in NEAR.
- **Lapsed:** status `Expired`, or still `InProgress` after `submission_time + proposal_period` (the vote window closed and nobody finalized it). Payments still inside their vote window are left out of F1.

## F1 — small payouts lapse

- Lapse rate for small vs large payments.
- **Zero votes:** lapsed small payments nobody voted on at all.
- **Never repaid:** people whose small payment lapsed and who received no `Approved` payment from that DAO in any later proposal inside the window.
- **Days to repay:** for the rest, days from the first lapsed proposal's submission to the next approved payment proposal's submission (median).

## F2 — the same payment, again

A **repeat series** is the same DAO paying the same recipient the same amount of the same token in **≥ 3** `Approved` payments inside the window. Reported: series count, payments inside series, DAOs with any series. Each of these payments was voted on from scratch.

## F3 — silent seats

- **Seats:** members of `Group` roles whose permissions include `transfer:VoteApprove` (or a wildcard).
- **Silent:** cast no vote on any proposal submitted in the **last 60 days**. Only DAOs with ≥ 3 such proposals are assessed (otherwise there was nothing to vote on).
- **Frozen role:** active (non-silent) members can't reach the role's transfer threshold. Threshold maths as in Sputnik `policy.rs`: `Weight(n)` → `n`; `Ratio(a, b)` → `a·total/b + 1`; capped at `total`; floored by `quorum`. Token-weighted roles are skipped.
- **One away:** active members exactly equal the threshold.
- **Frozen DAO:** every transfer-approving role is frozen.

## F4 — approved, then failed

Proposals with status `Failed` (the vote passed, the execution didn't). The **cause** is a heuristic from the proposal kind only — receipts aren't read: token `Transfer`, NEAR `Transfer`, `intents` (receiver or method mentions intents), `bulk payment` (receiver or method mentions bulk/batch), `token call` (FunctionCall with `ft_transfer`), other call.

## F5 — bounties

Proposals of kind `AddBounty` or `BountyDone` inside the window.

## About the earlier numbers

The planning documents quoted figures from an earlier scan (138 DAOs, 5,941 proposals, …) whose script and data aren't in this repository. Those figures are retired: the pitch uses only what this report reproduces.
