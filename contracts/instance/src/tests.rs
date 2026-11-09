//! Unit tests (mocked blockchain). Cross-contract behaviour against the real
//! Sputnik wasm is covered by `contracts/tests` (near-workspaces) in Phase 5.

use super::*;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{test_vm_config, testing_env, PromiseResult, RuntimeFeesConfig};
use nutus_common::Filers;

const DAO: &str = "dao.sputnik-dao.near";
const SELF: &str = "dao.nutus.near";
const USDC: &str = "usdc.near";
const ALICE: &str = "alice.near"; // council
const BOB: &str = "bob.near"; // council
const FILER: &str = "filer.near";
const CAROL: &str = "carol.near"; // recipient
const ONE_NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const DEPOSIT: u128 = DEFAULT_FILING_DEPOSIT;
const HOUR: u64 = 3_600 * 1_000_000_000;
const T0: u64 = 1_000 * HOUR;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn builder(pred: &str, deposit: u128, now: u64, balance: u128) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc(SELF))
        .predecessor_account_id(acc(pred))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .block_timestamp(now)
        .account_balance(NearToken::from_yoctonear(balance));
    b
}

fn call(pred: &str, deposit: u128, now: u64) {
    testing_env!(builder(pred, deposit, now, 50 * ONE_NEAR).build());
}

fn callback_with_balance(now: u64, result: PromiseResult, balance: u128) {
    testing_env!(
        builder(SELF, 0, now, balance).build(),
        test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![result]
    );
}

fn callback(now: u64, result: PromiseResult) {
    callback_with_balance(now, result, 50 * ONE_NEAR);
}

fn ok() -> PromiseResult {
    PromiseResult::Successful(vec![])
}

fn lane_cfg() -> LaneConfig {
    LaneConfig {
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
    }
}

fn setup() -> Contract {
    call("nutus.near", 0, T0);
    let mut c = Contract::new(
        acc(DAO),
        SetupConfig {
            lanes: vec![lane_cfg()],
            council: Some(vec![acc(ALICE), acc(BOB)]),
            ..Default::default()
        },
    );
    call(USDC, 0, T0);
    assert_eq!(
        value(c.ft_on_transfer(acc(DAO), U128(10_000), "fund".into())),
        0
    );
    c
}

fn value(p: PromiseOrValue<U128>) -> u128 {
    match p {
        PromiseOrValue::Value(v) => v.0,
        PromiseOrValue::Promise(_) => panic!("expected a value"),
    }
}

fn file(c: &mut Contract, amount: u128, now: u64) -> PayoutId {
    call(FILER, DEPOSIT, now);
    c.file_payout(
        "design".into(),
        acc(CAROL),
        U128(amount),
        "https://github.com/x/pull/1".into(),
        None,
    )
}

fn usdc(c: &Contract) -> TokenBook {
    c.book(&USDC.to_string())
}

fn status(c: &Contract, id: PayoutId) -> PayoutStatus {
    c.get_payout(id).unwrap().status
}

fn check_i1(c: &Contract) {
    for (_, b) in c.tokens.iter() {
        assert_i1(b);
    }
}

