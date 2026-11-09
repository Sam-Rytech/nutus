#!/usr/bin/env sh
# Build both contracts and copy their ABIs to packages/core/abi (the H1 interface).
# Builder B generates packages/core/types.ts from these files.
set -e
cd "$(dirname "$0")/.."

# Windows (MSVC): ABI extraction builds a host .dll that references NEAR host
# functions; MSVC refuses unresolved symbols, Linux/macOS don't care. They are
# never called during extraction, so let the linker leave them unresolved.
export CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS="${CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS:--C link-arg=/FORCE:UNRESOLVED}"
export AWS_LC_SYS_PREBUILT_NASM="${AWS_LC_SYS_PREBUILT_NASM:-1}"

mkdir -p packages/core/abi
for c in instance factory; do
  (cd "contracts/$c" && cargo near abi && cargo near build non-reproducible-wasm --no-abi)
  cp "target/near/nutus_$c/nutus_${c}_abi.json" packages/core/abi/
done
echo "ABIs written to packages/core/abi/; wasm in target/near/"
