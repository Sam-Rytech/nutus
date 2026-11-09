# Testnet runbook

Builder A deploys; everything after this runs against the addresses in `deployments/testnet.env`.

## 0. One-time tools

```powershell
irm https://github.com/near/near-cli-rs/releases/latest/download/near-cli-rs-installer.ps1 | iex
```

`cargo-near` and Python 3 are already needed for `scripts/abi.sh`.

## 1. A funded testnet account

Create one in a wallet (e.g. MyNearWallet / Meteor on testnet) and fund it from the testnet faucet, then import its key into the CLI keychain:

```bash
near account import-account using-web-wallet network-config testnet
```

Budget roughly **48 testnet NEAR** (the faucet gives 10 per new account):

| Item | NEAR |
|:--|--:|
| Global instance code (335 KB at ~10 NEAR / 100 KB, **burned**, not refundable) | ~33.5 |
| Sputnik DAO creation | 6 |
| Factory account (219 KB code = ~2.2 locked + 0.25 per sponsored instance) | 2.8 |
| Test token account (152 KB code = ~1.5 locked) | 1.8 |
| Council: c1 1.5 (pays the 1 NEAR bond), c2/c3 0.3 each | 2.1 |
| Gas and slack | ~2 |

Global code is charged at 10× normal storage and burned (NEP-591). That's the one-off price of every instance costing ~0.25 NEAR instead of ~3.4 NEAR of locked code storage. Same trade-off on mainnet. Log the actual cost from the balance before and after.

## 2. Deploy

```bash
DEPLOYER=you.testnet sh scripts/testnet-deploy.sh
```

This builds the wasm, deploys the instance code **as a global contract by hash**, creates `c1/c2/c3.<you>` as the council, deploys `tusdc.<you>` (test-only token, anyone can mint) and `nutus.<you>` (factory, pinned to the hash, accepts `tusdc.<you>` and DAOs from `sputnikv2.testnet`), creates `nutus-demo.sputnikv2.testnet` and mints it 10,000 tUSDC. Addresses go to `deployments/testnet.env` (H2/H3 for Builder B).

The deploy also registers the factory with the setup token (once per token). Without it, the DAO's `ft_transfer_call` to the factory panics with "not registered" and the setup proposal fails. The same step is needed for USDC and USDT on mainnet.

## Current deployment (2026-11-09)

| What | Account |
|:--|:--|
| Deployer | `nutus-dev.testnet` |
| Instance code (global, by hash) | `9C622Ttng5hKSgv2KYVZBSTTk8THdaW8szvAKkuq4jo9` |
| Factory | `nutus.nutus-dev.testnet` |
| Test token (tUSDC, 6 decimals) | `tusdc.nutus-dev.testnet` |
| Demo DAO (Sputnik v2) | `nutus-demo.sputnikv2.testnet` |
| Council | `c1` / `c2` / `c3.nutus-dev.testnet` |
| Demo instance | `nutus-demo.nutus.nutus-dev.testnet` (5,000 tUSDC, lane `design`) |

## 3. Set up through a real DAO proposal

```bash
sh scripts/testnet-setup.sh
```

`PROPOSAL_ID=<n>` resumes a proposal that is already filed. `c1` files one FunctionCall proposal on the token (`storage_deposit` for the instance + `ft_transfer_call` to the factory with `setup:<config>`); `c2` and `c3` approve. The script then prints the instance's token books and config.

**This answered Q2 (yes): the whole chain burned ~37 TGas, of which the create batch was 10.4 TGas.** If the instance exists and holds 5,000 tUSDC, create + global code + init + forward fit inside one `ft_on_transfer` with 250 TGas. If not, check the failing receipt in the explorer and record it in `PROGRESS.md`.

## 4. Log it

Add each transaction hash to the *Testnet log* table in `docs/PROGRESS.md`.
