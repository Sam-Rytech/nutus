//! Sandbox fixture: real Nutus wasm, the real Sputnik DAO v2 wasm (copied from
//! a live testnet DAO), a test NEP-141, and a DAO set up through a real
//! proposal — the same path a production DAO takes.
//!
//! Build the wasm first: `sh scripts/abi.sh` and
//! `(cd contracts/test-token && cargo near build non-reproducible-wasm --no-abi)`.

#![allow(dead_code)]

use anyhow::{anyhow, bail, Result};
use base64::Engine;
use near_workspaces::network::Sandbox;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::NearToken;
use near_workspaces::{Account, AccountId, Worker};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

/// A live testnet Sputnik v2 DAO whose code we copy into the sandbox.
pub const SPUTNIK_SOURCE: &str = "nutus-demo.sputnikv2.testnet";
pub const TOKEN_UNIT: u128 = 1_000_000; // 6 decimals
pub const SEC: u64 = 1_000_000_000;
pub const WINDOW: u64 = 10 * SEC;
pub const TIMEOUT: u64 = 20 * SEC;

pub fn near(n: u128) -> NearToken {
    NearToken::from_near(n)
}

pub fn milli(n: u128) -> NearToken {
    NearToken::from_millinear(n)
}

fn wasm(name: &str) -> Result<Vec<u8>> {
    let path = format!(
        "{}/../../target/near/{name}/{name}.wasm",
        env!("CARGO_MANIFEST_DIR")
    );
    std::fs::read(&path).map_err(|e| anyhow!("{path}: {e} (build the wasm first)"))
}

pub fn b64(v: &Value) -> String {
    base64::engine::general_purpose::STANDARD.encode(v.to_string())
}

/// Sputnik `FunctionCall` proposal kind: one receiver, several actions.
pub fn fcall(receiver: &AccountId, actions: &[(&str, Value, u128, u64)]) -> Value {
    json!({ "FunctionCall": {
        "receiver_id": receiver,
        "actions": actions.iter().map(|(m, args, deposit, tgas)| json!({
            "method_name": m,
            "args": b64(args),
            "deposit": deposit.to_string(),
            "gas": (tgas * 1_000_000_000_000).to_string(),
        })).collect::<Vec<_>>(),
    }})
}

pub fn ok(r: ExecutionFinalResult) -> Result<ExecutionFinalResult> {
    if r.is_failure() {
        bail!("transaction failed: {:#?}", r.failures());
    }
    if !r.receipt_failures().is_empty() {
        bail!("receipt failed: {:#?}", r.receipt_failures());
    }
    Ok(r)
}

/// `ok` for calls whose result isn't needed.
pub fn done(r: ExecutionFinalResult) -> Result<()> {
    ok(r).map(|_| ())
}

pub fn lane(token: &str) -> Value {
    json!({
        "id": "design", "name": "Design", "token": token,
        "small_max": (100 * TOKEN_UNIT).to_string(),
        "medium_max": (500 * TOKEN_UNIT).to_string(),
        "period_cap": (2_000 * TOKEN_UNIT).to_string(),
        "window_ns": WINDOW.to_string(),
        "medium_timeout_ns": TIMEOUT.to_string(),
        "filers": "Anyone",
    })
}

pub struct Env {
    pub worker: Worker<Sandbox>,
    pub root: Account,
    pub token: Account,
    pub factory: Account,
    pub sputnik: Account,
    pub sputnik_code: Vec<u8>,
    pub dao: AccountId,
    pub council: Vec<Account>,
    pub filer: Account,
    pub carol: Account,
    pub keeper: Account,
    pub instance: AccountId,
}

