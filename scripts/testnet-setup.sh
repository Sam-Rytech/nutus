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
. deployments/testnet.env
NET="network-config testnet"
SIGN="sign-with-keychain send"
C1=$(echo "$COUNCIL" | cut -d, -f1)
C2=$(echo "$COUNCIL" | cut -d, -f2)
C3=$(echo "$COUNCIL" | cut -d, -f3)
INSTANCE="$(echo "$DAO" | cut -d. -f1).$FACTORY"
BUDGET="${BUDGET:-5000000000}" # 5,000 tUSDC (6 decimals)

KIND=$(python3 - "$TOKEN" "$INSTANCE" "$FACTORY" "$BUDGET" "$COUNCIL" <<'PY'
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
  | python3 -c "import json,sys; t=sys.stdin.read(); print(json.loads(t[t.index('{'):])['proposal_bond'])")
echo "DAO proposal bond: $BOND yocto"
BOND_NEAR=$(python3 -c "print(int('$BOND')/1e24)")

echo "== $C1 files the setup proposal"
near contract call-function as-transaction "$DAO" add_proposal \
  json-args "{\"proposal\":{\"description\":\"Set up Nutus: design lane, 5,000 tUSDC budget\",\"kind\":$KIND}}" \
  prepaid-gas '50.0 Tgas' attached-deposit "$BOND_NEAR NEAR" sign-as "$C1" $NET $SIGN

ID=$(near contract call-function as-read-only "$DAO" get_last_proposal_id json-args '{}' $NET now 2>/dev/null \
  | python3 -c "import sys,re; print(int(re.findall(r'\d+', sys.stdin.read())[-1]) - 1)")
echo "proposal id: $ID"

for voter in "$C2" "$C3"; do
  echo "== $voter votes approve"
  near contract call-function as-transaction "$DAO" act_proposal \
    json-args "{\"id\":$ID,\"action\":\"VoteApprove\",\"proposal\":$KIND}" \
    prepaid-gas '300.0 Tgas' attached-deposit '0 NEAR' sign-as "$voter" $NET $SIGN
done

echo "== Result"
near contract call-function as-read-only "$FACTORY" get_instance json-args "{\"dao\":\"$DAO\"}" $NET now
near contract call-function as-read-only "$INSTANCE" get_token_books json-args '{}' $NET now
near contract call-function as-read-only "$INSTANCE" get_config json-args '{}' $NET now
