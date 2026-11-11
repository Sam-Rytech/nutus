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

## What's running

| | Where |
|---|---|
| Instance (demo DAO `nutus-demo.sputnikv2.testnet`) | `nutus-demo.v2.nutus-dev.testnet` |
| Factory | `v2.nutus-dev.testnet` |
| Test token (tUSDC) | `tusdc.nutus-dev.testnet` |
| Web app | https://nutus.vercel.app |
| Keeper | GitHub Actions, hourly ([keeper.yml](.github/workflows/keeper.yml)), as `keeper.nutus-dev.testnet` |
| Telegram bot | Vercel functions `/api/telegram` + `/api/tick`, ticked every 15 min ([notify.yml](.github/workflows/notify.yml)) |

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
app/                 Vite + React web app (six screens) and the bot's Vercel functions
scripts/             testnet deploy / setup / demo scripts
```

## App

```bash
pnpm install
pnpm --filter @nutus/app dev      # http://localhost:5173, reads the testnet instance
pnpm --filter @nutus/app deploy   # build, bundle the bot functions, publish to Vercel (prebuilt)
```

Point it at another instance with `?instance=<account>`. Signing uses Meteor Wallet on testnet.

Screens: **Payouts** (public board with each objection window), **Get paid** (file a payout), **Council inbox** (object, approve, finalize expired votes, check a payment before the vote), **DAO report** (any Sputnik DAO, mainnet or testnet, with Fix-this drafts), **Set up** (file the setup proposal), **Network findings**.

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
