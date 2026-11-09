use super::*;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::testing_env;
use nutus_common::{Filers, LaneConfig};

const FACTORY: &str = "nutus.near";
const DAO: &str = "marketing.sputnik-dao.near";
const USDC: &str = "usdc.near";
const ONE_NEAR: u128 = 1_000_000_000_000_000_000_000_000;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn call(pred: &str, deposit: u128, balance: u128) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(acc(FACTORY))
        .predecessor_account_id(acc(pred))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .account_balance(NearToken::from_yoctonear(balance))
        .build());
}

fn factory() -> Factory {
    call(FACTORY, 0, 100 * ONE_NEAR);
    Factory::new(
        [7u8; 32].into(),
        vec![acc(USDC)],
        vec![acc("sputnik-dao.near")],
        None,
    )
}

fn config() -> SetupConfig {
    SetupConfig {
        lanes: vec![LaneConfig {
            id: "design".into(),
            name: "Design".into(),
            token: USDC.into(),
            small_max: U128(100),
            medium_max: U128(500),
            period_cap: U128(2_000),
            period_ns: None,
            window_ns: None,
            medium_timeout_ns: None,
            objectors: None,
            filers: Filers::Anyone,
            silent_can_object: None,
            record_steps: None,
        }],
        council: Some(vec![acc("alice.near")]),
        ..Default::default()
    }
}

fn setup_msg() -> String {
    format!("setup:{}", serde_json::to_string(&config()).unwrap())
}

fn value(p: PromiseOrValue<U128>) -> u128 {
    match p {
        PromiseOrValue::Value(v) => v.0,
        PromiseOrValue::Promise(_) => panic!("expected a value"),
    }
}

#[test]
fn instance_account_uses_first_label() {
    assert_eq!(
        instance_account(&acc(DAO), &acc(FACTORY)).as_str(),
        "marketing.nutus.near"
    );
}

#[test]
#[should_panic(expected = "NO_DAO_FACTORIES")]
fn needs_dao_factories() {
    call(FACTORY, 0, ONE_NEAR);
    Factory::new([7u8; 32].into(), vec![], vec![], None);
}

#[test]
fn only_direct_children_of_allowed_dao_factories() {
    let f = factory();
    assert!(f.check_dao(&acc(DAO)).is_ok());
    assert_eq!(
        f.check_dao(&acc("x.other-dao.near")),
        Err("DAO_NOT_FROM_ALLOWED_FACTORY")
    );
    assert_eq!(
        f.check_dao(&acc("a.b.sputnik-dao.near")),
        Err("DAO_NOT_FROM_ALLOWED_FACTORY")
    );
    assert_eq!(
        f.check_dao(&acc("sputnik-dao.near")),
        Err("DAO_NOT_FROM_ALLOWED_FACTORY")
    );
}

// ──────────────────────────── NEAR path ────────────────────────────

#[test]
fn create_starts_instance_for_the_calling_dao() {
    let mut f = factory();
    call(DAO, 5 * ONE_NEAR, 100 * ONE_NEAR);
    let _ = f.create(config());
    assert_eq!(f.get_instance(acc(DAO)), Some(acc("marketing.nutus.near")));
    assert_eq!(f.list_instances(None, None).len(), 1);
}

#[test]
#[should_panic(expected = "ATTACH_STORAGE_PLUS_BUDGET")]
fn create_needs_storage_plus_budget() {
    let mut f = factory();
    call(DAO, DEFAULT_INSTANCE_STORAGE, 100 * ONE_NEAR);
    let _ = f.create(config());
}

#[test]
#[should_panic(expected = "DAO_NOT_FROM_ALLOWED_FACTORY")]
fn create_refuses_unknown_daos() {
    let mut f = factory();
    call("mallory.near", 5 * ONE_NEAR, 100 * ONE_NEAR);
    let _ = f.create(config());
}

#[test]
#[should_panic(expected = "INSTANCE_EXISTS")]
fn one_instance_per_dao() {
    let mut f = factory();
    call(DAO, 5 * ONE_NEAR, 100 * ONE_NEAR);
    let _ = f.create(config());
    let _ = f.create(config());
}

