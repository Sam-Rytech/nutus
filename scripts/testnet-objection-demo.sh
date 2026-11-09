#!/usr/bin/env sh
# Live objection on testnet: a Small payout to a recipient who isn't
# registered with the token, objected by a council member, becomes a normal
# DAO proposal; the council approves it and the DAO pays. Shows the escalation
# fix (recipient registered on escalation) and the bond coming back.
#
# Usage: RECIPIENT=someone.testnet sh scripts/testnet-objection-demo.sh
set -eu
cd "$(dirname "$0")/.."
if python3 -c "" 2>/dev/null; then PY=python3; else PY=python; fi
. deployments/testnet.env
: "${RECIPIENT:?set RECIPIENT to an account not yet registered with $TOKEN}"
NET="network-config testnet"
SIGN="sign-with-keychain send"
INSTANCE="$(echo "$DAO" | cut -d. -f1).$FACTORY"
C1=$(echo "$COUNCIL" | cut -d, -f1)
C2=$(echo "$COUNCIL" | cut -d, -f2)
C3=$(echo "$COUNCIL" | cut -d, -f3)
step() { printf '\n== %s\n' "$*"; }

# Read-only call → its JSON result on stdout.
view() {
  near contract call-function as-read-only "$1" "$2" json-args "$3" $NET now 2>/dev/null | $PY -c '
import sys, json
lines = sys.stdin.read().splitlines()
start = next(i for i, l in enumerate(lines) if l[:1] in "{[\"0123456789n")
end = next((i for i, l in enumerate(lines) if i > start and "console command" in l), len(lines))
print(json.dumps(json.loads("\n".join(lines[start:end]).strip())))'
}
jq_() { $PY -c "import json,sys; v=json.load(sys.stdin); print(eval(sys.argv[1], {'json': json}, {'v': v}))" "$1"; }
# Send once; on failure print the CLI output and stop (never re-send).
tx() {
  out=$(near contract call-function as-transaction "$@" $NET $SIGN 2>&1) || { echo "$out"; exit 1; }
  echo "$out" | grep -E "Transaction ID" || true
}

step "Recipient $RECIPIENT registered with $TOKEN before? $(view "$TOKEN" storage_balance_of "{\"account_id\":\"$RECIPIENT\"}")"

step "Top up the instance's bond float (anyone may)"
tx "$INSTANCE" fund_bond_float json-args '{}' prepaid-gas '30.0 Tgas' attached-deposit '1.2 NEAR' sign-as "$DEPLOYER"

ID=$(view "$INSTANCE" get_config '{}' | jq_ 'v["next_payout_id"]')
step "File payout #$ID: 50 tUSDC to $RECIPIENT"
tx "$INSTANCE" file_payout \
  json-args "{\"lane_id\":\"design\",\"recipient\":\"$RECIPIENT\",\"amount\":\"50000000\",\"link\":\"https://github.com/Sam-Rytech/nutus\",\"memo\":\"objection demo\"}" \
  prepaid-gas '100.0 Tgas' attached-deposit '0.1 NEAR' sign-as "$DEPLOYER"

step "$C2 objects inside the window"
tx "$INSTANCE" object json-args "{\"payout_id\":\"$ID\",\"reason\":\"demo: needs a full vote\"}" \
  prepaid-gas '200.0 Tgas' attached-deposit '0 NEAR' sign-as "$C2"
echo "payout status: $(view "$INSTANCE" get_payout "{\"payout_id\":\"$ID\"}" | jq_ 'json.dumps(v["status"])')"
PID=$(view "$INSTANCE" get_payout "{\"payout_id\":\"$ID\"}" | jq_ 'v["status"]["Escalated"]["proposal_id"]')
echo "DAO proposal: $PID"
echo "recipient registered now: $(view "$TOKEN" storage_balance_of "{\"account_id\":\"$RECIPIENT\"}")"
view "$DAO" get_proposal "{\"id\":$PID}" | jq_ 'v["description"]'

KIND=$(view "$DAO" get_proposal "{\"id\":$PID}" | jq_ 'json.dumps(v["kind"])')
BOND_BEFORE=$(near account view-account-summary "$INSTANCE" $NET now 2>/dev/null | grep -i "Native account balance" | awk '{print $4}')

step "Council approves the DAO proposal ($C1, then $C3 executes it)"
tx "$DAO" act_proposal json-args "{\"id\":$PID,\"action\":\"VoteApprove\",\"proposal\":$KIND}" \
  prepaid-gas '50.0 Tgas' attached-deposit '0 NEAR' sign-as "$C1"
tx "$DAO" act_proposal json-args "{\"id\":$PID,\"action\":\"VoteApprove\",\"proposal\":$KIND}" \
  prepaid-gas '300.0 Tgas' attached-deposit '0 NEAR' sign-as "$C3"
echo "proposal status: $(view "$DAO" get_proposal "{\"id\":$PID}" | jq_ 'v["status"]')"
echo "recipient tUSDC: $(view "$TOKEN" ft_balance_of "{\"account_id\":\"$RECIPIENT\"}")"
BOND_AFTER=$(near account view-account-summary "$INSTANCE" $NET now 2>/dev/null | grep -i "Native account balance" | awk '{print $4}')
echo "instance NEAR: $BOND_BEFORE -> $BOND_AFTER (bond returned)"

step "Settle the escalation (anyone may; the keeper does this)"
tx "$INSTANCE" settle_escalation json-args "{\"payout_id\":\"$ID\"}" \
  prepaid-gas '60.0 Tgas' attached-deposit '0 NEAR' sign-as "$DEPLOYER"
view "$INSTANCE" get_payout "{\"payout_id\":\"$ID\"}" | jq_ 'v["status"]'
view "$INSTANCE" get_record "{\"account_id\":\"$RECIPIENT\"}"