fn has_event(name: &str) -> bool {
    get_logs()
        .iter()
        .any(|l| l.contains(&format!(r#""event":"{name}""#)))
}

// ─────────────────────────── init, pause ───────────────────────────

#[test]
fn init_stores_config_and_emits_events() {
    call("nutus.near", 0, T0);
    let c = Contract::new(
        acc(DAO),
        SetupConfig {
            lanes: vec![lane_cfg()],
            council: Some(vec![acc(ALICE)]),
            ..Default::default()
        },
    );
    let cfg = c.get_config();
    assert_eq!(cfg.dao, acc(DAO));
    assert_eq!(cfg.factory, acc("nutus.near"));
    assert_eq!(cfg.council, vec![acc(ALICE)]);
    assert_eq!(cfg.filing_deposit, U128(DEFAULT_FILING_DEPOSIT));
    let l = c.get_lane("design".into()).unwrap();
    assert_eq!(l.window_ns, U64(DEFAULT_WINDOW_NS));
    assert_eq!(l.period_start_ns, U64(T0));
    assert!(l.silent_can_object);
    assert!(has_event("instance_created"));
    assert!(has_event("lane_configured"));
    assert!(get_logs()
        .iter()
        .all(|l| l.contains(r#""standard":"nutus""#)));
}

#[test]
#[should_panic(expected = "BAD_TIERS")]
fn init_validates_lanes() {
    call("nutus.near", 0, T0);
    let mut lane = lane_cfg();
    lane.small_max = U128(600);
    Contract::new(
        acc(DAO),
        SetupConfig {
            lanes: vec![lane],
            ..Default::default()
        },
    );
}

#[test]
fn dao_can_pause_and_unpause() {
    let mut c = setup();
    call(DAO, 0, T0);
    c.pause();
    assert!(c.get_config().paused);
    c.unpause();
    assert!(!c.get_config().paused);
}

#[test]
#[should_panic(expected = "ONLY_DAO")]
fn others_cannot_pause() {
    let mut c = setup();
    call(ALICE, 0, T0);
    c.pause();
}

#[test]
#[should_panic(expected = "PAUSED")]
fn paused_blocks_filing() {
    let mut c = setup();
    call(DAO, 0, T0);
    c.pause();
    file(&mut c, 50, T0);
}

#[test]
fn available_subtracts_all_locks() {
    let b = TokenBook {
        balance: U128(1_000),
        reserved: U128(100),
        committed_notice: U128(300),
        standing_buffer: U128(50),
    };
    assert_eq!(available(&b), 550);
}

// ───────────────────────────── funding ─────────────────────────────

#[test]
fn ft_funding_only_from_dao() {
    let mut c = setup();
    assert_eq!(usdc(&c).balance, U128(10_000));
    assert!(has_event("funded"));
    call(USDC, 0, T0);
    assert_eq!(
        value(c.ft_on_transfer(acc(ALICE), U128(5), "fund".into())),
        5
    );
    assert_eq!(value(c.ft_on_transfer(acc(DAO), U128(5), "huh".into())), 5);
    assert_eq!(
        value(c.ft_on_transfer(acc(DAO), U128(5), "fund_standing:9".into())),
        5
    );
    assert_eq!(usdc(&c).balance, U128(10_000));
}

#[test]
fn fund_near_credits_near_book() {
    let mut c = setup();
    call(DAO, 3 * ONE_NEAR, T0);
    c.fund_near();
    let near = c.book(&NEAR_TOKEN_ID.to_string());
    assert_eq!(near.balance, U128(3 * ONE_NEAR));
}

#[test]
#[should_panic(expected = "ONLY_DAO")]
fn fund_near_only_dao() {
    let mut c = setup();
    call(ALICE, ONE_NEAR, T0);
    c.fund_near();
}

#[test]
fn bond_float_available_excludes_budget_and_deposits() {
    let mut c = setup();
    call(DAO, 3 * ONE_NEAR, T0);
    c.fund_near();
    file(&mut c, 50, T0);
    // Balance (includes the attached filing deposit, as on chain) − storage
    // − 3 NEAR budget − held deposit.
    let storage = u128::from(env::storage_usage()) * env::storage_byte_cost().as_yoctonear();
    assert!(c.deposits_held > 0);
    assert_eq!(
        c.get_config().bond_float_available.0,
        env::account_balance().as_yoctonear() - storage - 3 * ONE_NEAR - c.deposits_held
    );
}

// ────────────────────────────── lanes ──────────────────────────────

#[test]
fn replacing_lane_keeps_counters() {
    let mut c = setup();
    file(&mut c, 50, T0);
    let mut cfg = lane_cfg();
    cfg.small_max = U128(80);
    call(DAO, 0, T0 + HOUR);
    c.configure_lane(cfg);
    let l = c.get_lane("design".into()).unwrap();
    assert_eq!(l.small_max, U128(80));
    assert_eq!(l.spent_this_period, U128(50));
    assert_eq!(l.open_payouts, 1);
    assert_eq!(l.period_start_ns, U64(T0));
}

#[test]
#[should_panic(expected = "LANE_HAS_OPEN_PAYOUTS")]
fn lane_token_change_blocked_while_open() {
    let mut c = setup();
    file(&mut c, 50, T0);
    let mut cfg = lane_cfg();
    cfg.token = NEAR_TOKEN_ID.into();
    call(DAO, 0, T0);
    c.configure_lane(cfg);
}

#[test]
fn remove_lane_after_payouts_close() {
    let mut c = setup();
    let id = file(&mut c, 50, T0);
    call(FILER, 0, T0);
    c.cancel_payout(id);
    call(DAO, 0, T0);
    c.remove_lane("design".into());
    assert!(c.get_lanes().is_empty());
    assert!(has_event("lane_removed"));
}

#[test]
#[should_panic(expected = "LANE_HAS_OPEN_PAYOUTS")]
fn remove_lane_blocked_while_open() {
    let mut c = setup();
    file(&mut c, 50, T0);
    call(DAO, 0, T0);
    c.remove_lane("design".into());
}

#[test]
#[should_panic(expected = "STEPS_NOT_ASCENDING")]
fn record_steps_must_ascend() {
    let mut c = setup();
    call(DAO, 0, T0);
    c.set_record_steps(
        "design".into(),
        vec![
            RecordStep {
                min_paid_jobs: 3,
                small_max: U128(40),
            },
            RecordStep {
                min_paid_jobs: 3,
                small_max: U128(80),
            },
        ],
    );
}

// ──────────────────────────── filing ───────────────────────────────

#[test]
fn file_assigns_tiers_and_reserves() {
    let mut c = setup();
    let small = file(&mut c, 100, T0);
    let medium = file(&mut c, 101, T0);
    let p = c.get_payout(small).unwrap();
    assert_eq!(p.tier, Tier::Small);
    assert_eq!(p.deadline_ns, U64(T0 + DEFAULT_WINDOW_NS));
    assert!(p.deposit.0 < DEPOSIT && p.deposit.0 > DEPOSIT / 2);
    let m = c.get_payout(medium).unwrap();
    assert_eq!(m.tier, Tier::Medium);
    assert_eq!(m.deadline_ns, U64(T0 + DEFAULT_MEDIUM_TIMEOUT_NS));
    assert_eq!(usdc(&c).reserved, U128(201));
    assert_eq!(c.deposits_held, p.deposit.0 + m.deposit.0);
    assert_eq!(
        c.get_period_usage("design".into()).unwrap().spent,
        U128(201)
    );
    assert!(has_event("payout_filed"));
    check_i1(&c);
}

#[test]
#[should_panic(expected = "USE_FULL_VOTE")]
fn above_medium_needs_full_vote() {
    let mut c = setup();
    file(&mut c, 501, T0);
}

#[test]
#[should_panic(expected = "DEPOSIT_TOO_SMALL")]
fn filing_needs_deposit() {
    let mut c = setup();
    call(FILER, DEPOSIT - 1, T0);
    c.file_payout("design".into(), acc(CAROL), U128(10), "l".into(), None);
}

#[test]
#[should_panic(expected = "NOT_A_FILER")]
fn member_filers_enforced() {
    let mut c = setup();
    let mut cfg = lane_cfg();
    cfg.filers = Filers::Members(vec![acc(ALICE)]);
    call(DAO, 0, T0);
    c.configure_lane(cfg);
    file(&mut c, 10, T0);
}

#[test]
#[should_panic(expected = "NOT_A_FILER")]
fn role_filers_need_synced_roles() {
    let mut c = setup();
    let mut cfg = lane_cfg();
    cfg.filers = Filers::DaoMembersOfRole("council".into());
    call(DAO, 0, T0);
    c.configure_lane(cfg);
    file(&mut c, 10, T0);
}

#[test]
#[should_panic(expected = "INSUFFICIENT_BUDGET")]
fn filing_needs_available_budget() {
    let mut c = setup();
    let mut cfg = lane_cfg();
    cfg.period_cap = U128(1_000_000);
    cfg.medium_max = U128(20_000);
    call(DAO, 0, T0);
    c.configure_lane(cfg);
    file(&mut c, 10_001, T0);
}

#[test]
fn period_cap_and_reset() {
    let mut c = setup();
    for _ in 0..4 {
        file(&mut c, 500, T0);
    }
    assert_eq!(
        c.get_period_usage("design".into()).unwrap().remaining,
        U128(0)
    );
    let next = T0 + DEFAULT_PERIOD_NS + HOUR;
    let id = file(&mut c, 500, next);
    assert_eq!(c.get_payout(id).unwrap().amount, U128(500));
    let usage = c.get_period_usage("design".into()).unwrap();
    assert_eq!(usage.period_start_ns, U64(T0 + DEFAULT_PERIOD_NS));
    assert_eq!(usage.spent, U128(500));
}

#[test]
#[should_panic(expected = "PERIOD_CAP_REACHED")]
fn period_cap_enforced() {
    let mut c = setup();
    for _ in 0..4 {
        file(&mut c, 500, T0);
    }
    file(&mut c, 1, T0);
}

#[test]
fn record_steps_decide_small_vs_medium() {
    let mut c = setup();
    call(DAO, 0, T0);
    c.set_record_steps(
        "design".into(),
        vec![
            RecordStep {
                min_paid_jobs: 0,
                small_max: U128(20),
            },
            RecordStep {
                min_paid_jobs: 3,
                small_max: U128(40),
            },
        ],
    );
    let id = file(&mut c, 30, T0);
    assert_eq!(c.get_payout(id).unwrap().tier, Tier::Medium);
    c.records.insert(
        acc(CAROL),
        Record {
            paid_jobs: 3,
            ..Default::default()
        },
    );
    let id = file(&mut c, 30, T0);
    assert_eq!(c.get_payout(id).unwrap().tier, Tier::Small);
}

#[test]
fn objection_pauses_step_ups() {
    let lane = Lane {
        record_steps: vec![
            RecordStep {
                min_paid_jobs: 0,
                small_max: U128(20),
            },
            RecordStep {
                min_paid_jobs: 3,
                small_max: U128(40),
            },
        ],
        ..c_lane()
    };
    let rec = Record {
        paid_jobs: 5,
        last_objection_ns: Some(U64(T0)),
        jobs_at_last_objection: 2,
        sources: vec![],
    };
    let cooldown = DEFAULT_OBJECTION_COOLDOWN_NS;
    assert_eq!(small_limit(&lane, &rec, T0 + HOUR, cooldown), 20);
    assert_eq!(small_limit(&lane, &rec, T0 + cooldown, cooldown), 40);
}

fn c_lane() -> Lane {
    setup().get_lane("design".into()).unwrap()
}

// ──────────────────────────── release ──────────────────────────────

#[test]
#[should_panic(expected = "WINDOW_OPEN")]
fn release_waits_for_window() {
    let mut c = setup();
    let id = file(&mut c, 50, T0);
    call(ALICE, 0, T0 + DEFAULT_WINDOW_NS - 1);
    let _ = c.release(id);
}

#[test]
fn release_after_window_then_paid() {
    let mut c = setup();
    let id = file(&mut c, 50, T0);
    call("keeper.near", 0, T0 + DEFAULT_WINDOW_NS);
    let _ = c.release(id);
    assert_eq!(status(&c, id), PayoutStatus::Sending);
    assert!(has_event("payout_sending"));

    callback(T0 + DEFAULT_WINDOW_NS, ok());
    c.on_sent(id);
    assert_eq!(status(&c, id), PayoutStatus::Paid);
    assert!(has_event("payout_paid"));
    let b = usdc(&c);
    assert_eq!(b.balance, U128(9_950));
    assert_eq!(b.reserved, U128(0));
    assert_eq!(c.deposits_held, 0);
    let rec = c.get_record(acc(CAROL)).unwrap();
    assert_eq!(rec.paid_jobs, 1);
    assert_eq!(rec.sources, vec![SourceRef::NutusPayout { id }]);
    assert_eq!(c.get_lane("design".into()).unwrap().open_payouts, 0);
    // Paid money still counts against the period cap.
    assert_eq!(c.get_period_usage("design".into()).unwrap().spent, U128(50));
    check_i1(&c);
}

#[test]
#[should_panic(expected = "ALREADY_SENT")]
fn double_release_refused() {
    let mut c = setup();
    let id = file(&mut c, 50, T0);
    call("keeper.near", 0, T0 + DEFAULT_WINDOW_NS);
    let _ = c.release(id);
    let _ = c.release(id);
}

#[test]
fn failed_transfer_restores_budget() {
    let mut c = setup();
    let id = file(&mut c, 50, T0);
    call("keeper.near", 0, T0 + DEFAULT_WINDOW_NS);
    let _ = c.release(id);
    callback(T0 + DEFAULT_WINDOW_NS, PromiseResult::Failed);
    c.on_sent(id);
    assert!(matches!(status(&c, id), PayoutStatus::Failed { .. }));
    assert!(has_event("payout_failed"));
    let b = usdc(&c);
    assert_eq!(b.balance, U128(10_000));
    assert_eq!(b.reserved, U128(0));
    assert_eq!(available(&b), 10_000);
    assert_eq!(c.deposits_held, 0);
    assert_eq!(c.get_period_usage("design".into()).unwrap().spent, U128(0));
    assert!(c.get_record(acc(CAROL)).is_none());
    check_i1(&c);
}

#[test]
#[should_panic(expected = "NOT_SMALL")]
fn medium_cannot_be_released() {
    let mut c = setup();
    let id = file(&mut c, 200, T0);
    call("keeper.near", 0, T0 + DEFAULT_MEDIUM_TIMEOUT_NS);
    let _ = c.release(id);
}

// ──────────────────────────── approve ──────────────────────────────

#[test]
fn council_approves_medium() {
    let mut c = setup();
    let id = file(&mut c, 200, T0);
    call(BOB, 0, T0 + HOUR);
    let _ = c.approve(id);
    let p = c.get_payout(id).unwrap();
    assert_eq!(p.status, PayoutStatus::Sending);
    assert_eq!(p.approved_by, Some(acc(BOB)));
    assert!(has_event("payout_approved"));
}

#[test]
#[should_panic(expected = "NOT_AN_APPROVER")]
fn non_council_cannot_approve() {
    let mut c = setup();
    let id = file(&mut c, 200, T0);
    call(CAROL, 0, T0);
    let _ = c.approve(id);
}

#[test]
#[should_panic(expected = "SELF_APPROVAL")]
fn recipient_cannot_approve_own_payout() {
    let mut c = setup();
    call(ALICE, DEPOSIT, T0);
    let id = c.file_payout("design".into(), acc(BOB), U128(200), "l".into(), None);
    call(BOB, 0, T0);
    let _ = c.approve(id);
}

#[test]
#[should_panic(expected = "NOT_MEDIUM")]
fn small_cannot_be_approved() {
    let mut c = setup();
    let id = file(&mut c, 50, T0);
    call(ALICE, 0, T0);
    let _ = c.approve(id);
}

// ─────────────────────── object → escalation ───────────────────────

fn policy_json(bond: u128) -> PromiseResult {
    PromiseResult::Successful(
        json!({
            "roles": [{"name": "council", "kind": {"Group": [ALICE, BOB]},
                       "permissions": ["*:*"], "vote_policy": {}}],
            "default_vote_policy": {},
            "proposal_bond": U128(bond),
            "proposal_period": "604800000000000",
            "bounty_bond": "100000000000000000000000",
            "bounty_forgiveness_period": "86400000000000"
        })
        .to_string()
        .into_bytes(),
    )
}

fn objected(c: &mut Contract) -> PayoutId {
    let id = file(c, 50, T0);
    call(ALICE, 0, T0 + HOUR);
    let _ = c.object(id, "not delivered".into());
    id
}

#[test]
fn object_in_window_starts_escalation() {
    let mut c = setup();
    let id = objected(&mut c);
    assert_eq!(
        status(&c, id),
        PayoutStatus::Escalating {
            objected_by: Some(acc(ALICE)),
            reason: Some("not delivered".into())
        }
    );
    assert!(has_event("payout_objected"));
    let rec = c.get_record(acc(CAROL)).unwrap();
    assert_eq!(rec.last_objection_ns, Some(U64(T0 + HOUR)));
    // Still reserved until the DAO proposal exists.
    assert_eq!(usdc(&c).reserved, U128(50));
}

#[test]
#[should_panic(expected = "WINDOW_CLOSED")]
fn object_after_window_refused() {
    let mut c = setup();
    let id = file(&mut c, 50, T0);
    call(ALICE, 0, T0 + DEFAULT_WINDOW_NS);
    let _ = c.object(id, "late".into());
}

#[test]
#[should_panic(expected = "NOT_AN_OBJECTOR")]
fn non_objector_refused() {
    let mut c = setup();
    let id = file(&mut c, 50, T0);
    call(CAROL, 0, T0);
    let _ = c.object(id, "no".into());
}

#[test]
#[should_panic(expected = "NOT_AN_OBJECTOR")]
fn lane_objector_list_overrides_council() {
    let mut c = setup();
    let mut cfg = lane_cfg();
    cfg.objectors = Some(vec![acc(BOB)]);
    call(DAO, 0, T0);
    c.configure_lane(cfg);
    let id = file(&mut c, 50, T0);
    call(ALICE, 0, T0);
    let _ = c.object(id, "no".into());
}

#[test]
fn object_works_while_paused() {
    let mut c = setup();
    let id = file(&mut c, 50, T0);
    call(DAO, 0, T0);
    c.pause();
    call(ALICE, 0, T0);
    let _ = c.object(id, "hold on".into());
    assert!(matches!(status(&c, id), PayoutStatus::Escalating { .. }));
}

#[test]
fn escalation_files_proposal_then_releases_reservation() {
    let mut c = setup();
    let id = objected(&mut c);
    callback(T0 + HOUR, policy_json(ONE_NEAR));
    let next = c.on_policy_for_escalation(id, Ok(policy_from(ONE_NEAR)));
    assert!(matches!(next, PromiseOrValue::Promise(_)));

    callback(T0 + HOUR, PromiseResult::Successful(b"7".to_vec()));
    c.on_proposal_added(id, U128(ONE_NEAR), Ok(7));
    assert_eq!(
        status(&c, id),
        PayoutStatus::Escalated {
            proposal_id: U64(7)
        }
    );
    assert!(has_event("payout_escalated"));
    let b = usdc(&c);
    assert_eq!(b.reserved, U128(0));
    assert_eq!(b.balance, U128(10_000));
    assert_eq!(c.deposits_held, 0);
    assert_eq!(c.get_lane("design".into()).unwrap().open_payouts, 0);
    assert_eq!(c.get_period_usage("design".into()).unwrap().spent, U128(0));
    check_i1(&c);
}

fn policy_from(bond: u128) -> Policy {
    Policy {
        roles: vec![],
        proposal_bond: U128(bond),
    }
}

#[test]
fn short_bond_float_parks_for_manual_filing() {
    let mut c = setup();
    let id = objected(&mut c);
    callback_with_balance(T0 + HOUR, policy_json(ONE_NEAR), ONE_NEAR / 2);
    let next = c.on_policy_for_escalation(id, Ok(policy_from(ONE_NEAR)));
    assert!(matches!(next, PromiseOrValue::Value(())));
    assert_eq!(
        status(&c, id),
        PayoutStatus::Objected {
            by: acc(ALICE),
            reason: "not delivered".into(),
            needs_manual_filing: true
        }
    );
    assert!(has_event("escalation_failed"));
    assert_eq!(usdc(&c).reserved, U128(50));
}

#[test]
fn refused_proposal_parks_then_retry_and_dao_cancel() {
    let mut c = setup();
    let id = objected(&mut c);
    callback(T0 + HOUR, PromiseResult::Failed);
    c.on_proposal_added(id, U128(ONE_NEAR), Err(PromiseError::Failed));
    assert!(matches!(
        status(&c, id),
        PayoutStatus::Objected {
            needs_manual_filing: true,
            ..
        }
    ));

    call("keeper.near", 0, T0 + 2 * HOUR);
    let _ = c.escalate(id);
    assert!(matches!(status(&c, id), PayoutStatus::Escalating { .. }));
    callback(T0 + 2 * HOUR, PromiseResult::Failed);
    c.on_proposal_added(id, U128(ONE_NEAR), Err(PromiseError::Failed));

    call(DAO, 0, T0 + 3 * HOUR);
    c.cancel_payout(id);
    assert_eq!(status(&c, id), PayoutStatus::Cancelled);
    assert_eq!(usdc(&c).reserved, U128(0));
    check_i1(&c);
}

#[test]
#[should_panic(expected = "NOT_TIMED_OUT")]
fn medium_escalates_only_after_timeout() {
    let mut c = setup();
    let id = file(&mut c, 200, T0);
    call("keeper.near", 0, T0 + DEFAULT_MEDIUM_TIMEOUT_NS - 1);
    let _ = c.escalate(id);
}

#[test]
fn medium_timeout_escalates() {
    let mut c = setup();
    let id = file(&mut c, 200, T0);
    call("keeper.near", 0, T0 + DEFAULT_MEDIUM_TIMEOUT_NS);
    let _ = c.escalate(id);
    assert_eq!(
        status(&c, id),
        PayoutStatus::Escalating {
            objected_by: None,
            reason: None
        }
    );
}

#[test]
#[should_panic(expected = "NOT_MEDIUM")]
fn small_waiting_cannot_be_escalated() {
    let mut c = setup();
    let id = file(&mut c, 50, T0);
    call("keeper.near", 0, T0);
    let _ = c.escalate(id);
}

// ───────────────────────────── cancel ──────────────────────────────

#[test]
fn filer_cancels_waiting() {
    let mut c = setup();
    let id = file(&mut c, 50, T0);
    call(FILER, 0, T0);
    c.cancel_payout(id);
    assert_eq!(status(&c, id), PayoutStatus::Cancelled);
    assert_eq!(usdc(&c).reserved, U128(0));
    assert_eq!(c.deposits_held, 0);
    assert!(has_event("payout_cancelled"));
}

#[test]
#[should_panic(expected = "NOT_ALLOWED")]
fn stranger_cannot_cancel() {
    let mut c = setup();
    let id = file(&mut c, 50, T0);
    call(CAROL, 0, T0);
    c.cancel_payout(id);
}

#[test]
#[should_panic(expected = "CANNOT_CANCEL")]
fn cannot_cancel_while_sending() {
    let mut c = setup();
    let id = file(&mut c, 50, T0);
    call("keeper.near", 0, T0 + DEFAULT_WINDOW_NS);
    let _ = c.release(id);
    call(DAO, 0, T0 + DEFAULT_WINDOW_NS);
    c.cancel_payout(id);
}

// ──────────────────────────── withdraw ─────────────────────────────

#[test]
fn withdraw_debits_then_restores_on_failure() {
    let mut c = setup();
    file(&mut c, 50, T0);
    call(DAO, 0, T0);
    let _ = c.withdraw(USDC.into(), U128(9_950), None);
    assert_eq!(usdc(&c).balance, U128(50));
    check_i1(&c);

    callback(T0, PromiseResult::Failed);
    c.on_withdrawn(USDC.into(), U128(9_950), acc(DAO));
    assert_eq!(usdc(&c).balance, U128(10_000));

    call(DAO, 0, T0);
    let _ = c.withdraw(USDC.into(), U128(100), Some(acc("treasury.near")));
    callback(T0, ok());
    c.on_withdrawn(USDC.into(), U128(100), acc("treasury.near"));
    assert!(has_event("withdrawn"));
    assert_eq!(usdc(&c).balance, U128(9_900));
}

#[test]
#[should_panic(expected = "EXCEEDS_AVAILABLE")]
fn withdraw_cannot_touch_reserved() {
    let mut c = setup();
    file(&mut c, 50, T0);
    call(DAO, 0, T0);
    let _ = c.withdraw(USDC.into(), U128(9_951), None);
}

/// I2: committed notice can't be withdrawn, even by the DAO.
#[test]
#[should_panic(expected = "EXCEEDS_AVAILABLE")]
fn withdraw_cannot_touch_committed_notice() {
    let mut c = setup();
    let mut b = usdc(&c);
    b.committed_notice = U128(4_000);
    c.put_book(&USDC.to_string(), b);
    call(DAO, 0, T0);
    let _ = c.withdraw(USDC.into(), U128(6_001), None);
}

#[test]
#[should_panic(expected = "ONLY_DAO")]
fn only_dao_withdraws() {
    let mut c = setup();
    call(ALICE, 0, T0);
    let _ = c.withdraw(USDC.into(), U128(1), None);
}

// ──────────────────────── standing payments ────────────────────────

const PERIOD: u64 = 10 * HOUR;
const FIRST_DUE: u64 = T0 + PERIOD;

fn standing_input(notice_periods: u32, ends_at: Option<u64>) -> StandingInput {
    StandingInput {
        recipient: acc(CAROL),
        token: USDC.into(),
        amount: U128(100),
        period_ns: U64(PERIOD),
        first_due_ns: U64(FIRST_DUE),
        ends_at_ns: ends_at.map(U64),
        notice_periods,
        memo: Some("maintainer stipend".into()),
    }
}

fn add_standing(c: &mut Contract, notice_periods: u32, ends_at: Option<u64>) -> StandingId {
    call(DAO, 0, T0);
    c.add_standing(standing_input(notice_periods, ends_at))
}

fn fund_standing(c: &mut Contract, id: StandingId, amount: u128) {
    call(USDC, 0, T0);
    let msg = format!("fund_standing:{}", id.0);
    assert_eq!(value(c.ft_on_transfer(acc(DAO), U128(amount), msg)), 0);
}

fn st(c: &Contract, id: StandingId) -> Standing {
    c.standing_entry(id)
}

/// Delivers the callback for the in-flight standing transfer.
fn sent(c: &mut Contract, id: StandingId, now: u64, result: PromiseResult) {
    let s = st(c, id);
    assert!(s.sending);
    let total = usdc(c).reserved.0;
    let from_notice = matches!(s.state, StandingState::Noticed { .. });
    let k = (total / s.amount.0) as u32;
    let prev = U64(s.next_due_ns.0 - u64::from(k) * s.period_ns.0);
    callback(now, result);
    c.on_standing_sent(id, k, U128(total), from_notice, prev);
}

#[test]
fn add_standing_locks_notice() {
    let mut c = setup();
    let id = add_standing(&mut c, 3, None);
    let b = usdc(&c);
    assert_eq!(b.committed_notice, U128(300));
    assert_eq!(available(&b), 9_700);
    let s = st(&c, id);
    assert_eq!(s.notice_locked, U128(300));
    assert_eq!(s.state, StandingState::Active);
    assert!(has_event("standing_added"));
    check_i1(&c);
}

#[test]
#[should_panic(expected = "INSUFFICIENT_BUDGET")]
fn add_standing_needs_available_for_notice() {
    let mut c = setup();
    call(DAO, 0, T0);
    c.add_standing(standing_input(101, None));
}

#[test]
#[should_panic(expected = "ONLY_DAO")]
fn only_dao_adds_standing() {
    let mut c = setup();
    call(ALICE, 0, T0);
    c.add_standing(standing_input(1, None));
}

#[test]
fn fund_standing_fills_buffer() {
    let mut c = setup();
    let id = add_standing(&mut c, 3, None);
    fund_standing(&mut c, id, 250);
    let b = usdc(&c);
    assert_eq!(b.balance, U128(10_250));
    assert_eq!(b.standing_buffer, U128(250));
    assert_eq!(available(&b), 9_700);
    assert_eq!(st(&c, id).buffer, U128(250));
    assert!(has_event("standing_funded"));
}

#[test]
fn pay_due_waits_for_due_date() {
    let mut c = setup();
    let id = add_standing(&mut c, 3, None);
    fund_standing(&mut c, id, 250);
    call("keeper.near", 0, FIRST_DUE - 1);
    assert!(c.pay_due(id).is_none());
}

#[test]
fn pay_due_pays_every_covered_period() {
    let mut c = setup();
    let id = add_standing(&mut c, 3, None);
    fund_standing(&mut c, id, 250);
    let now = FIRST_DUE + PERIOD; // two periods due
    call("keeper.near", 0, now);
    assert!(c.pay_due(id).is_some());
    let s = st(&c, id);
    assert_eq!(s.buffer, U128(50));
    assert_eq!(s.next_due_ns, U64(FIRST_DUE + 2 * PERIOD));
    assert_eq!(usdc(&c).reserved, U128(200));
    check_i1(&c);

    sent(&mut c, id, now, ok());
    let b = usdc(&c);
    assert_eq!(b.balance, U128(10_050));
    assert_eq!(b.reserved, U128(0));
    assert_eq!(b.standing_buffer, U128(50));
    assert!(!st(&c, id).sending);
    assert!(has_event("standing_paid"));
    check_i1(&c);
}

#[test]
fn short_buffer_keeps_payment_due() {
    let mut c = setup();
    let id = add_standing(&mut c, 3, None);
    fund_standing(&mut c, id, 50);
    call("keeper.near", 0, FIRST_DUE);
    assert!(c.pay_due(id).is_none());
    assert!(has_event("standing_short"));
    assert_eq!(st(&c, id).next_due_ns, U64(FIRST_DUE));
    assert_eq!(usdc(&c).reserved, U128(0));
}

#[test]
fn partial_buffer_pays_what_it_covers() {
    let mut c = setup();
    let id = add_standing(&mut c, 3, None);
    fund_standing(&mut c, id, 150);
    call("keeper.near", 0, FIRST_DUE + PERIOD);
    assert!(c.pay_due(id).is_some());
    assert!(has_event("standing_short"));
    assert_eq!(usdc(&c).reserved, U128(100));
    assert_eq!(st(&c, id).next_due_ns, U64(FIRST_DUE + PERIOD));
}

#[test]
#[should_panic(expected = "ALREADY_SENDING")]
fn no_second_pay_while_sending() {
    let mut c = setup();
    let id = add_standing(&mut c, 3, None);
    fund_standing(&mut c, id, 500);
    call("keeper.near", 0, FIRST_DUE);
    let _ = c.pay_due(id);
    let _ = c.pay_due(id);
}

#[test]
fn failed_standing_transfer_restores_buffer() {
    let mut c = setup();
    let id = add_standing(&mut c, 3, None);
    fund_standing(&mut c, id, 250);
    call("keeper.near", 0, FIRST_DUE);
    let _ = c.pay_due(id);
    sent(&mut c, id, FIRST_DUE, PromiseResult::Failed);
    let s = st(&c, id);
    assert_eq!(s.buffer, U128(250));
    assert_eq!(s.next_due_ns, U64(FIRST_DUE));
    let b = usdc(&c);
    assert_eq!(b.balance, U128(10_250));
    assert_eq!(b.standing_buffer, U128(250));
    assert_eq!(b.reserved, U128(0));
    assert!(has_event("standing_failed"));
    check_i1(&c);
}

#[test]
#[should_panic(expected = "PAUSED")]
fn pause_stops_regular_standing_payments() {
    let mut c = setup();
    let id = add_standing(&mut c, 3, None);
    fund_standing(&mut c, id, 250);
    call(DAO, 0, T0);
    c.pause();
    call("keeper.near", 0, FIRST_DUE);
    let _ = c.pay_due(id);
}

#[test]
fn stop_starts_notice_and_releases_buffer() {
    let mut c = setup();
    let id = add_standing(&mut c, 3, None);
    fund_standing(&mut c, id, 250);
    call(DAO, 0, T0 + HOUR);
    c.stop_standing(id);
    let s = st(&c, id);
    assert_eq!(
        s.state,
        StandingState::Noticed {
            notice_started_ns: U64(T0 + HOUR),
            remaining_periods: 3
        }
    );
    assert_eq!(s.buffer, U128(0));
    let b = usdc(&c);
    assert_eq!(b.standing_buffer, U128(0));
    assert_eq!(b.committed_notice, U128(300));
    assert_eq!(available(&b), 9_950);
    assert!(has_event("standing_stopped"));
    check_i1(&c);
}

/// I2 with a real standing payment: after stop, the DAO still can't pull notice money.
#[test]
#[should_panic(expected = "EXCEEDS_AVAILABLE")]
fn dao_cannot_withdraw_notice_after_stop() {
    let mut c = setup();
    let id = add_standing(&mut c, 3, None);
    call(DAO, 0, T0);
    c.stop_standing(id);
    let _ = c.withdraw(USDC.into(), U128(9_701), None);
}

#[test]
fn notice_is_paid_even_while_paused_then_ends() {
    let mut c = setup();
    let id = add_standing(&mut c, 3, None);
    call(DAO, 0, T0);
    c.stop_standing(id);
    c.pause();

    let now = FIRST_DUE + PERIOD; // two due
    call("keeper.near", 0, now);
    assert!(c.pay_due(id).is_some());
    let s = st(&c, id);
    assert_eq!(s.notice_locked, U128(100));
    assert!(matches!(
        s.state,
        StandingState::Noticed {
            remaining_periods: 1,
            ..
        }
    ));
    sent(&mut c, id, now, ok());
    assert!(has_event("standing_paid"));

    let later = FIRST_DUE + 5 * PERIOD; // more due than notice left
    call("keeper.near", 0, later);
    assert!(c.pay_due(id).is_some());
    sent(&mut c, id, later, ok());
    let s = st(&c, id);
    assert_eq!(s.state, StandingState::Ended);
    assert_eq!(s.notice_locked, U128(0));
    let b = usdc(&c);
    assert_eq!(b.balance, U128(9_700));
    assert_eq!(b.committed_notice, U128(0));
    assert_eq!(available(&b), 9_700);
    assert!(has_event("standing_ended"));
    check_i1(&c);

    call("keeper.near", 0, later + PERIOD);
    assert!(c.pay_due(id).is_none());
}

#[test]
fn failed_notice_payment_is_due_again() {
    let mut c = setup();
    let id = add_standing(&mut c, 2, None);
    call(DAO, 0, T0);
    c.stop_standing(id);
    call("keeper.near", 0, FIRST_DUE);
    let _ = c.pay_due(id);
    sent(&mut c, id, FIRST_DUE, PromiseResult::Failed);
    let s = st(&c, id);
    assert_eq!(s.notice_locked, U128(200));
    assert!(matches!(
        s.state,
        StandingState::Noticed {
            remaining_periods: 2,
            ..
        }
    ));
    assert_eq!(usdc(&c).committed_notice, U128(200));
    check_i1(&c);
}

#[test]
fn stop_without_notice_ends_now() {
    let mut c = setup();
    let id = add_standing(&mut c, 0, None);
    fund_standing(&mut c, id, 100);
    call(DAO, 0, T0);
    c.stop_standing(id);
    assert_eq!(st(&c, id).state, StandingState::Ended);
    assert_eq!(available(&usdc(&c)), 10_100);
    assert!(has_event("standing_ended"));
}

#[test]
fn end_date_caps_payments_and_releases_notice() {
    let mut c = setup();
    let id = add_standing(&mut c, 2, Some(FIRST_DUE + 2 * PERIOD));
    fund_standing(&mut c, id, 1_000);
    let now = FIRST_DUE + 10 * PERIOD;
    call("keeper.near", 0, now);
    assert!(c.pay_due(id).is_some());
    assert_eq!(usdc(&c).reserved, U128(200)); // only the two before the end
    sent(&mut c, id, now, ok());
    let s = st(&c, id);
    assert_eq!(s.state, StandingState::Ended);
    let b = usdc(&c);
    assert_eq!(b.committed_notice, U128(0));
    assert_eq!(b.standing_buffer, U128(0));
    assert_eq!(available(&b), 10_800);
    check_i1(&c);
}

#[test]
fn due_periods_respects_end() {
    let mut c = setup();
    let id = add_standing(&mut c, 0, Some(FIRST_DUE + PERIOD + 1));
    let s = st(&c, id);
    assert_eq!(due_periods(&s, FIRST_DUE - 1), 0);
    assert_eq!(due_periods(&s, FIRST_DUE), 1);
    assert_eq!(due_periods(&s, FIRST_DUE + 100 * PERIOD), 2);
}

// ────────────────────────────── records ────────────────────────────

#[test]
fn seed_records_counts_each_proposal_once() {
    let mut c = setup();
    call(DAO, 0, T0);
    c.seed_records(vec![
        SeedEntry {
            account: acc(CAROL),
            proposal_ids: vec![U64(3), U64(9), U64(9)],
        },
        SeedEntry {
            account: acc(BOB),
            proposal_ids: vec![U64(4)],
        },
    ]);
    assert_eq!(c.get_record(acc(CAROL)).unwrap().paid_jobs, 2);
    assert_eq!(c.get_record(acc(BOB)).unwrap().paid_jobs, 1);
    c.seed_records(vec![SeedEntry {
        account: acc(CAROL),
        proposal_ids: vec![U64(3)],
    }]);
    let rec = c.get_record(acc(CAROL)).unwrap();
    assert_eq!(rec.paid_jobs, 2);
    assert_eq!(
        rec.sources,
        vec![
            SourceRef::DaoProposal { id: U64(3) },
            SourceRef::DaoProposal { id: U64(9) }
        ]
    );
    assert!(has_event("records_seeded"));
}

#[test]
#[should_panic(expected = "ONLY_DAO")]
fn only_dao_seeds_records() {
    let mut c = setup();
    call(CAROL, 0, T0);
    c.seed_records(vec![SeedEntry {
        account: acc(CAROL),
        proposal_ids: vec![U64(1)],
    }]);
}

fn escalated(c: &mut Contract) -> PayoutId {
    let id = objected(c);
    callback(T0 + HOUR, policy_json(ONE_NEAR));
    let _ = c.on_policy_for_escalation(id, Ok(policy_from(ONE_NEAR)));
    callback(T0 + HOUR, PromiseResult::Successful(b"7".to_vec()));
    c.on_proposal_added(id, U128(ONE_NEAR), Ok(7));
    id
}

fn proposal(status: ProposalStatus) -> Proposal {
    Proposal { status }
}

#[test]
fn approved_escalation_counts_in_record() {
    let mut c = setup();
    let id = escalated(&mut c);
    call("keeper.near", 0, T0 + 2 * HOUR);
    let _ = c.settle_escalation(id);
    callback(T0 + 2 * HOUR, ok());
    c.on_escalation_proposal(id, Ok(proposal(ProposalStatus::Approved)));
    assert_eq!(
        status(&c, id),
        PayoutStatus::Settled {
            proposal_id: U64(7),
            approved: true
        }
    );
    let rec = c.get_record(acc(CAROL)).unwrap();
    assert_eq!(rec.paid_jobs, 1);
    assert_eq!(rec.sources, vec![SourceRef::DaoProposal { id: U64(7) }]);
    assert!(has_event("escalation_settled"));
}

#[test]
fn rejected_escalation_settles_without_points() {
    let mut c = setup();
    let id = escalated(&mut c);
    callback(T0 + 2 * HOUR, ok());
    c.on_escalation_proposal(id, Ok(proposal(ProposalStatus::Rejected)));
    assert_eq!(
        status(&c, id),
        PayoutStatus::Settled {
            proposal_id: U64(7),
            approved: false
        }
    );
    assert_eq!(c.get_record(acc(CAROL)).unwrap().paid_jobs, 0);
}

#[test]
#[should_panic(expected = "PROPOSAL_IN_PROGRESS")]
fn open_proposal_cannot_settle() {
    let mut c = setup();
    let id = escalated(&mut c);
    callback(T0 + 2 * HOUR, ok());
    c.on_escalation_proposal(id, Ok(proposal(ProposalStatus::InProgress)));
}

#[test]
#[should_panic(expected = "NOT_ESCALATED")]
fn only_escalated_payouts_settle() {
    let mut c = setup();
    let id = file(&mut c, 50, T0);
    call("keeper.near", 0, T0);
    let _ = c.settle_escalation(id);
}

// ─────────────────────────── council sync ──────────────────────────

fn role(name: &str, kind: RoleKind, perms: &[&str]) -> sputnik::RolePermission {
    sputnik::RolePermission {
        name: name.into(),
        kind,
        permissions: perms.iter().map(|p| p.to_string()).collect(),
    }
}

#[test]
fn sync_council_uses_transfer_approvers_and_caches_roles() {
    let mut c = setup();
    let policy = Policy {
        roles: vec![
            role("all", RoleKind::Everyone, &["*:AddProposal"]),
            role(
                "council",
                RoleKind::Group(vec![acc("dan.near"), acc("eve.near")]),
                &["transfer:VoteApprove", "transfer:VoteReject"],
            ),
            role(
                "contributors",
                RoleKind::Group(vec![acc(FILER)]),
                &["*:AddProposal"],
            ),
            role("holders", RoleKind::Member(U128(1)), &["*:*"]),
        ],
        proposal_bond: U128(ONE_NEAR),
    };
    call("keeper.near", 0, T0);
    let _ = c.sync_council();
    callback(T0, ok());
    c.on_council_policy(Ok(policy));
    assert_eq!(
        c.get_config().council,
        vec![acc("dan.near"), acc("eve.near")]
    );
    assert!(has_event("council_synced"));

    // Role-based filers now work.
    let mut cfg = lane_cfg();
    cfg.filers = Filers::DaoMembersOfRole("contributors".into());
    call(DAO, 0, T0);
    c.configure_lane(cfg);
    file(&mut c, 10, T0);
}

#[test]
#[should_panic(expected = "NO_GROUP_APPROVERS")]
fn sync_council_refuses_to_empty_the_council() {
    let mut c = setup();
    callback(T0, ok());
    c.on_council_policy(Ok(Policy {
        roles: vec![role("all", RoleKind::Everyone, &["*:*"])],
        proposal_bond: U128(ONE_NEAR),
    }));
}

// ─────────────────────── Sputnik JSON shapes ───────────────────────

#[test]
fn reads_real_sputnik_policy_and_proposal_json() {
    let policy: Policy = near_sdk::serde_json::from_str(
        r#"{"roles":[{"name":"all","kind":"Everyone","permissions":["*:AddProposal"],"vote_policy":{}},
            {"name":"council","kind":{"Group":["a.near","b.near"]},"permissions":["*:*"],"vote_policy":{}},
            {"name":"token","kind":{"Member":"1"},"permissions":["*:VoteApprove"],"vote_policy":{}}],
            "default_vote_policy":{"weight_kind":"RoleWeight","quorum":"0","threshold":[1,2]},
            "proposal_bond":"1000000000000000000000000","proposal_period":"604800000000000",
            "bounty_bond":"1000000000000000000000000","bounty_forgiveness_period":"86400000000000"}"#,
    )
    .unwrap();
    assert_eq!(policy.proposal_bond, U128(ONE_NEAR));
    assert_eq!(
        policy.roles[1].kind,
        RoleKind::Group(vec![acc("a.near"), acc("b.near")])
    );

    let proposal: Proposal = near_sdk::serde_json::from_str(
        r#"{"id":7,"proposer":"x.near","description":"d",
            "kind":{"Transfer":{"token_id":"","receiver_id":"c.near","amount":"1","msg":null}},
            "status":"Approved","vote_counts":{},"votes":{},"submission_time":"1"}"#,
    )
    .unwrap();
    assert_eq!(proposal.status, ProposalStatus::Approved);
}

#[test]
fn writes_sputnik_add_proposal_args() {
    let p = ProposalInput {
        description: "d".into(),
        kind: ProposalKind::Transfer {
            token_id: SPUTNIK_NEAR_TOKEN.into(),
            receiver_id: acc(CAROL),
            amount: U128(50),
            msg: None,
        },
    };
    let v = json!({ "proposal": p });
    assert_eq!(
        v,
        json!({"proposal": {"description": "d", "kind": {"Transfer": {
            "token_id": "", "receiver_id": "carol.near", "amount": "50", "msg": null}}}})
    );
}

// ────────────────────────── setup funding ──────────────────────────

#[test]
fn init_books_attached_near_as_budget() {
    call("nutus.near", 2 * ONE_NEAR, T0);
    let c = Contract::new(acc(DAO), SetupConfig::default());
    assert_eq!(
        c.book(&NEAR_TOKEN_ID.to_string()).balance,
        U128(2 * ONE_NEAR)
    );
    assert!(has_event("funded"));
}

#[test]
fn factory_may_forward_setup_budget_only_as_fund() {
    let mut c = setup();
    call(USDC, 0, T0);
    assert_eq!(
        value(c.ft_on_transfer(acc("nutus.near"), U128(500), "fund".into())),
        0
    );
    assert_eq!(usdc(&c).balance, U128(10_500));
    let id = add_standing(&mut c, 0, None);
    call(USDC, 0, T0);
    let msg = format!("fund_standing:{}", id.0);
    assert_eq!(value(c.ft_on_transfer(acc("nutus.near"), U128(5), msg)), 5);
}

// ───────────────────── property test: I1–I5 ─────────────────────
//
// Random sequences of every state-changing call, with callbacks delivered
// late, out of order, and succeeding or failing at random. Only calls whose
// preconditions hold are issued (the mocked VM doesn't roll back a panic).
// After every step: I1–I5 plus exact accounting against an outside model.

mod prop {
    use super::*;
    use std::collections::{BTreeMap, BTreeSet};

    /// xorshift64*: deterministic, no extra dependency.
    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> u64 {
            self.0 ^= self.0 >> 12;
            self.0 ^= self.0 << 25;
            self.0 ^= self.0 >> 27;
            self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
        }
        fn below(&mut self, n: u64) -> u64 {
            self.next() % n.max(1)
        }
        fn chance(&mut self, pct: u64) -> bool {
            self.below(100) < pct
        }
        fn pick<T: Clone>(&mut self, v: &[T]) -> Option<T> {
            if v.is_empty() {
                None
            } else {
                Some(v[self.below(v.len() as u64) as usize].clone())
            }
        }
    }

    enum Pending {
        Sent(PayoutId),
        Withdrawn(u128),
        StandingSent {
            id: StandingId,
            periods: u32,
            total: u128,
            from_notice: bool,
            prev: U64,
        },
        Policy(PayoutId),
        ProposalAdded(PayoutId),
        Settle(PayoutId),
    }

    struct World {
        c: Contract,
        rng: Rng,
        now: u64,
        pending: Vec<Pending>,
        /// What the USDC balance must be: funded − paid − withdrawn.
        model_balance: u128,
        next_proposal: u64,
        steps: u32,
    }

    const LANE: &str = "prop";
    const P_WINDOW: u64 = 2 * HOUR;
    const P_TIMEOUT: u64 = 6 * HOUR;
    const P_PERIOD: u64 = 24 * HOUR;
    const S_PERIOD: u64 = 12 * HOUR;

    impl World {
        fn new(seed: u64) -> Self {
            // Fresh, empty chain: testing_env! carries storage across calls.
            near_sdk::env::set_blockchain_interface(near_sdk::MockedBlockchain::new(
                builder("nutus.near", 0, T0, 50 * ONE_NEAR).build(),
                test_vm_config(),
                RuntimeFeesConfig::test(),
                vec![],
                Default::default(),
                Default::default(),
                None,
            ));
            let mut cfg = lane_cfg();
            cfg.id = LANE.into();
            cfg.period_cap = U128(3_000);
            cfg.period_ns = Some(U64(P_PERIOD));
            cfg.window_ns = Some(U64(P_WINDOW));
            cfg.medium_timeout_ns = Some(U64(P_TIMEOUT));
            let mut c = Contract::new(
                acc(DAO),
                SetupConfig {
                    lanes: vec![cfg],
                    council: Some(vec![acc(ALICE), acc(BOB)]),
                    ..Default::default()
                },
            );
            call(USDC, 0, T0);
            let _ = c.ft_on_transfer(acc(DAO), U128(20_000), "fund".into());
            World {
                c,
                rng: Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1),
                now: T0,
                pending: vec![],
                model_balance: 20_000,
                next_proposal: 0,
                steps: 0,
            }
        }

        fn as_(&self, who: &str, deposit: u128) {
            call(who, deposit, self.now);
        }

        fn payouts(&self) -> Vec<Payout> {
            self.c.payouts.iter().cloned().collect()
        }

        fn standings(&self) -> Vec<Standing> {
            self.c.standing.iter().cloned().collect()
        }

        fn ids_where(&self, f: impl Fn(&Payout) -> bool) -> Vec<PayoutId> {
            self.payouts()
                .into_iter()
                .filter(|p| f(p))
                .map(|p| p.id)
                .collect()
        }

        fn step(&mut self) {
            self.steps += 1;
            match self.rng.below(17) {
                0 | 1 => self.now += self.rng.below(3 * HOUR),
                2 => self.now += self.rng.below(2 * P_PERIOD),
                3 | 4 => self.file(),
                5 => self.release(),
                6 => self.approve(),
                7 => self.object(),
                8 => self.escalate(),
                9 => self.cancel(),
                10 => self.withdraw(),
                11 => self.fund(),
                12 => self.standing_op(),
                13 => self.toggle_pause(),
                14 => self.settle(),
                _ => self.deliver(),
            }
            self.check();
        }

        fn file(&mut self) {
            if self.c.paused {
                return;
            }
            let amount = 1 + u128::from(self.rng.below(500));
            self.as_(FILER, DEPOSIT);
            let usage = self.c.get_period_usage(LANE.into()).unwrap();
            if usage.remaining.0 < amount || available(&usdc(&self.c)) < amount {
                return;
            }
            self.c
                .file_payout(LANE.into(), acc(CAROL), U128(amount), "l".into(), None);
        }

        fn release(&mut self) {
            let now = self.now;
            let ids = self.ids_where(|p| {
                p.status == PayoutStatus::Waiting && p.tier == Tier::Small && now >= p.deadline_ns.0
            });
            if self.c.paused {
                return;
            }
            if let Some(id) = self.rng.pick(&ids) {
                self.as_("keeper.near", 0);
                let _ = self.c.release(id);
                self.pending.push(Pending::Sent(id));
            }
        }

        fn approve(&mut self) {
            let ids =
                self.ids_where(|p| p.status == PayoutStatus::Waiting && p.tier == Tier::Medium);
            if self.c.paused {
                return;
            }
            if let Some(id) = self.rng.pick(&ids) {
                self.as_(ALICE, 0);
                let _ = self.c.approve(id);
                self.pending.push(Pending::Sent(id));
            }
        }

        fn object(&mut self) {
            let now = self.now;
            let ids = self.ids_where(|p| {
                p.status == PayoutStatus::Waiting && p.tier == Tier::Small && now < p.deadline_ns.0
            });
            if let Some(id) = self.rng.pick(&ids) {
                self.as_(BOB, 0);
                let _ = self.c.object(id, "not done".into());
                self.pending.push(Pending::Policy(id));
            }
        }

        fn escalate(&mut self) {
            let now = self.now;
            let ids = self.ids_where(|p| match &p.status {
                PayoutStatus::Waiting => p.tier == Tier::Medium && now >= p.deadline_ns.0,
                PayoutStatus::Objected {
                    needs_manual_filing,
                    ..
                } => *needs_manual_filing,
                _ => false,
            });
            if let Some(id) = self.rng.pick(&ids) {
                self.as_("keeper.near", 0);
                let _ = self.c.escalate(id);
                self.pending.push(Pending::Policy(id));
            }
        }

        fn cancel(&mut self) {
            let ids = self.ids_where(|p| {
                matches!(
                    p.status,
                    PayoutStatus::Waiting | PayoutStatus::Objected { .. }
                )
            });
            if let Some(id) = self.rng.pick(&ids) {
                let waiting = self.c.get_payout(id).unwrap().status == PayoutStatus::Waiting;
                let who = if waiting && self.rng.chance(50) {
                    FILER
                } else {
                    DAO
                };
                self.as_(who, 0);
                self.c.cancel_payout(id);
            }
        }

        fn withdraw(&mut self) {
            let avail = available(&usdc(&self.c));
            if avail == 0 {
                return;
            }
            let amount = 1 + u128::from(self.rng.below(avail.min(5_000) as u64));
            let notice_before = usdc(&self.c).committed_notice;
            self.as_(DAO, 0);
            let _ = self.c.withdraw(USDC.into(), U128(amount), None);
            // I2: withdraw never touches committed notice.
            assert_eq!(usdc(&self.c).committed_notice, notice_before, "I2");
            // Debited up front; the callback credits it back on failure.
            self.model_balance -= amount;
            self.pending.push(Pending::Withdrawn(amount));
        }

        fn fund(&mut self) {
            let amount = 1 + u128::from(self.rng.below(3_000));
            self.as_(USDC, 0);
            if self.rng.chance(60) || self.c.standing.is_empty() {
                let _ = self.c.ft_on_transfer(acc(DAO), U128(amount), "fund".into());
                self.model_balance += amount;
            } else {
                let s = self.rng.pick(&self.standings()).unwrap();
                let left = value(self.c.ft_on_transfer(
                    acc(DAO),
                    U128(amount),
                    format!("fund_standing:{}", s.id.0),
                ));
                self.model_balance += amount - left;
            }
        }

        fn standing_op(&mut self) {
            let all = self.standings();
            match self.rng.below(3) {
                0 => {
                    let amount = 10 + u128::from(self.rng.below(90));
                    let notice = self.rng.below(4) as u32;
                    if available(&usdc(&self.c)) < amount * u128::from(notice) {
                        return;
                    }
                    let first = self.now + self.rng.below(S_PERIOD);
                    let ends = self.rng.chance(30).then(|| U64(first + 5 * S_PERIOD));
                    self.as_(DAO, 0);
                    self.c.add_standing(StandingInput {
                        recipient: acc(CAROL),
                        token: USDC.into(),
                        amount: U128(amount),
                        period_ns: U64(S_PERIOD),
                        first_due_ns: U64(first),
                        ends_at_ns: ends,
                        notice_periods: notice,
                        memo: None,
                    });
                }
                1 => {
                    let ok: Vec<_> = all
                        .iter()
                        .filter(|s| {
                            !s.sending
                                && match s.state {
                                    StandingState::Ended => false,
                                    StandingState::Active => !self.c.paused,
                                    StandingState::Noticed { .. } => true,
                                }
                        })
                        .cloned()
                        .collect();
                    let Some(before) = self.rng.pick(&ok) else {
                        return;
                    };
                    self.as_("keeper.near", 0);
                    let sent = self.c.pay_due(before.id).is_some();
                    let after = self.c.standing_entry(before.id);
                    if sent {
                        let periods = ((after.next_due_ns.0 - before.next_due_ns.0)
                            / before.period_ns.0) as u32;
                        self.pending.push(Pending::StandingSent {
                            id: before.id,
                            periods,
                            total: before.amount.0 * u128::from(periods),
                            from_notice: matches!(before.state, StandingState::Noticed { .. }),
                            prev: before.next_due_ns,
                        });
                    }
                }
                _ => {
                    let ok: Vec<_> = all
                        .iter()
                        .filter(|s| s.state == StandingState::Active && !s.sending)
                        .map(|s| s.id)
                        .collect();
                    if let Some(id) = self.rng.pick(&ok) {
                        self.as_(DAO, 0);
                        self.c.stop_standing(id);
                    }
                }
            }
        }

        fn toggle_pause(&mut self) {
            self.as_(DAO, 0);
            if self.c.paused {
                self.c.unpause();
            } else if self.rng.chance(40) {
                self.c.pause();
            }
        }

        fn settle(&mut self) {
            let ids = self.ids_where(|p| matches!(p.status, PayoutStatus::Escalated { .. }));
            let in_flight: BTreeSet<u64> = self
                .pending
                .iter()
                .filter_map(|p| match p {
                    Pending::Settle(id) => Some(id.0),
                    _ => None,
                })
                .collect();
            let ids: Vec<_> = ids
                .into_iter()
                .filter(|i| !in_flight.contains(&i.0))
                .collect();
            if let Some(id) = self.rng.pick(&ids) {
                self.as_("keeper.near", 0);
                let _ = self.c.settle_escalation(id);
                self.pending.push(Pending::Settle(id));
            }
        }

        fn deliver(&mut self) {
            if self.pending.is_empty() {
                return;
            }
            let i = self.rng.below(self.pending.len() as u64) as usize;
            let job = self.pending.swap_remove(i);
            let ok = self.rng.chance(75);
            let result = if ok {
                ok_result()
            } else {
                PromiseResult::Failed
            };
            let balance = if self.rng.chance(85) {
                50 * ONE_NEAR
            } else {
                ONE_NEAR / 2
            };
            callback_with_balance(self.now, result, balance);
            match job {
                Pending::Sent(id) => {
                    let amount = self.c.get_payout(id).unwrap().amount.0;
                    self.c.on_sent(id);
                    if ok {
                        self.model_balance -= amount;
                    }
                }
                Pending::Withdrawn(amount) => {
                    self.c.on_withdrawn(USDC.into(), U128(amount), acc(DAO));
                    if !ok {
                        self.model_balance += amount;
                    }
                }
                Pending::StandingSent {
                    id,
                    periods,
                    total,
                    from_notice,
                    prev,
                } => {
                    self.c
                        .on_standing_sent(id, periods, U128(total), from_notice, prev);
                    if ok {
                        self.model_balance -= total;
                    }
                }
                Pending::Policy(id) => {
                    let policy = if ok {
                        Ok(policy_from(ONE_NEAR))
                    } else {
                        Err(PromiseError::Failed)
                    };
                    if let PromiseOrValue::Promise(_) = self.c.on_policy_for_escalation(id, policy)
                    {
                        self.pending.push(Pending::ProposalAdded(id));
                    }
                }
                Pending::ProposalAdded(id) => {
                    let r = if ok {
                        self.next_proposal += 1;
                        Ok(self.next_proposal)
                    } else {
                        Err(PromiseError::Failed)
                    };
                    self.c.on_proposal_added(id, U128(ONE_NEAR), r);
                }
                Pending::Settle(id) => {
                    let status = if ok {
                        ProposalStatus::Approved
                    } else {
                        ProposalStatus::Rejected
                    };
                    self.c.on_escalation_proposal(id, Ok(Proposal { status }));
                }
            }
        }

        fn check(&self) {
            let ctx = format!("step {}", self.steps);
            let b = usdc(&self.c);
            // I1 on every book.
            for (_, book) in self.c.tokens.iter() {
                assert_i1(book);
            }
            // Balance matches the outside model.
            assert_eq!(b.balance.0, self.model_balance, "balance model, {ctx}");

            let payouts = self.payouts();
            let open = |p: &Payout| {
                matches!(
                    p.status,
                    PayoutStatus::Waiting
                        | PayoutStatus::Escalating { .. }
                        | PayoutStatus::Objected { .. }
                        | PayoutStatus::Sending
                )
            };
            let standing_in_flight: u128 = self
                .pending
                .iter()
                .map(|p| match p {
                    Pending::StandingSent { total, .. } => *total,
                    _ => 0,
                })
                .sum();
            let reserved: u128 = payouts
                .iter()
                .filter(|p| open(p))
                .map(|p| p.amount.0)
                .sum::<u128>()
                + standing_in_flight;
            assert_eq!(b.reserved.0, reserved, "reserved, {ctx}");
            let standings = self.standings();
            assert_eq!(
                b.standing_buffer.0,
                standings.iter().map(|s| s.buffer.0).sum::<u128>(),
                "standing_buffer, {ctx}"
            );
            assert_eq!(
                b.committed_notice.0,
                standings.iter().map(|s| s.notice_locked.0).sum::<u128>(),
                "committed_notice, {ctx}"
            );
            for s in &standings {
                if s.state == StandingState::Ended {
                    assert_eq!(
                        (s.buffer.0, s.notice_locked.0),
                        (0, 0),
                        "ended standing, {ctx}"
                    );
                }
            }
            assert_eq!(
                self.c.deposits_held,
                payouts
                    .iter()
                    .filter(|p| open(p))
                    .map(|p| p.deposit.0)
                    .sum::<u128>(),
                "deposits_held, {ctx}"
            );
            let lane = self.c.get_lane(LANE.into()).unwrap();
            assert_eq!(
                lane.open_payouts as usize,
                payouts.iter().filter(|p| open(p)).count(),
                "open_payouts, {ctx}"
            );

            // I3: a payout is Sending exactly while its transfer callback is pending.
            let sending: BTreeSet<u64> = payouts
                .iter()
                .filter(|p| p.status == PayoutStatus::Sending)
                .map(|p| p.id.0)
                .collect();
            let awaited: BTreeSet<u64> = self
                .pending
                .iter()
                .filter_map(|p| match p {
                    Pending::Sent(id) => Some(id.0),
                    _ => None,
                })
                .collect();
            assert_eq!(sending, awaited, "I3, {ctx}");

            // I5: every record point references a real Paid payout or an
            // escalation the DAO approved.
            let mut approved_proposals = BTreeMap::new();
            for p in &payouts {
                if let PayoutStatus::Settled {
                    proposal_id,
                    approved: true,
                } = p.status
                {
                    approved_proposals.insert(proposal_id.0, p.recipient.clone());
                }
            }
            if let Some(rec) = self.c.records.get(&acc(CAROL)) {
                assert_eq!(
                    rec.paid_jobs as usize,
                    rec.sources.len(),
                    "paid_jobs, {ctx}"
                );
                for src in &rec.sources {
                    match src {
                        SourceRef::NutusPayout { id } => assert_eq!(
                            self.c.get_payout(*id).unwrap().status,
                            PayoutStatus::Paid,
                            "I5 payout, {ctx}"
                        ),
                        SourceRef::DaoProposal { id } => {
                            assert!(approved_proposals.contains_key(&id.0), "I5 proposal, {ctx}")
                        }
                    }
                }
            }
        }
    }

    fn ok_result() -> PromiseResult {
        PromiseResult::Successful(vec![])
    }

    /// `NUTUS_PROP_SEEDS=200 cargo test prop` for a longer run.
    #[test]
    fn invariants_hold_over_random_sequences() {
        let seeds: u64 = std::env::var("NUTUS_PROP_SEEDS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(20);
        let mut seen = BTreeSet::new();
        for seed in 1..=seeds {
            let mut w = World::new(seed);
            for _ in 0..200 {
                w.step();
            }
            // Drain every callback, then check once more.
            while !w.pending.is_empty() {
                w.deliver();
                w.check();
            }
            for p in w.payouts() {
                seen.insert(format!("{:?}", p.status.kind()));
            }
            for s in w.standings() {
                seen.insert(match s.state {
                    StandingState::Active => "StandingActive".into(),
                    StandingState::Noticed { .. } => "StandingNoticed".into(),
                    StandingState::Ended => "StandingEnded".into(),
                });
            }
        }
        // Guard against a vacuous run: the sequences must reach these states.
        for state in [
            "Paid",
            "Failed",
            "Escalated",
            "Settled",
            "Objected",
            "Cancelled",
            "StandingNoticed",
            "StandingEnded",
        ] {
            assert!(
                seen.contains(state),
                "random runs never reached {state}: {seen:?}"
            );
        }
    }

    type DaoOnlyCall = Box<dyn Fn(&mut Contract)>;

    /// I4: every DAO-only method refuses any other caller.
    #[test]
    fn dao_only_methods_refuse_others() {
        let mut c = setup();
        let id = add_standing(&mut c, 1, None);
        let attempts: Vec<DaoOnlyCall> = vec![
            Box::new(|c| c.configure_lane(lane_cfg())),
            Box::new(|c| c.remove_lane("design".into())),
            Box::new(|c| c.set_record_steps("design".into(), vec![])),
            Box::new(|c| c.seed_records(vec![])),
            Box::new(|c| {
                c.add_standing(standing_input(1, None));
            }),
            Box::new(move |c| c.stop_standing(id)),
            Box::new(|c| c.pause()),
            Box::new(|c| c.unpause()),
            Box::new(|c| {
                let _ = c.withdraw(USDC.into(), U128(1), None);
            }),
            Box::new(|c| c.set_bond_float(U128(1))),
            Box::new(|c| c.set_filing_deposit(U128(1))),
            Box::new(|c| c.fund_near()),
            Box::new(move |c| c.fund_standing_near(id)),
        ];
        for (i, attempt) in attempts.iter().enumerate() {
            call(ALICE, ONE_NEAR, T0);
            let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| attempt(&mut c)));
            assert!(r.is_err(), "DAO-only method #{i} accepted a non-DAO caller");
        }
        // Funding from anyone but the DAO (or its factory) is refunded, not booked.
        call(USDC, 0, T0);
        assert_eq!(
            value(c.ft_on_transfer(acc(ALICE), U128(7), "fund".into())),
            7
        );
    }
}