#[test]
fn failed_near_setup_refunds_and_forgets() {
    let mut f = factory();
    call(DAO, 5 * ONE_NEAR, 100 * ONE_NEAR);
    let _ = f.create(config());
    call(FACTORY, 0, 100 * ONE_NEAR);
    let out = f.on_instance_created(
        acc(DAO),
        None,
        U128(5 * ONE_NEAR),
        Err(PromiseError::Failed),
    );
    assert_eq!(value(out), 0);
    assert_eq!(f.get_instance(acc(DAO)), None);
    assert!(get_logs().iter().any(|l| l.contains("failed, refunding")));
}

#[test]
fn successful_near_setup_keeps_instance() {
    let mut f = factory();
    call(DAO, 5 * ONE_NEAR, 100 * ONE_NEAR);
    let _ = f.create(config());
    call(FACTORY, 0, 100 * ONE_NEAR);
    let out = f.on_instance_created(acc(DAO), None, U128(5 * ONE_NEAR), Ok(()));
    assert_eq!(value(out), 0);
    assert_eq!(f.get_instance(acc(DAO)), Some(acc("marketing.nutus.near")));
}

// ─────────────────────────── token path ────────────────────────────

#[test]
fn token_setup_refunds_anything_unexpected() {
    let mut f = factory();
    call("junk-token.near", 0, 100 * ONE_NEAR);
    assert_eq!(value(f.ft_on_transfer(acc(DAO), U128(9), setup_msg())), 9);
    call(USDC, 0, 100 * ONE_NEAR);
    assert_eq!(value(f.ft_on_transfer(acc(DAO), U128(9), "fund".into())), 9);
    assert_eq!(
        value(f.ft_on_transfer(acc(DAO), U128(9), "setup:{bad".into())),
        9
    );
    assert_eq!(
        value(f.ft_on_transfer(acc("mallory.near"), U128(9), setup_msg())),
        9
    );
    assert!(f.list_instances(None, None).is_empty());
}

#[test]
fn token_setup_refunds_when_factory_cannot_sponsor() {
    let mut f = factory();
    call(USDC, 0, DEFAULT_INSTANCE_STORAGE / 2);
    assert_eq!(value(f.ft_on_transfer(acc(DAO), U128(9), setup_msg())), 9);
}

#[test]
fn token_setup_creates_then_forwards() {
    let mut f = factory();
    call(USDC, 0, 100 * ONE_NEAR);
    let out = f.ft_on_transfer(acc(DAO), U128(1_000), setup_msg());
    assert!(matches!(out, PromiseOrValue::Promise(_)));
    assert_eq!(f.get_instance(acc(DAO)), Some(acc("marketing.nutus.near")));

    call(FACTORY, 0, 100 * ONE_NEAR);
    let out = f.on_instance_created(acc(DAO), Some(acc(USDC)), U128(1_000), Ok(()));
    assert!(matches!(out, PromiseOrValue::Promise(_)));
}

#[test]
fn failed_token_setup_returns_full_amount() {
    let mut f = factory();
    call(USDC, 0, 100 * ONE_NEAR);
    let _ = f.ft_on_transfer(acc(DAO), U128(1_000), setup_msg());
    call(FACTORY, 0, 100 * ONE_NEAR);
    let out = f.on_instance_created(
        acc(DAO),
        Some(acc(USDC)),
        U128(1_000),
        Err(PromiseError::Failed),
    );
    assert_eq!(value(out), 1_000);
    assert_eq!(f.get_instance(acc(DAO)), None);
}

#[test]
fn forward_result_decides_what_returns_to_the_dao() {
    let mut f = factory();
    call(FACTORY, 0, ONE_NEAR);
    assert_eq!(f.on_forwarded(U128(1_000), Ok(U128(1_000))).0, 0);
    assert_eq!(f.on_forwarded(U128(1_000), Ok(U128(0))).0, 1_000);
    assert_eq!(
        f.on_forwarded(U128(1_000), Err(PromiseError::Failed)).0,
        1_000
    );
}

#[test]
fn config_view_reports_fixed_settings() {
    let f = factory();
    let c = f.get_config();
    assert_eq!(c.instance_storage, U128(DEFAULT_INSTANCE_STORAGE));
    assert_eq!(c.setup_tokens, vec![acc(USDC)]);
    assert_eq!(c.dao_factories, vec![acc("sputnik-dao.near")]);
    assert_eq!(f.get_code_hash(), c.instance_code_hash);
}
