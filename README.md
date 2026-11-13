# Nutus

**Your DAO pays people even when the council is busy.**

**Live app:** https://nutus.vercel.app (testnet) · **Alerts:** [@nutusalertbot](https://t.me/nutusalertbot) on Telegram · **Mainnet findings:** [data/scan/REPORT.md](data/scan/REPORT.md)

Nutus sits beside a NEAR DAO treasury (Sputnik DAO v2 / Trezu). The council decides once. Then:

- **Small** payouts pay when their window closes (48 h by default) unless a council member objects. An objection files a normal DAO proposal.
- **Medium** payouts pay on the first council approval, or become a DAO vote if nobody approves in time.
- **Recurring** pay runs every period with notice locked in at the start: not even a DAO vote can withdraw it.
- **Records**: every paid job counts, and a longer record raises how much can be paid without a vote.
- **Preflight** checks a payment before the vote and fixes what it can (an unregistered recipient gets a registration step), so approved payments don't fail.
- **Seat watch** flags council members who stopped voting before the council loses the votes to pay anyone.

The DAO's own contract is never changed.

## Try it

Everything below runs against the live testnet demo (DAO `nutus-demo.sputnikv2.testnet`, instance `nutus-demo.v2.nutus-dev.testnet`). Steps 1–4 need no wallet.