impl Env {
    /// Everything up to and including setup through a real DAO proposal.
    pub async fn new() -> Result<Env> {
        let worker = near_workspaces::sandbox().await?;
        let testnet = near_workspaces::testnet().await?;
        let sputnik_code = testnet
            .view_code(&SPUTNIK_SOURCE.parse()?)
            .await
            .map_err(|e| anyhow!("copying Sputnik code from testnet: {e}"))?;
        let root = worker.root_account()?;

        // Test token; it also publishes the instance code globally by hash.
        let token = sub(&root, "tusdc", 60).await?;
        token
            .deploy(&wasm("nutus_test_token")?)
            .await?
            .into_result()?;
        done(
            token
                .call(token.id(), "new")
                .args_json(json!({"symbol": "tUSDC", "decimals": 6}))
                .transact()
                .await?,
        )?;
        let instance_wasm = wasm("nutus_instance")?;
        let hash = bs58::encode(Sha256::digest(&instance_wasm)).into_string();
        done(
            token
                .call(token.id(), "deploy_global")
                .args_borsh(instance_wasm)
                .max_gas()
                .transact()
                .await?,
        )?;

        // DAOs live under a "sputnik" parent, like sputnik-dao.near.
        let sputnik = sub(&root, "sputnik", 50).await?;

        let factory = sub(&root, "nutus", 10).await?;
        factory
            .deploy(&wasm("nutus_factory")?)
            .await?
            .into_result()?;
        done(
            factory
                .call(factory.id(), "new")
                .args_json(json!({
                    "instance_code_hash": hash,
                    "setup_tokens": [token.id()],
                    "dao_factories": [sputnik.id()],
                }))
                .transact()
                .await?,
        )?;
        // The factory registers once with each setup token (found on testnet).
        done(
            root.call(token.id(), "storage_deposit")
                .args_json(json!({"account_id": factory.id(), "registration_only": true}))
                .deposit(milli(10))
                .transact()
                .await?,
        )?;

        let mut council = vec![];
        for name in ["c1", "c2", "c3"] {
            council.push(sub(&root, name, 10).await?);
        }
        let filer = sub(&root, "filer", 10).await?;
        let carol = sub(&root, "carol", 5).await?;
        let keeper = sub(&root, "keeper", 10).await?;

        let mut env = Env {
            worker,
            root,
            token,
            factory,
            sputnik,
            sputnik_code,
            dao: "placeholder.test.near".parse()?,
            council,
            filer,
            carol,
            keeper,
            instance: "placeholder.test.near".parse()?,
        };
        env.dao = env.new_dao("demo").await?;
        env.mint(&env.dao.clone(), 10_000 * TOKEN_UNIT).await?;

        // Setup: one proposal, two actions on the token (spec §4).
        env.instance = env.instance_for(&env.dao).await?;
        let config = json!({ "lanes": [lane(env.token.id().as_str())],
                             "council": env.council.iter().map(|c| c.id()).collect::<Vec<_>>() });
        let kind = fcall(
            env.token.id(),
            &[
                (
                    "storage_deposit",
                    json!({"account_id": env.instance, "registration_only": true}),
                    1_250_000_000_000_000_000_000,
                    10,
                ),
                (
                    "ft_transfer_call",
                    json!({"receiver_id": env.factory.id(),
                           "amount": (5_000 * TOKEN_UNIT).to_string(),
                           "msg": format!("setup:{config}")}),
                    1,
                    250,
                ),
            ],
        );
        let (_, status) = env.dao_do(&env.dao.clone(), "Set up Nutus", kind).await?;
        if status != "Approved" {
            bail!("setup proposal ended {status}");
        }
        Ok(env)
    }

    /// A fresh Sputnik v2 DAO `<name>.sputnik.<root>` with c1/c2/c3 as council.
    pub async fn new_dao(&self, name: &str) -> Result<AccountId> {
        let dao = sub(&self.sputnik, name, 15).await?;
        dao.deploy(&self.sputnik_code).await?.into_result()?;
        done(
            dao.call(dao.id(), "new")
                .args_json(json!({
                    "config": {"name": name, "purpose": "nutus sandbox", "metadata": ""},
                    "policy": self.council.iter().map(|c| c.id()).collect::<Vec<_>>(),
                }))
                .transact()
                .await?,
        )?;
        Ok(dao.id().clone())
    }

    pub async fn instance_for(&self, dao: &AccountId) -> Result<AccountId> {
        let v = self
            .view(
                self.factory.id(),
                "instance_account_for",
                json!({"dao": dao}),
            )
            .await?;
        Ok(serde_json::from_value(v)?)
    }

    pub async fn mint(&self, to: &AccountId, amount: u128) -> Result<()> {
        done(
            self.root
                .call(self.token.id(), "mint")
                .args_json(json!({"account_id": to, "amount": amount.to_string()}))
                .transact()
                .await?,
        )?;
        Ok(())
    }

    pub async fn view(&self, id: &AccountId, method: &str, args: Value) -> Result<Value> {
        Ok(self.worker.view(id, method).args_json(args).await?.json()?)
    }

    pub async fn ft_balance(&self, who: &AccountId) -> Result<u128> {
        let v = self
            .view(self.token.id(), "ft_balance_of", json!({"account_id": who}))
            .await?;
        Ok(v.as_str().unwrap_or("0").parse()?)
    }

