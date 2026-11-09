#!/usr/bin/env sh
# Set up Nutus for the demo DAO the real way: one DAO FunctionCall proposal on
# the token with two actions (spec §4), approved by 2 of 3 council members.
#   1. storage_deposit(<dao>.<factory>)            registers the instance
#   2. ft_transfer_call(<factory>, amount, "setup:<config>")
# Then checks that the instance exists and holds the budget (answers Q2: does
# create + global code + init + forward fit in one ft_on_transfer?).
#
# Usage: sh scripts/testnet-setup.sh      (after scripts/testnet-deploy.sh)
set -eu
cd "$(dirname "$0")/.."
# Windows ships a python3 stub that only opens the Store; use whichever runs.
if python3 -c "" 2>/dev/null; then PY=python3; else PY=python; fi
. deployments/testnet.env
NET="network-config testnet"
SIGN="sign-with-keychain send"
C1=$(echo "$COUNCIL" | cut -d, -f1)
C2=$(echo "$COUNCIL" | cut -d, -f2)
C3=$(echo "$COUNCIL" | cut -d, -f3)
INSTANCE="$(echo "$DAO" | cut -d. -f1).$FACTORY"
BUDGET="${BUDGET:-5000000000}" # 5,000 tUSDC (6 decimals)

KIND=$($PY - "$TOKEN" "$INSTANCE" "$FACTORY" "$BUDGET" "$COUNCIL" <<'PY'
import base64, json, sys
token, instance, factory, budget, council = sys.argv[1:]
b64 = lambda o: base64.b64encode(json.dumps(o).encode()).decode()
config = {
  "lanes": [{
    "id": "design", "name": "Design", "token": token,
    "small_max": "100000000", "medium_max": "500000000", "period_cap": "2000000000",
    "filers": "Anyone",
  }],
  "council": council.split(","),
}
print(json.dumps({"FunctionCall": {"receiver_id": token, "actions": [
  {"method_name": "storage_deposit",
   "args": b64({"account_id": instance, "registration_only": True}),
   "deposit": "1250000000000000000000", "gas": "10000000000000"},
  {"method_name": "ft_transfer_call",
   "args": b64({"receiver_id": factory, "amount": budget,
                "msg": "setup:" + json.dumps(config)}),
   "deposit": "1", "gas": "250000000000000"},
]}}))
PY
)

BOND=$(near contract call-function as-read-only "$DAO" get_policy json-args '{}' $NET now 2>/dev/null \
  | $PY -c "import json,sys; t=sys.stdin.read(); print(json.loads(t[t.index('{'):])['proposal_bond'])")
echo "DAO proposal bond: $BOND yocto"
BOND_NEAR=$($PY -c "print(int('$BOND')/1e24)")

# PROPOSAL_ID=<n> resumes an already-filed setup proposal (just votes).
if [ -z "${PROPOSAL_ID:-}" ]; then
  echo "== $C1 files the setup proposal"
  near contract call-function as-transaction "$DAO" add_proposal     json-args "{\"proposal\":{\"description\":\"Set up Nutus: design lane, 5,000 tUSDC budget\",\"kind\":$KIND}}"     prepaid-gas '50.0 Tgas' attached-deposit "$BOND_NEAR NEAR" sign-as "$C1" $NET $SIGN
  LAST=$(near contract call-function as-read-only "$DAO" get_last_proposal_id json-args '{}' $NET now 2>/dev/null     | $PY -c "import sys,re; print(re.search(r'^\s*(\d+)\s*$', sys.stdin.read(), re.M).group(1))")
  PROPOSAL_ID=$((LAST - 1))
fi
ID=$PROPOSAL_ID
echo "proposal id: $ID"

# Default policy: 2 of 3 approve. The first vote is cheap; the deciding vote
# executes the proposal (10 + 250 TGas of actions), so it carries 300 TGas.
vote() {
  echo "== $1 votes approve ($2)"
  near contract call-function as-transaction "$DAO" act_proposal     json-args "{\"id\":$ID,\"action\":\"VoteApprove\",\"proposal\":$KIND}"     prepaid-gas "$2" attached-deposit '0 NEAR' sign-as "$1" $NET $SIGN
}
vote "$C2" '50.0 Tgas'
vote "$C3" '300.0 Tgas'

echo "== Result"
near contract call-function as-read-only "$FACTORY" get_instance json-args "{\"dao\":\"$DAO\"}" $NET now
near contract call-function as-read-only "$INSTANCE" get_token_books json-args '{}' $NET now
near contract call-function as-read-only "$INSTANCE" get_config json-args '{}' $NET now