1. **Open https://nutus.vercel.app/board.** You see the payouts waiting, each with its objection window ("Pays in 26 h unless the council objects"). Under **History**, payout #1 (30 tUSDC to `nutus-fund6.testnet`) reads **Paid** and **Small: no vote needed**: its window closed with no objection and the keeper released it on 12 Nov 2026 (tx `9JTUS8y4qSCQkA4xpDXXVBvDmZtYcicm169h28U7i9gV`). Nobody voted.
2. **Open https://nutus.vercel.app/report, type `burrow.sputnik-dao.near`, click Read.** After a few seconds of reading mainnet you see that DAO's last year: lapsed small payments, repeat payments, silent council seats, proposals that passed and then failed to execute. Under **Fix this**, a lane sized from its own payments (for example "small payouts up to 50,000 USDt") with the setup proposal drafted.
3. **Open https://nutus.vercel.app/council, scroll to "Check a payment before the vote".** Enter recipient `nutus-newcomer.testnet` and amount `5`, click **Check payment**. You see **Fixed:** the account isn't registered with the token, so a registration step was added and the payment can't fail after the vote.
4. **On the same page, "Object before it pays"** lists every payout a council member can still stop; **Payouts → Recurring pay** shows a weekly payment with its notice locked ("5 tUSDC locked (1 period)").
5. **With a testnet wallet (Meteor), open https://nutus.vercel.app/get-paid.** Connect, fill in "Pay `1` tUSDC to *you* for *a link*", and the page tells you before signing how it will be paid ("Small. Paid 2 days after you file unless a council member objects. No vote needed."). Click **File payout** and approve in the wallet (0.1 NEAR deposit, refunded when the payout finishes): it appears on the board with its window running, and the Telegram bot posts it.
6. **Telegram:** open [@nutusalertbot](https://t.me/nutusalertbot) and send `/status`: you get what needs the council right now.

The same, locally: `pnpm install && pnpm --filter @nutus/app dev`, then open http://localhost:5173 (reads the same testnet instance). Tests: see [Tests](#tests).

## What's running

| | Where |
|---|---|
| Instance (demo DAO `nutus-demo.sputnikv2.testnet`) | `nutus-demo.v2.nutus-dev.testnet` |
| Factory | `v2.nutus-dev.testnet` |
| Test token (tUSDC) | `tusdc.nutus-dev.testnet` |
| Web app | https://nutus.vercel.app |
| Keeper | Inside `/api/tick` every 5 min (cron-job.org), as `keeper.nutus-dev.testnet`; GitHub Actions ([keeper.yml](.github/workflows/keeper.yml)) as backup |
| Telegram bot | Vercel functions `/api/telegram` (instant replies) + `/api/tick` (alerts, every 5 min) |

Every testnet transaction we ran, with hashes: [docs/PROGRESS.md § Testnet log](docs/PROGRESS.md#testnet-log). Addresses: [deployments/testnet.env](deployments/testnet.env).

## Docs

- Spec: [docs/NUTUS_SPEC.md](docs/NUTUS_SPEC.md)
- Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Progress and decisions: [docs/PROGRESS.md](docs/PROGRESS.md)
- Threat model: [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md)
- Testnet runbook: [docs/TESTNET.md](docs/TESTNET.md)

## Layout

```
contracts/common     shared Rust types (SetupConfig, LaneConfig, …)
contracts/instance   one per DAO, global code by hash
contracts/factory    creates instances (NEAR or token-funded setup)
contracts/test-token NEP-141 test token for testnet
contracts/tests      near-workspaces tests against the real Sputnik wasm
packages/core        TS types generated from the ABI, client, threshold maths, proposal builders, preflight
packages/report      mainnet scan (F1–F5), per-DAO report, Fix-this drafts
packages/keeper      calls whatever is due; anyone can run one
packages/notify      Telegram bot: alerts, /status, per-chat settings
app/                 Vite + React web app (home + five screens) and the bot's Vercel functions
scripts/             testnet deploy / setup / demo scripts
```

## App

```bash
pnpm install
pnpm --filter @nutus/app dev      # http://localhost:5173, reads the testnet instance
pnpm --filter @nutus/app deploy   # build, bundle the bot functions, publish to Vercel (prebuilt)
```

Point it at another instance with `?instance=<account>`. Signing uses Meteor Wallet on testnet.

Screens: **Home** (what Nutus is, live testnet data, the mainnet findings), **Payouts** (every payout and its objection window), **Council inbox** (object, approve, finalize expired votes, check a payment before the vote), **Get paid** (file a payout as one sentence), **DAO report** (any Sputnik DAO, mainnet or testnet, with Fix-this drafts), **Set up** (file the setup proposal).

Pushes to `main` don't deploy (`vercel.json` turns git deploys off); deploys come from the command above.

## Telegram bot

Add [@nutusalertbot](https://t.me/nutusalertbot) to a chat and send `/start` (in a group: `/start@nutusalertbot`). It posts:

- new payouts, while they can still be stopped
- payouts sent to a DAO vote
- expired DAO votes to finalize, to recover the bond
- recurring pay running short
- council seats gone quiet

`/settings` picks which alerts and how often: as they happen, hourly, every 6 hours or daily. In groups only admins can change settings. `/status` lists what needs the council now.

Running your own: create a bot with @BotFather, add Upstash Redis to the Vercel project, then set `TELEGRAM_BOT_TOKEN` on Vercel and as a GitHub secret. The webhook secret and the tick key are derived from the token. Preview the messages without Telegram:

```bash
LOOKBACK_HOURS=48 pnpm --filter @nutus/notify preview
```

## Report

```bash
pnpm --filter @nutus/report scan                              # scan mainnet, write data/scan/{summary.json,REPORT.md}
pnpm --filter @nutus/report dao ref-finance.sputnik-dao.near  # one mainnet DAO
cd packages/report && npx tsx scripts/draft-fixes.ts <dao> <factory>   # the Fix-this proposals, as JSON
```

How each number is measured: [packages/report/DEFINITIONS.md](packages/report/DEFINITIONS.md).

## Keeper

Anyone can run one; it only needs gas money. It calls `release`, `escalate`, `pay_due` and `settle_escalation` when they're due, and treats "already done" refusals as no-ops.

```bash
KEEPER_ACCOUNT_ID=you.testnet KEEPER_PRIVATE_KEY=ed25519:... \
INSTANCES=nutus-demo.v2.nutus-dev.testnet pnpm --filter @nutus/keeper start
```

`FACTORY=v2.nutus-dev.testnet` serves every instance the factory made instead of a fixed list; `ONCE=1` runs a single round; `NEAR_RPC_URL` picks the network.

## Contracts

```bash
cargo install cargo-near        # once
sh scripts/abi.sh               # build wasm + refresh packages/core/abi/*.json
# Windows: near-sdk pulls in aws-lc-sys; without CMake/NASM set this first
#   PowerShell: $env:AWS_LC_SYS_PREBUILT_NASM=1
```

## Tests

```bash
cargo test --workspace --exclude nutus-integration-tests   # unit + property tests (any OS)
NUTUS_PROP_SEEDS=200 cargo test -p nutus-instance prop      # longer property run
cargo test -p nutus-integration-tests                       # sandbox + real Sputnik (Linux/macOS; CI)
pnpm -r test                                                # core, report, keeper, notify
```

## Trust statement

The instance code is fixed by hash. Only the DAO account can configure, fund, pause or withdraw, and it can never withdraw locked notice. Any account can trigger a release or payment that is already due. The builders have no admin role. The web app and the bot only read public chain data; every transaction is signed in your own wallet.

## Built on NEAR

- **Sputnik DAO v2**: Nutus works beside an unchanged DAO. Setup is one normal FunctionCall proposal; an objection files a normal Transfer proposal with the DAO's exact bond; `act_proposal` approve/finalize settles it; the DAO's policy decides who is council. Tested against the real Sputnik wasm in `contracts/tests`.
- **Global contracts (NEP-591)**: the instance code is deployed once and every DAO's instance uses it by code hash, so nobody (us included) can change an instance after it is created.
- **Named accounts and sub-accounts**: the factory creates each instance as its sub-account (`nutus-demo.v2.nutus-dev.testnet`), with no access keys.
- **NEP-141 fungible tokens**: budgets and payouts in any token (the demo uses tUSDC); recipient storage is registered on release (`storage_deposit` + `ft_transfer` in one batch), and preflight adds the same step to DAO proposals.
- **Wallet**: NEAR Wallet Selector with Meteor Wallet; NEAR RPC (FastNEAR) for all reads, mainnet and testnet.

## Built with

- Contracts: `near-sdk` 5, `cargo-near`, `near-workspaces` 0.24 (sandbox tests against the real Sputnik wasm); the property tests are seeded and hand-written (`NUTUS_PROP_SEEDS`).
- TypeScript: `@near-wallet-selector` (core, modal-ui, meteor-wallet), React 19, Vite, React Router, three.js (the home page's 3D ledger), `tsx`, Vitest.
- Hosting: Vercel (static app + two serverless functions), Upstash Redis (bot settings), cron-job.org (the 5-minute tick), GitHub Actions (CI and backup keeper).
- Fonts: Public Sans and Geist Mono, self-hosted.
- AI assistance: much of the code and docs were written with Claude Code (Anthropic) as a coding assistant, directed and reviewed by the team.

## NEAR HACKATHON

Built for NEAR HACKATHON, November 2026, in the Social Money track. All code in this repository was written during the hackathon; the first commit is from 9 November 2026.

One of the builders also entered a second, independent project: **ATTO** ([github.com/KayProject/ATTO](https://github.com/KayProject/ATTO), [atto.namite.xyz](https://atto.namite.xyz)), a safer way to buy and sell NEAR names. The two projects share no code.

## License

MIT. See [LICENSE](LICENSE).
