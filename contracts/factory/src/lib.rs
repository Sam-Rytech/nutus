//! Nutus factory (`nutus.near`).
//!
//! Creates `<dao>.nutus.near` and points it at the instance code by **hash**
//! (NEP-591 global contract), so nobody — including the builders — can change a
//! DAO's instance later. A new instance version means a new factory.
//!
//! Phase 1 status: interface frozen; `create` / `ft_on_transfer` bodies land in Phase 4.

use near_sdk::json_types::{Base58CryptoHash, U128, U64};
use near_sdk::store::IterableMap;
use near_sdk::{
    env, near, AccountId, BorshStorageKey, PanicOnDefault, Promise, PromiseError, PromiseOrValue,
};
use nutus_common::SetupConfig;

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

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Factory {
    /// Hash of the deployed global instance code. Fixed at init; no setter.
    instance_code_hash: Base58CryptoHash,
    /// DAO account → its instance account.
    instances: IterableMap<AccountId, AccountId>,
}

#[near]
impl Factory {
    #[init]
    pub fn new(instance_code_hash: Base58CryptoHash) -> Self {
        Self {
            instance_code_hash,
            instances: IterableMap::new(StorageKey::Instances),
        }
    }

    /// NEAR path: the DAO calls this in a FunctionCall proposal, attaching the
    /// budget plus storage. The caller becomes the instance's `dao`.
    #[payable]
    pub fn create(&mut self, config: SetupConfig) -> Promise {
        let _ = config;
        todo!("Phase 4")
    }

    /// USDC/USDT path: `ft_transfer_call(nutus.near, amount, "setup:<SetupConfig json>")`
    /// from the DAO. Returns the unused amount, so a failed setup refunds the DAO.
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        let _ = (sender_id, amount, msg);
        todo!("Phase 4")
    }

    #[private]
    pub fn on_instance_created(
        &mut self,
        dao: AccountId,
        token: Option<AccountId>,
        amount: U128,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> U128 {
        let _ = (dao, token, amount, result);
        todo!("Phase 4")
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

    /// `dao.sputnik-dao.near` → `dao.nutus.near` (first label of the DAO account
    /// under this factory's account).
    pub fn instance_account_for(&self, dao: AccountId) -> AccountId {
        instance_account(&dao, &env::current_account_id())
    }
}

pub fn instance_account(dao: &AccountId, factory: &AccountId) -> AccountId {
    let label = dao.as_str().split('.').next().unwrap_or(dao.as_str());
    format!("{label}.{factory}")
        .parse()
        .expect("INVALID_INSTANCE_ACCOUNT")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn instance_account_uses_first_label() {
        let dao: AccountId = "marketing.sputnik-dao.near".parse().unwrap();
        let factory: AccountId = "nutus.near".parse().unwrap();
        assert_eq!(
            instance_account(&dao, &factory).as_str(),
            "marketing.nutus.near"
        );
    }
}
