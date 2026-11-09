//! Nutus factory (`nutus.near`).
//!
//! Creates `<dao>.nutus.near` and points it at the instance code by **hash**
//! (NEP-591 global contract), so nobody — including the builders — can change a
//! DAO's instance later. There is no admin method: a new instance version
//! means a new factory with a new hash.
//!
//! Setup is one DAO proposal per budget token (spec §4):
//! - NEAR: `FunctionCall(nutus.near, create({config}))` with budget + storage.
//! - USDC/USDT: `FunctionCall(<token>, [storage_deposit(<dao>.nutus.near),
//!   ft_transfer_call(nutus.near, amount, "setup:<config json>")])`.
//!
//! Anti-drain: the USDC path spends the factory's own NEAR on the instance
//! account, so only allow-listed tokens and DAOs created by allow-listed DAO
//! factories (e.g. `sputnik-dao.near`) can set up. Every failure refunds the DAO.

use near_sdk::json_types::{Base58CryptoHash, U128, U64};
use near_sdk::serde_json::{self, json};
use near_sdk::store::IterableMap;
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, CryptoHash, Gas, NearToken, PanicOnDefault,
    Promise, PromiseError, PromiseOrValue,
};
use nutus_common::SetupConfig;

/// Account + initial state of one instance. Payout storage is paid later by
/// filing deposits, so this only covers the empty instance and its lanes.
pub const DEFAULT_INSTANCE_STORAGE: u128 = 250_000_000_000_000_000_000_000; // 0.25 NEAR

