#!/usr/bin/env sh
# Ship a new instance version to testnet. Instances are immutable by design,
# so a new version = new global code hash + a new factory pinned to it.
# Reuses the token, demo DAO and council from deployments/testnet.env.
#
# Usage: NEW_FACTORY=v2.nutus-dev.testnet sh scripts/testnet-redeploy.sh
# Then:  sh scripts/testnet-setup.sh   (sets the DAO up on the new factory)
#
# Cost: ~33.5 NEAR burned for the global code + 2.8 NEAR for the factory.
set -eu
cd "$(dirname "$0")/.."
if python3 -c "" 2>/dev/null; then PY=python3; else PY=python; fi
. deployments/testnet.env
: "${NEW_FACTORY:?set NEW_FACTORY, e.g. v2.$DEPLOYER}"
NET="network-config testnet"
SIGN="sign-with-keychain send"
step() { printf '\n== %s\n' "$*"; }

step "Build wasm + ABI"
sh scripts/abi.sh
INSTANCE_WASM=target/near/nutus_instance/nutus_instance.wasm
FACTORY_WASM=target/near/nutus_factory/nutus_factory.wasm
HASH=$($PY - "$INSTANCE_WASM" <<'PY'
import hashlib, sys
d = hashlib.sha256(open(sys.argv[1], "rb").read()).digest()
a = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
n = int.from_bytes(d, "big"); s = ""
while n: n, r = divmod(n, 58); s = a[r] + s
print("1" * (len(d) - len(d.lstrip(b"\0"))) + s)
PY
)
echo "new instance code hash: $HASH (was $INSTANCE_CODE_HASH)"
[ "$HASH" != "$INSTANCE_CODE_HASH" ] || { echo "code unchanged; nothing to ship"; exit 1; }

step "Publish instance code as a global contract (by hash)"
near contract deploy-as-global use-file "$INSTANCE_WASM" as-global-hash "$DEPLOYER" $NET $SIGN

step "Create + deploy factory $NEW_FACTORY"
near account create-account fund-myself "$NEW_FACTORY" '2.8 NEAR' \
  autogenerate-new-keypair save-to-keychain sign-as "$DEPLOYER" $NET $SIGN
near contract deploy "$NEW_FACTORY" use-file "$FACTORY_WASM" \
  with-init-call new json-args "{\"instance_code_hash\":\"$HASH\",\"setup_tokens\":[\"$TOKEN\"],\"dao_factories\":[\"sputnikv2.testnet\"]}" \
  prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' $NET $SIGN

step "Register $NEW_FACTORY with $TOKEN"
near contract call-function as-transaction "$TOKEN" storage_deposit \
  json-args "{\"account_id\":\"$NEW_FACTORY\",\"registration_only\":true}" \
  prepaid-gas '30.0 Tgas' attached-deposit '0.00125 NEAR' sign-as "$DEPLOYER" $NET $SIGN

step "Top up the DAO with 10,000 tUSDC for the new setup"
near contract call-function as-transaction "$TOKEN" mint \
  json-args "{\"account_id\":\"$DAO\",\"amount\":\"10000000000\"}" \
  prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' sign-as "$DEPLOYER" $NET $SIGN

cat > deployments/testnet.env <<EOF
DEPLOYER=$DEPLOYER
FACTORY=$NEW_FACTORY
TOKEN=$TOKEN
DAO=$DAO
COUNCIL=$COUNCIL
INSTANCE_CODE_HASH=$HASH
# Superseded (immutable, still live): factory $FACTORY, code $INSTANCE_CODE_HASH
EOF
step "Done. deployments/testnet.env now points at $NEW_FACTORY"
cat deployments/testnet.env
