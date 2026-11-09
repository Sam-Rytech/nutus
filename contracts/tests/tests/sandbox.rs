//! End-to-end on a sandbox node with the real Sputnik DAO v2 wasm.
//! Linux/macOS only (no Windows sandbox build); CI runs these.

mod common;

use anyhow::Result;
use common::*;
use serde_json::json;

/// Setup through a real DAO proposal (USDC path): the instance exists, uses
/// the DAO as owner and the council from the config, and holds the budget.
#[tokio::test]
async fn setup_through_a_real_dao_proposal() -> Result<()> {
    let env = Env::new().await?;
    let cfg = env.view(&env.instance, "get_config", json!({})).await?;
    assert_eq!(cfg["dao"], env.dao.as_str());
    assert_eq!(cfg["factory"], env.factory.id().as_str());
    assert_eq!(cfg["council"].as_array().unwrap().len(), 3);
    let book = env.books().await?;
    assert_eq!(n(&book["balance"]), 5_000 * TOKEN_UNIT);
    assert_eq!(n(&book["available"]), 5_000 * TOKEN_UNIT);
    assert_eq!(env.ft_balance(&env.instance).await?, 5_000 * TOKEN_UNIT);
    assert_eq!(env.ft_balance(&env.dao).await?, 5_000 * TOKEN_UNIT);
    let listed = env
        .view(env.factory.id(), "get_instance", json!({"dao": env.dao}))
        .await?;
    assert_eq!(listed, env.instance.as_str());
    env.assert_i1().await
}

/// A second setup for the same DAO, and a malformed one, both refund the DAO
/// in full and create nothing.
#[tokio::test]
async fn failed_setup_refunds_the_dao() -> Result<()> {
    let env = Env::new().await?;
    let before = env.ft_balance(&env.dao).await?;
    for msg in ["setup:{\"lanes\":[]}", "setup:{not json"] {
        let kind = fcall(
            env.token.id(),
            &[(
                "ft_transfer_call",
                json!({"receiver_id": env.factory.id(), "amount": (100 * TOKEN_UNIT).to_string(), "msg": msg}),
                1,
                200,
            )],
        );
        let (_, status) = env.dao_do(&env.dao.clone(), "bad setup", kind).await?;
        assert_eq!(
            status, "Approved",
            "the transfer itself executes; the factory refunds"
        );
        assert_eq!(
            env.ft_balance(&env.dao).await?,
            before,
            "DAO refunded for {msg}"
        );
    }
    assert_eq!(env.ft_balance(env.factory.id()).await?, 0);
    Ok(())
}

/// NEAR path: `create` with budget attached; a NEAR payout to an account that
/// doesn't exist fails and restores the budget.
#[tokio::test]
async fn near_path_setup_and_failed_transfer_restores_budget() -> Result<()> {
    let env = Env::new().await?;
    let dao2 = env.new_dao("second").await?;
    let instance2 = env.instance_for(&dao2).await?;
    let config = json!({"lanes": [lane("near")],
                        "council": env.council.iter().map(|c| c.id()).collect::<Vec<_>>()});
    // Budget 5 NEAR (tier limits are in yocto here: 100/500 units of 1e6 yocto).
    let kind = fcall(
        env.factory.id(),
        &[(
            "create",
            json!({"config": config}),
            5_250_000_000_000_000_000_000_000,
            250,
        )],
    );
    let (_, status) = env.dao_do(&dao2, "Set up Nutus (NEAR)", kind).await?;
    assert_eq!(status, "Approved");
    let books = env.view(&instance2, "get_token_books", json!({})).await?;
    let near_book = &books.as_array().unwrap()[0];
    assert_eq!(near_book["token"], "near");
    assert_eq!(n(&near_book["balance"]), 5_000_000_000_000_000_000_000_000);

    // Payout to a named account that doesn't exist → transfer fails.
    let ghost: near_workspaces::AccountId = format!("ghost.{}", env.root.id()).parse()?;
    let id: String = ok(env
        .filer
        .call(&instance2, "file_payout")
        .args_json(
            json!({"lane_id": "design", "recipient": ghost, "amount": (50 * TOKEN_UNIT).to_string(),
                          "link": "l", "memo": null}),
        )
        .deposit(milli(100))
        .max_gas()
        .transact()
        .await?)?
    .json()?;
    let deadline: u64 = env
        .view(&instance2, "get_payout", json!({"payout_id": id}))
        .await?["deadline_ns"]
        .as_str()
        .unwrap()
        .parse()?;
    env.wait_until(deadline).await?;
    let _ = env
        .keeper
        .call(&instance2, "release")
        .args_json(json!({"payout_id": id}))
        .max_gas()
        .transact()
        .await?;
    let p = env
        .view(&instance2, "get_payout", json!({"payout_id": id}))
        .await?;
    assert!(
        p["status"].get("Failed").is_some(),
        "expected Failed, got {}",
        p["status"]
    );
    let books = env.view(&instance2, "get_token_books", json!({})).await?;
    let b = &books.as_array().unwrap()[0];
    assert_eq!(n(&b["reserved"]), 0);
    assert_eq!(n(&b["available"]), 5_000_000_000_000_000_000_000_000);
    Ok(())
}