const GAS_INIT: Gas = Gas::from_tgas(30);
const GAS_ON_CREATED: Gas = Gas::from_tgas(90);
const GAS_FORWARD: Gas = Gas::from_tgas(50);
const GAS_ON_FORWARDED: Gas = Gas::from_tgas(10);

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Instances,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct InstanceEntry {
    pub dao: AccountId,
    pub instance: AccountId,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct FactoryConfig {
    pub instance_code_hash: Base58CryptoHash,
    pub instance_storage: U128,
    pub setup_tokens: Vec<AccountId>,
    pub dao_factories: Vec<AccountId>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Factory {
    /// Hash of the deployed global instance code. Fixed at init; no setter.
    instance_code_hash: Base58CryptoHash,
    /// NEAR given to each new instance account (yoctoNEAR).
    instance_storage: u128,
    /// NEP-141 tokens accepted on the `ft_on_transfer` setup path.
    setup_tokens: Vec<AccountId>,
    /// DAOs must be direct sub-accounts of one of these (e.g. `sputnik-dao.near`).
    dao_factories: Vec<AccountId>,
    /// DAO account → its instance account (inserted when creation starts,
    /// removed again if it fails).
    instances: IterableMap<AccountId, AccountId>,
}

#[near]
impl Factory {
    /// All settings are fixed here; the factory has no admin methods.
    #[init]
    pub fn new(
        instance_code_hash: Base58CryptoHash,
        setup_tokens: Vec<AccountId>,
        dao_factories: Vec<AccountId>,
        instance_storage: Option<U128>,
    ) -> Self {
        require!(!dao_factories.is_empty(), "NO_DAO_FACTORIES");
        Self {
            instance_code_hash,
            instance_storage: instance_storage.map_or(DEFAULT_INSTANCE_STORAGE, |s| s.0),
            setup_tokens,
            dao_factories,
            instances: IterableMap::new(StorageKey::Instances),
        }
    }

    /// NEAR path. The caller (the DAO, via a FunctionCall proposal) becomes the
    /// instance's `dao`. Attach `instance_storage` + the NEAR budget; the budget
    /// lands in the instance's `"near"` book. Attach ≥ 150 TGas.
    #[payable]
    pub fn create(&mut self, config: SetupConfig) -> Promise {
        let dao = env::predecessor_account_id();
        let attached = env::attached_deposit().as_yoctonear();
        require!(
            attached > self.instance_storage,
            "ATTACH_STORAGE_PLUS_BUDGET"
        );
        if let Err(e) = self.check_dao(&dao) {
            env::panic_str(e);
        }
        let budget = attached - self.instance_storage;
        self.start_create(dao, config, budget, None, U128(attached))
    }

    /// USDC/USDT path: `ft_transfer_call(nutus.near, amount, "setup:<SetupConfig json>")`
    /// from the DAO. Returns the unused amount, so any failure refunds the DAO.
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        let token = env::predecessor_account_id();
        let refund = PromiseOrValue::Value(amount);
        if !self.setup_tokens.contains(&token) || amount.0 == 0 {
            return refund;
        }
        let Some(json) = msg.strip_prefix("setup:") else {
            return refund;
        };
        let Ok(config) = serde_json::from_str::<SetupConfig>(json) else {
            return refund;
        };
        if self.check_dao(&sender_id).is_err() {
            return refund;
        }
        if self.spare_near() < self.instance_storage {
            return refund;
        }
        PromiseOrValue::Promise(self.start_create(sender_id, config, 0, Some(token), amount))
    }

    /// After the create batch. NEAR path: refund everything on failure.
    /// Token path: on success forward the tokens to the instance and return
    /// whatever it didn't take; on failure return the full amount.
    #[private]
    pub fn on_instance_created(
        &mut self,
        dao: AccountId,
        token: Option<AccountId>,
        amount: U128,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> PromiseOrValue<U128> {
        let instance = instance_account(&dao, &env::current_account_id());
        if result.is_err() {
            self.instances.remove(&dao);
            env::log_str(&format!("nutus: setup for {dao} failed, refunding"));
            return match token {
                Some(_) => PromiseOrValue::Value(amount),
                None => {
                    Promise::new(dao)
                        .transfer(NearToken::from_yoctonear(amount.0))
                        .detach();
                    PromiseOrValue::Value(U128(0))
                }
            };
        }
        env::log_str(&format!("nutus: created {instance} for {dao}"));
        let Some(token) = token else {
            return PromiseOrValue::Value(U128(0));
        };
        // The DAO registered the instance on the token in the same proposal.
        Promise::new(token)
            .function_call(
                "ft_transfer_call",
                json!({ "receiver_id": instance, "amount": amount, "msg": "fund" })
                    .to_string()
                    .into_bytes(),
                NearToken::from_yoctonear(1),
                GAS_FORWARD,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_ON_FORWARDED)
                    .on_forwarded(amount),
            )
            .into()
    }

    /// `ft_transfer_call` returns how much the receiver used; hand the rest
    /// back to the original `ft_transfer_call` so it refunds the DAO.
    #[private]
    pub fn on_forwarded(
        &mut self,
        amount: U128,
        #[callback_result] used: Result<U128, PromiseError>,
    ) -> U128 {
        match used {
            Ok(used) => U128(amount.0.saturating_sub(used.0)),
            Err(_) => amount,
        }
    }

    // ──────────────────────────── views ────────────────────────────

    pub fn get_instance(&self, dao: AccountId) -> Option<AccountId> {
        self.instances.get(&dao).cloned()
    }

    pub fn list_instances(
        &self,
        from_index: Option<U64>,
        limit: Option<u32>,
    ) -> Vec<InstanceEntry> {
        let from = from_index.map_or(0, |i| i.0) as usize;
        self.instances
            .iter()
            .skip(from)
            .take(limit.unwrap_or(50) as usize)
            .map(|(dao, instance)| InstanceEntry {
                dao: dao.clone(),
                instance: instance.clone(),
            })
            .collect()
    }

    pub fn get_code_hash(&self) -> Base58CryptoHash {
        self.instance_code_hash
    }

    pub fn get_config(&self) -> FactoryConfig {
        FactoryConfig {
            instance_code_hash: self.instance_code_hash,
            instance_storage: U128(self.instance_storage),
            setup_tokens: self.setup_tokens.clone(),
            dao_factories: self.dao_factories.clone(),
        }
    }

    /// `dao.sputnik-dao.near` → `dao.nutus.near` (first label of the DAO account
    /// under this factory's account).
    pub fn instance_account_for(&self, dao: AccountId) -> AccountId {
        instance_account(&dao, &env::current_account_id())
    }
}

impl Factory {
    /// The DAO must be a direct sub-account of an allowed DAO factory and must
    /// not have an instance yet.
    fn check_dao(&self, dao: &AccountId) -> Result<(), &'static str> {
        let allowed = self
            .dao_factories
            .iter()
            .any(|f| dao.get_parent_account_id() == Some(f.as_ref()));
        if !allowed {
            return Err("DAO_NOT_FROM_ALLOWED_FACTORY");
        }
        if self.instances.contains_key(dao) {
            return Err("INSTANCE_EXISTS");
        }
        Ok(())
    }

    /// NEAR the factory can spend on new instance accounts.
    fn spare_near(&self) -> u128 {
        let storage = u128::from(env::storage_usage()) * env::storage_byte_cost().as_yoctonear();
        env::account_balance()
            .as_yoctonear()
            .saturating_sub(storage)
    }

    /// One atomic batch on the new account: create, fund storage, point at
    /// the global code by hash, init. `budget` (NEAR path) is attached to
    /// `new`, which books it as the instance's NEAR budget.
    fn start_create(
        &mut self,
        dao: AccountId,
        config: SetupConfig,
        budget: u128,
        token: Option<AccountId>,
        refund_amount: U128,
    ) -> Promise {
        let instance = instance_account(&dao, &env::current_account_id());
        self.instances.insert(dao.clone(), instance.clone());
        let code_hash: CryptoHash = self.instance_code_hash.into();
        Promise::new(instance)
            .create_account()
            .transfer(NearToken::from_yoctonear(self.instance_storage))
            .use_global_contract(code_hash)
            .function_call(
                "new",
                json!({ "dao": dao, "config": config })
                    .to_string()
                    .into_bytes(),
                NearToken::from_yoctonear(budget),
                GAS_INIT,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_ON_CREATED)
                    .on_instance_created(dao, token, refund_amount),
            )
    }
}

pub fn instance_account(dao: &AccountId, factory: &AccountId) -> AccountId {
    let label = dao.as_str().split('.').next().unwrap_or(dao.as_str());
    format!("{label}.{factory}")
        .parse()
        .expect("INVALID_INSTANCE_ACCOUNT")
}

#[cfg(test)]
mod tests;