    pub async fn near_balance(&self, who: &AccountId) -> Result<u128> {
        Ok(self.worker.view_account(who).await?.balance.as_yoctonear())
    }

    pub async fn proposal(&self, dao: &AccountId, id: u64) -> Result<Value> {
        self.view(dao, "get_proposal", json!({"id": id})).await
    }

    /// c1 files, then council votes approve until the proposal is decided.
    /// Returns (proposal id, final status).
    pub async fn dao_do(
        &self,
        dao: &AccountId,
        description: &str,
        kind: Value,
    ) -> Result<(u64, String)> {
        let r = ok(self.council[0]
            .call(dao, "add_proposal")
            .args_json(json!({"proposal": {"description": description, "kind": kind}}))
            .deposit(near(1))
            .max_gas()
            .transact()
            .await?)?;
        let id: u64 = r.json()?;
        self.approve_proposal(dao, id).await?;
        let status = self.proposal(dao, id).await?["status"]
            .as_str()
            .unwrap_or("?")
            .to_string();
        Ok((id, status))
    }

    /// Votes approve with c2, c3, then c1 until the proposal leaves InProgress.
    pub async fn approve_proposal(&self, dao: &AccountId, id: u64) -> Result<()> {
        let kind = self.proposal(dao, id).await?["kind"].clone();
        for voter in [&self.council[1], &self.council[2], &self.council[0]] {
            if self.proposal(dao, id).await?["status"] != "InProgress" {
                break;
            }
            // The vote itself must land; whether the proposal's actions then
            // succeed is the proposal's status, which callers assert on.
            let r = voter
                .call(dao, "act_proposal")
                .args_json(json!({"id": id, "action": "VoteApprove", "proposal": kind}))
                .max_gas()
                .transact()
                .await?;
            if r.is_failure() {
                bail!("vote failed: {:#?}", r.failures());
            }
        }
        Ok(())
    }

    /// Runs a DAO-only instance method through a real DAO proposal.
    pub async fn dao_call(&self, method: &str, args: Value, deposit: u128) -> Result<String> {
        let kind = fcall(&self.instance, &[(method, args, deposit, 150)]);
        Ok(self.dao_do(&self.dao.clone(), method, kind).await?.1)
    }

    pub async fn now(&self) -> Result<u64> {
        Ok(self.worker.view_block().await?.timestamp())
    }

    /// Produce blocks until the chain clock passes `t` (ns).
    pub async fn wait_until(&self, t: u64) -> Result<()> {
        for _ in 0..200 {
            if self.now().await? > t {
                return Ok(());
            }
            self.worker.fast_forward(10).await?;
        }
        bail!("clock never reached {t}")
    }

    pub async fn file(&self, amount: u128) -> Result<String> {
        let r = ok(self
            .filer
            .call(&self.instance, "file_payout")
            .args_json(json!({
                "lane_id": "design", "recipient": self.carol.id(),
                "amount": amount.to_string(), "link": "https://example.org/pr/1", "memo": null,
            }))
            .deposit(milli(100))
            .max_gas()
            .transact()
            .await?)?;
        Ok(r.json()?)
    }

    pub async fn payout(&self, id: &str) -> Result<Value> {
        self.view(&self.instance, "get_payout", json!({"payout_id": id}))
            .await
    }

    pub async fn books(&self) -> Result<Value> {
        let v = self
            .view(&self.instance, "get_token_books", json!({}))
            .await?;
        v.as_array()
            .and_then(|a| {
                a.iter()
                    .find(|b| b["token"] == self.token.id().as_str())
                    .cloned()
            })
            .ok_or_else(|| anyhow!("no tUSDC book"))
    }

    /// I1 on every token book, read from the chain.
    pub async fn assert_i1(&self) -> Result<()> {
        let books = self
            .view(&self.instance, "get_token_books", json!({}))
            .await?;
        for b in books.as_array().unwrap() {
            let n = |k: &str| b[k].as_str().unwrap().parse::<u128>().unwrap();
            assert!(
                n("balance") >= n("reserved") + n("committed_notice") + n("standing_buffer"),
                "I1 broken: {b}"
            );
        }
        Ok(())
    }
}

pub async fn sub(parent: &Account, name: &str, near_amount: u128) -> Result<Account> {
    Ok(parent
        .create_subaccount(name)
        .initial_balance(near(near_amount))
        .transact()
        .await?
        .into_result()?)
}

pub fn n(v: &Value) -> u128 {
    v.as_str().and_then(|s| s.parse().ok()).unwrap_or(0)
}