/// Small payout: released after the window, recipient registered on the way,
/// record +1. A second release is refused (I3).
#[tokio::test]
async fn small_payout_released_after_window() -> Result<()> {
    let env = Env::new().await?;
    let id = env.file(50 * TOKEN_UNIT).await?;
    let early = env
        .keeper
        .call(&env.instance, "release")
        .args_json(json!({"payout_id": id}))
        .max_gas()
        .transact()
        .await?;
    assert!(format!("{:?}", early.failures()).contains("WINDOW_OPEN"));

    let deadline: u64 = env.payout(&id).await?["deadline_ns"]
        .as_str()
        .unwrap()
        .parse()?;
    env.wait_until(deadline).await?;
    done(
        env.keeper
            .call(&env.instance, "release")
            .args_json(json!({"payout_id": id}))
            .max_gas()
            .transact()
            .await?,
    )?;
    assert_eq!(env.payout(&id).await?["status"], "Paid");
    assert_eq!(env.ft_balance(env.carol.id()).await?, 50 * TOKEN_UNIT);
    let rec = env
        .view(
            &env.instance,
            "get_record",
            json!({"account_id": env.carol.id()}),
        )
        .await?;
    assert_eq!(rec["paid_jobs"], 1);

    let again = env
        .keeper
        .call(&env.instance, "release")
        .args_json(json!({"payout_id": id}))
        .max_gas()
        .transact()
        .await?;
    assert!(format!("{:?}", again.failures()).contains("ALREADY_SENT"));
    assert_eq!(
        env.ft_balance(env.carol.id()).await?,
        50 * TOKEN_UNIT,
        "paid once"
    );
    env.assert_i1().await
}

