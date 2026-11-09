#!/usr/bin/env sh
# Build both contracts and copy their ABIs to packages/core/abi (the H1 interface).
# Builder B generates packages/core/types.ts from these files.
set -e
cd "$(dirname "$0")/.."
mkdir -p packages/core/abi
for c in instance factory; do
  (cd "contracts/$c" && cargo near build non-reproducible-wasm)
  cp "target/near/nutus_$c/nutus_${c}_abi.json" packages/core/abi/
done
echo "ABIs written to packages/core/abi/"
