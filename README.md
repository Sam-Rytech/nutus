# Nutus

**Your DAO pays people even when the council is busy.**

Nutus sits beside a NEAR DAO treasury (Sputnik DAO v2 / Trezu). The council decides once; small payouts then go through unless someone objects, recurring pay runs with guaranteed notice, silent seats are flagged before they freeze the treasury, and every payout is checked before the vote. The DAO's own contract is never changed.

- Spec: [docs/NUTUS_SPEC.md](docs/NUTUS_SPEC.md)
- Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Progress tracker: [docs/PROGRESS.md](docs/PROGRESS.md)
- Threat model: [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md)
- Testnet runbook: [docs/TESTNET.md](docs/TESTNET.md)

## Layout

```
contracts/common     shared Rust types (SetupConfig, LaneConfig, …)
contracts/instance   <dao>.nutus.near — one per DAO, global code by hash
contracts/factory    nutus.near — creates instances
contracts/tests      near-workspaces integration tests (Phase 5)
packages/core        TS types (from packages/core/abi), builders, preflight
packages/report      report service
packages/keeper      keeper
packages/notify      Telegram notifications
app/                 Next.js web app
data/ scripts/       mainnet scan fixtures + helper scripts
```

## Contracts

```bash
cargo test --workspace          # unit tests
# Windows: near-sdk pulls in aws-lc-sys; without CMake/NASM set this first
#   export AWS_LC_SYS_PREBUILT_NASM=1   (PowerShell: $env:AWS_LC_SYS_PREBUILT_NASM=1)
cargo install cargo-near        # once
sh scripts/abi.sh               # build wasm + refresh packages/core/abi/*.json
```

## Tests

```bash
cargo test --workspace --exclude nutus-integration-tests   # unit + property tests (any OS)
NUTUS_PROP_SEEDS=200 cargo test -p nutus-instance prop      # longer property run
cargo test -p nutus-integration-tests                       # sandbox + real Sputnik (Linux/macOS; CI)
pnpm -r test                                                # keeper
```

## Keeper

Anyone can run one; it only needs gas money. It calls `release`, `escalate`, `pay_due` and `settle_escalation` when they're due, and treats "already done" refusals as no-ops.

```bash
pnpm install
KEEPER_ACCOUNT_ID=you.testnet KEEPER_PRIVATE_KEY=ed25519:... \
FACTORY=nutus.nutus-dev.testnet pnpm --filter @nutus/keeper start
```

`INSTANCES=a,b` serves a fixed list instead of every instance the factory made; `ONCE=1` runs a single round; `NEAR_RPC_URL` picks the network.

## Trust statement

The instance code is fixed by hash. Only the DAO account can configure, fund, pause or withdraw. Any account can trigger a release or payment that is already due. The builders have no admin role.