/// Objection inside the window files a real Sputnik Transfer proposal with
/// the right token, recipient, amount and description, paid for with the
/// DAO's exact bond. Approving it pays the recipient from the treasury,
/// returns the bond to the instance, and settle_escalation records it.
#[tokio::test]
async fn objection_becomes_a_real_dao_proposal() -> Result<()> {
    let env = Env::new().await?;
    done(
        env.root
            .call(&env.instance, "fund_bond_float")
            .deposit(near(2))
            .transact()
            .await?,
    )?;
    let id = env.file(80 * TOKEN_UNIT).await?;

    // Not an objector → refused.
    let r = env
        .filer
        .call(&env.instance, "object")
        .args_json(json!({"payout_id": id, "reason": "nope"}))
        .max_gas()
        .transact()
        .await?;
    assert!(format!("{:?}", r.failures()).contains("NOT_AN_OBJECTOR"));

    done(
        env.council[0]
            .call(&env.instance, "object")
            .args_json(json!({"payout_id": id, "reason": "work not delivered"}))
            .max_gas()
            .transact()
            .await?,
    )?;
    let status = env.payout(&id).await?["status"].clone();
    let pid = status["Escalated"]["proposal_id"]
        .as_str()
        .unwrap_or_else(|| panic!("expected Escalated, got {status}"))
        .parse::<u64>()?;
    assert_eq!(
        n(&env.books().await?["reserved"]),
        0,
        "DAO pays now, not Nutus"
    );

    let proposal = env.proposal(&env.dao, pid).await?;
    let t = &proposal["kind"]["Transfer"];
    assert_eq!(t["token_id"], env.token.id().as_str());
    assert_eq!(t["receiver_id"], env.carol.id().as_str());
    assert_eq!(n(&t["amount"]), 80 * TOKEN_UNIT);
    let desc = proposal["description"].as_str().unwrap();
    assert!(
        desc.contains(&format!("objected by {}", env.council[0].id())),
        "{desc}"
    );
    assert!(
        desc.contains("work not delivered") && desc.contains("Escalated payout #"),
        "{desc}"
    );
    assert_eq!(proposal["proposer"], env.instance.as_str());

    // The council approves it the normal way; the bond comes back.
    let before = env.near_balance(&env.instance).await?;
    env.approve_proposal(&env.dao, pid).await?;
    assert_eq!(env.proposal(&env.dao, pid).await?["status"], "Approved");
    assert_eq!(env.ft_balance(env.carol.id()).await?, 80 * TOKEN_UNIT);
    let after = env.near_balance(&env.instance).await?;
    assert!(
        after > before + 900_000_000_000_000_000_000_000,
        "bond returned: {before} → {after}"
    );

    done(
        env.keeper
            .call(&env.instance, "settle_escalation")
            .args_json(json!({"payout_id": id}))
            .max_gas()
            .transact()
            .await?,
    )?;
    assert_eq!(
        env.payout(&id).await?["status"]["Settled"]["approved"],
        true
    );
    let rec = env
        .view(
            &env.instance,
            "get_record",
            json!({"account_id": env.carol.id()}),
        )
        .await?;
    assert_eq!(rec["paid_jobs"], 1);
    assert_eq!(rec["sources"][0]["DaoProposal"]["id"], pid.to_string());

    // After the window, objections are refused.
    let late = env.file(10 * TOKEN_UNIT).await?;
    let deadline: u64 = env.payout(&late).await?["deadline_ns"]
        .as_str()
        .unwrap()
        .parse()?;
    env.wait_until(deadline).await?;
    let r = env.council[1]
        .call(&env.instance, "object")
        .args_json(json!({"payout_id": late, "reason": "late"}))
        .max_gas()
        .transact()
        .await?;
    assert!(format!("{:?}", r.failures()).contains("WINDOW_CLOSED"));
    env.assert_i1().await
}

