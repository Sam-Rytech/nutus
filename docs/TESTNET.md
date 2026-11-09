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

Budget roughly **30+ testnet NEAR**:

| Item | NEAR |
|:--|--:|
| 3 council accounts | 9 |
| Test token account | 3 |
| Factory account (sponsors USDC-path instances, 0.25 each) | 8 |
| Sputnik DAO creation | 6 |
| Global instance code | charged per byte, at a higher rate than a normal deploy; check the balance before/after and log it |

## 2. Deploy

```bash
DEPLOYER=you.testnet sh scripts/testnet-deploy.sh
```

This builds the wasm, deploys the instance code **as a global contract by hash**, creates `c1/c2/c3.<you>` as the council, deploys `tusdc.<you>` (test-only token, anyone can mint) and `nutus.<you>` (factory, pinned to the hash, accepts `tusdc.<you>` and DAOs from `sputnikv2.testnet`), creates `nutus-demo.sputnikv2.testnet` and mints it 10,000 tUSDC. Addresses go to `deployments/testnet.env` (H2/H3 for Builder B).

## 3. Set up through a real DAO proposal

```bash
sh scripts/testnet-setup.sh
```

`c1` files one FunctionCall proposal on the token (`storage_deposit` for the instance + `ft_transfer_call` to the factory with `setup:<config>`); `c2` and `c3` approve. The script then prints the instance's token books and config.

**This answers Q2.** If the instance exists and holds 5,000 tUSDC, create + global code + init + forward fit inside one `ft_on_transfer` with 250 TGas. If not, check the failing receipt in the explorer and record it in `PROGRESS.md`.

## 4. Log it

Add each transaction hash to the *Testnet log* table in `docs/PROGRESS.md`.
