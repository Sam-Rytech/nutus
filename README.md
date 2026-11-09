# Nutus

**Your DAO pays people even when the council is busy.**

Nutus sits beside a NEAR DAO treasury (Sputnik DAO v2 / Trezu). The council decides once; small payouts then go through unless someone objects, recurring pay runs with guaranteed notice, silent seats are flagged before they freeze the treasury, and every payout is checked before the vote. The DAO's own contract is never changed.

- Spec: [docs/NUTUS_SPEC.md](docs/NUTUS_SPEC.md)
- Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Progress tracker: [docs/PROGRESS.md](docs/PROGRESS.md)

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

## Trust statement

The instance code is fixed by hash. Only the DAO account can configure, fund, pause or withdraw. Any account can trigger a release or payment that is already due. The builders have no admin role.
