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
