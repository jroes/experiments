#!/bin/sh
# Only for a box with no C toolchain: `pip install --user ziglang`, zig cc wrappers in ~/bin. Otherwise `cargo build --release`. Fly builds with the Dockerfile.
export PATH=$HOME/.cargo/bin:$HOME/bin:$PATH
export CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER=$HOME/bin/zigcc
export CARGO_TARGET_X86_64_UNKNOWN_LINUX_MUSL_LINKER=$HOME/bin/zigcc-musl
export CARGO_TARGET_X86_64_UNKNOWN_LINUX_MUSL_RUSTFLAGS="-C link-self-contained=no"
cd "$(dirname "$0")" && cargo build --release --target x86_64-unknown-linux-musl "$@"