/// Medium: the first approval releases; an unapproved one escalates after
/// the timeout.
#[tokio::test]
async fn medium_approve_and_timeout() -> Result<()> {
    let env = Env::new().await?;
    done(
        env.root
            .call(&env.instance, "fund_bond_float")
            .deposit(near(2))
            .transact()
            .await?,
    )?;
    let a = env.file(200 * TOKEN_UNIT).await?;
    assert_eq!(env.payout(&a).await?["tier"], "Medium");
    done(
        env.council[1]
            .call(&env.instance, "approve")
            .args_json(json!({"payout_id": a}))
            .max_gas()
            .transact()
            .await?,
    )?;
    assert_eq!(env.payout(&a).await?["status"], "Paid");
    assert_eq!(env.ft_balance(env.carol.id()).await?, 200 * TOKEN_UNIT);

    let b = env.file(300 * TOKEN_UNIT).await?;
    let r = env
        .keeper
        .call(&env.instance, "escalate")
        .args_json(json!({"payout_id": b}))
        .max_gas()
        .transact()
        .await?;
    assert!(format!("{:?}", r.failures()).contains("NOT_TIMED_OUT"));
    let deadline: u64 = env.payout(&b).await?["deadline_ns"]
        .as_str()
        .unwrap()
        .parse()?;
    env.wait_until(deadline).await?;
    done(
        env.keeper
            .call(&env.instance, "escalate")
            .args_json(json!({"payout_id": b}))
            .max_gas()
            .transact()
            .await?,
    )?;
    let status = env.payout(&b).await?["status"].clone();
    let pid: u64 = status["Escalated"]["proposal_id"]
        .as_str()
        .unwrap()
        .parse()?;
    let desc = env.proposal(&env.dao, pid).await?["description"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(desc.contains("not approved in time"), "{desc}");

    // Above medium_max → full DAO vote.
    let r = env
        .filer
        .call(&env.instance, "file_payout")
        .args_json(json!({"lane_id": "design", "recipient": env.carol.id(),
                          "amount": (501 * TOKEN_UNIT).to_string(), "link": "l", "memo": null}))
        .deposit(milli(100))
        .max_gas()
        .transact()
        .await?;
    assert!(format!("{:?}", r.failures()).contains("USE_FULL_VOTE"));
    env.assert_i1().await
}

/// Standing payment: paid per period from the buffer; stop starts notice,
/// which is paid even while paused; the DAO can't withdraw committed notice
/// (I2), even through its own proposal.
#[tokio::test]
async fn standing_payment_notice_is_guaranteed() -> Result<()> {
    let env = Env::new().await?;
    let amount = 10 * TOKEN_UNIT;
    let period = 10 * SEC;
    let first_due = env.now().await? + 5 * SEC;
    let status = env
        .dao_call(
            "add_standing",
            json!({"standing": {
        "recipient": env.carol.id(), "token": env.token.id(), "amount": amount.to_string(),
        "period_ns": period.to_string(), "first_due_ns": first_due.to_string(),
        "ends_at_ns": null, "notice_periods": 2, "memo": "maintainer"}}),
            0,
        )
        .await?;
    assert_eq!(status, "Approved");
    let book = env.books().await?;
    assert_eq!(n(&book["committed_notice"]), 2 * amount);

    // Fund the buffer for one period through the DAO.
    let kind = fcall(
        env.token.id(),
        &[(
            "ft_transfer_call",
            json!({"receiver_id": env.instance, "amount": amount.to_string(), "msg": "fund_standing:0"}),
            1,
            100,
        )],
    );
    assert_eq!(
        env.dao_do(&env.dao.clone(), "fund standing", kind).await?.1,
        "Approved"
    );
    assert_eq!(n(&env.books().await?["standing_buffer"]), amount);

    env.wait_until(first_due + period).await?; // two periods due, buffer covers one
    done(
        env.keeper
            .call(&env.instance, "pay_due")
            .args_json(json!({"standing_id": "0"}))
            .max_gas()
            .transact()
            .await?,
    )?;
    assert_eq!(env.ft_balance(env.carol.id()).await?, amount);

    // I2: withdrawing more than `available` fails inside the DAO's proposal.
    let available = n(&env.books().await?["available"]);
    let status = env
        .dao_call(
            "withdraw",
            json!({"token": env.token.id(), "amount": (available + 1).to_string(), "to": null}),
            0,
        )
        .await?;
    assert_eq!(status, "Failed", "withdraw into committed notice must fail");
    assert_eq!(n(&env.books().await?["committed_notice"]), 2 * amount);

    // Stop → notice; pause; notice still pays out in full.
    assert_eq!(
        env.dao_call("stop_standing", json!({"standing_id": "0"}), 0)
            .await?,
        "Approved"
    );
    assert_eq!(env.dao_call("pause", json!({}), 0).await?, "Approved");
    let s = &env.view(&env.instance, "get_standing", json!({})).await?[0];
    let next: u64 = s["next_due_ns"].as_str().unwrap().parse()?;
    env.wait_until(next + period).await?;
    done(
        env.keeper
            .call(&env.instance, "pay_due")
            .args_json(json!({"standing_id": "0"}))
            .max_gas()
            .transact()
            .await?,
    )?;
    assert_eq!(env.ft_balance(env.carol.id()).await?, 3 * amount);
    let s = &env.view(&env.instance, "get_standing", json!({})).await?[0];
    assert_eq!(s["state"], "Ended");
    assert_eq!(n(&env.books().await?["committed_notice"]), 0);
    env.assert_i1().await
}

/// sync_council follows the DAO's own policy after a membership change.
#[tokio::test]
async fn sync_council_follows_dao_policy() -> Result<()> {
    let env = Env::new().await?;
    let dave = sub(&env.root, "dave", 5).await?;
    let kind = json!({"AddMemberToRole": {"member_id": dave.id(), "role": "council"}});
    assert_eq!(
        env.dao_do(&env.dao.clone(), "add dave", kind).await?.1,
        "Approved"
    );
    done(
        env.keeper
            .call(&env.instance, "sync_council")
            .max_gas()
            .transact()
            .await?,
    )?;
    let council = env.view(&env.instance, "get_config", json!({})).await?["council"].clone();
    assert!(
        council
            .as_array()
            .unwrap()
            .iter()
            .any(|m| m == dave.id().as_str()),
        "{council}"
    );
    assert_eq!(council.as_array().unwrap().len(), 4);
    Ok(())
}

/// The DAO's exact bond comes back to the instance however the escalated
/// proposal ends: rejected by vote, or expired and then finalized. Either way
/// settle_escalation closes the payout without a record point.
#[tokio::test]
async fn bond_returns_on_reject_and_on_expire() -> Result<()> {
    let env = Env::new().await?;
    done(
        env.root
            .call(&env.instance, "fund_bond_float")
            .deposit(near(3))
            .transact()
            .await?,
    )?;

    let escalate = |reason: &'static str| {
        let env = &env;
        async move {
            let id = env.file(20 * TOKEN_UNIT).await?;
            done(
                env.council[0]
                    .call(&env.instance, "object")
                    .args_json(json!({"payout_id": id, "reason": reason}))
                    .max_gas()
                    .transact()
                    .await?,
            )?;
            let pid: u64 = env.payout(&id).await?["status"]["Escalated"]["proposal_id"]
                .as_str()
                .unwrap()
                .parse()?;
            anyhow::Ok((id, pid))
        }
    };
    let act = |pid: u64, action: &'static str, who: usize| {
        let env = &env;
        async move {
            let kind = env.proposal(&env.dao, pid).await?["kind"].clone();
            let r = env.council[who]
                .call(&env.dao, "act_proposal")
                .args_json(json!({"id": pid, "action": action, "proposal": kind}))
                .max_gas()
                .transact()
                .await?;
            anyhow::ensure!(r.is_success(), "{action} failed: {:#?}", r.failures());
            anyhow::Ok(())
        }
    };
    let settle_rejected = |id: String| {
        let env = &env;
        async move {
            done(
                env.keeper
                    .call(&env.instance, "settle_escalation")
                    .args_json(json!({"payout_id": id}))
                    .max_gas()
                    .transact()
                    .await?,
            )?;
            assert_eq!(
                env.payout(&id).await?["status"]["Settled"]["approved"],
                false
            );
            anyhow::Ok(())
        }
    };

    // Rejected by vote.
    let (id, pid) = escalate("reject me").await?;
    let before = env.near_balance(&env.instance).await?;
    act(pid, "VoteReject", 1).await?;
    act(pid, "VoteReject", 2).await?;
    assert_eq!(env.proposal(&env.dao, pid).await?["status"], "Rejected");
    let after = env.near_balance(&env.instance).await?;
    assert!(
        after > before + 900_000_000_000_000_000_000_000,
        "bond back on reject: {before} → {after}"
    );
    settle_rejected(id).await?;

    // Expired, then finalized. Shorten the DAO's proposal period first.
    let kind = json!({"ChangePolicyUpdateParameters": {"parameters": {
        "proposal_bond": null, "proposal_period": (15 * SEC).to_string(),
        "bounty_bond": null, "bounty_forgiveness_period": null}}});
    assert_eq!(
        env.dao_do(&env.dao.clone(), "short proposals", kind)
            .await?
            .1,
        "Approved"
    );
    let (id, pid) = escalate("let it expire").await?;
    let before = env.near_balance(&env.instance).await?;
    env.wait_until(env.now().await? + 20 * SEC).await?;
    act(pid, "Finalize", 1).await?;
    assert_eq!(env.proposal(&env.dao, pid).await?["status"], "Expired");
    let after = env.near_balance(&env.instance).await?;
    assert!(
        after > before + 900_000_000_000_000_000_000_000,
        "bond back on finalize: {before} → {after}"
    );
    settle_rejected(id).await?;

    let rec = env
        .view(
            &env.instance,
            "get_record",
            json!({"account_id": env.carol.id()}),
        )
        .await?;
    assert_eq!(
        rec["paid_jobs"], 0,
        "no points for rejected or expired escalations"
    );
    env.assert_i1().await
}
