#!/usr/bin/env sh
# Deploy Nutus to NEAR testnet: global instance code (by hash), factory, test
# token, a Sputnik demo DAO with 3 council members, and test tokens for the DAO.
#
# Needs: near CLI (near-cli-rs), cargo-near, Python 3, and a funded testnet
# account whose key is in your keychain:  near account import-account ...
#
# Usage:
#   DEPLOYER=you.testnet sh scripts/testnet-deploy.sh
#
# Optional env:
#   FACTORY    (default nutus.$DEPLOYER)
#   TOKEN      (default tusdc.$DEPLOYER)
#   DAO_NAME   (default nutus-demo)        -> $DAO_NAME.sputnikv2.testnet
#   COUNCIL    (default c1/c2/c3.$DEPLOYER, created and funded here)
#
# Writes deployments/testnet.env for scripts/testnet-setup.sh.
set -eu
cd "$(dirname "$0")/.."
# Windows ships a python3 stub that only opens the Store; use whichever runs.
if python3 -c "" 2>/dev/null; then PY=python3; else PY=python; fi

: "${DEPLOYER:?set DEPLOYER to your funded testnet account}"
FACTORY="${FACTORY:-nutus.$DEPLOYER}"
TOKEN="${TOKEN:-tusdc.$DEPLOYER}"
DAO_NAME="${DAO_NAME:-nutus-demo}"
DAO="$DAO_NAME.sputnikv2.testnet"
NET="network-config testnet"
SIGN="sign-with-keychain send"

step() { printf '\n== %s\n' "$*"; }

step "Build wasm + ABI"
sh scripts/abi.sh
(cd contracts/test-token && cargo near build non-reproducible-wasm --no-abi)
INSTANCE_WASM=target/near/nutus_instance/nutus_instance.wasm
FACTORY_WASM=target/near/nutus_factory/nutus_factory.wasm
TOKEN_WASM=target/near/nutus_test_token/nutus_test_token.wasm

HASH=$($PY - "$INSTANCE_WASM" <<'PY'
import hashlib, sys
d = hashlib.sha256(open(sys.argv[1], "rb").read()).digest()
a = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
n = int.from_bytes(d, "big"); s = ""
while n: n, r = divmod(n, 58); s = a[r] + s
print("1" * (len(d) - len(d.lstrip(b"\0"))) + s)
PY
)
echo "instance code hash: $HASH"

step "Deploy instance code as a global contract (by hash) from $DEPLOYER"
near contract deploy-as-global use-file "$INSTANCE_WASM" as-global-hash "$DEPLOYER" $NET $SIGN

step "Create council accounts"
if [ -z "${COUNCIL:-}" ]; then
  COUNCIL="c1.$DEPLOYER,c2.$DEPLOYER,c3.$DEPLOYER"
  # c1 files the setup proposal (pays the 1 NEAR bond, refunded on approval);
  # c2 and c3 only vote, so they just need gas.
  for c in "c1:1.5" "c2:0.3" "c3:0.3"; do
    near account create-account fund-myself "${c%%:*}.$DEPLOYER" "${c#*:} NEAR" \
      autogenerate-new-keypair save-to-keychain sign-as "$DEPLOYER" $NET $SIGN
  done
fi
COUNCIL_JSON=$($PY -c "import json,sys; print(json.dumps(sys.argv[1].split(',')))" "$COUNCIL")

step "Create + deploy test token $TOKEN"
# 152 KB of code = ~1.5 NEAR locked storage.
near account create-account fund-myself "$TOKEN" '1.8 NEAR' \
  autogenerate-new-keypair save-to-keychain sign-as "$DEPLOYER" $NET $SIGN
near contract deploy "$TOKEN" use-file "$TOKEN_WASM" \
  with-init-call new json-args '{"symbol":"tUSDC","decimals":6}' \
  prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' $NET $SIGN

step "Create + deploy factory $FACTORY"
# 219 KB of code = ~2.2 NEAR locked, plus 0.25 NEAR per sponsored instance.
near account create-account fund-myself "$FACTORY" '2.8 NEAR' \
  autogenerate-new-keypair save-to-keychain sign-as "$DEPLOYER" $NET $SIGN
near contract deploy "$FACTORY" use-file "$FACTORY_WASM" \
  with-init-call new json-args "{\"instance_code_hash\":\"$HASH\",\"setup_tokens\":[\"$TOKEN\"],\"dao_factories\":[\"sputnikv2.testnet\"]}" \
  prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' $NET $SIGN

step "Register the factory with $TOKEN"
# ft_transfer_call panics if the receiver isn't registered with the token. The
# DAO's setup proposal registers the new instance; the factory registers once
# here, so setup stays one proposal with two actions.
near contract call-function as-transaction "$TOKEN" storage_deposit \
  json-args "{\"account_id\":\"$FACTORY\",\"registration_only\":true}" \
  prepaid-gas '30.0 Tgas' attached-deposit '0.00125 NEAR' sign-as "$DEPLOYER" $NET $SIGN

step "Create demo DAO $DAO (Sputnik v2, council: $COUNCIL)"
ARGS=$($PY -c "
import base64, json, sys
print(base64.b64encode(json.dumps({
  'config': {'name': sys.argv[1], 'purpose': 'Nutus testnet demo', 'metadata': ''},
  'policy': json.loads(sys.argv[2])}).encode()).decode())" "$DAO_NAME" "$COUNCIL_JSON")
near contract call-function as-transaction sputnikv2.testnet create \
  json-args "{\"name\":\"$DAO_NAME\",\"args\":\"$ARGS\"}" \
  prepaid-gas '150.0 Tgas' attached-deposit '6 NEAR' sign-as "$DEPLOYER" $NET $SIGN

step "Mint 10,000 tUSDC to the DAO"
near contract call-function as-transaction "$TOKEN" mint \
  json-args "{\"account_id\":\"$DAO\",\"amount\":\"10000000000\"}" \
  prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' sign-as "$DEPLOYER" $NET $SIGN

mkdir -p deployments
cat > deployments/testnet.env <<EOF
DEPLOYER=$DEPLOYER
FACTORY=$FACTORY
TOKEN=$TOKEN
DAO=$DAO
COUNCIL=$COUNCIL
INSTANCE_CODE_HASH=$HASH
EOF
step "Done. Wrote deployments/testnet.env"
cat deployments/testnet.env
