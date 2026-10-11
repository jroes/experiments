#!/usr/bin/env bash
# Model-checks the TLA+ specs in this folder with TLC.
# Needs Java 11+. Downloads a pinned tla2tools.jar and checks its hash.
set -euo pipefail
cd "$(dirname "$0")"

URL=https://github.com/tlaplus/tlaplus/releases/download/v1.8.0/tla2tools.jar
SHA=7beec0f04818732a62fa193731711a99aa4f11279499b2360a7d156c519ea78d
JAR=.cache/tla2tools.jar
mkdir -p .cache
[ -f "$JAR" ] || curl -fsSL -o "$JAR" "$URL"
echo "$SHA  $JAR" | sha256sum -c - >/dev/null || { echo "tla2tools.jar hash mismatch"; rm -f "$JAR"; exit 1; }

tlc() { java -XX:+UseParallelGC -cp "$JAR" tlc2.TLC -workers auto -metadir .cache/states "$@"; }

must_pass() { # spec cfg
  echo "== $2: must pass =="
  tlc -config "$2" "$1" > ".cache/$2.log" || { tail -n 30 ".cache/$2.log"; exit 1; }
  grep -q "Model checking completed. No error has been found." ".cache/$2.log" || { tail -n 30 ".cache/$2.log"; exit 1; }
  grep -E "states generated" ".cache/$2.log" | tail -n 1
}

must_fail() { # spec cfg expected-text
  echo "== $2: must fail with '$3' =="
  tlc -config "$2" "$1" > ".cache/$2.log" || true
  grep -q "$3" ".cache/$2.log" || { echo "expected counterexample not found"; tail -n 30 ".cache/$2.log"; exit 1; }
  echo "found the expected counterexample"
}

# Sector Dominion live play: turn handshake between a host and guests
must_pass TurnSync.tla TurnSync.cfg
must_fail TurnSync.tla TurnSyncUntagged.cfg "Invariant ReadyIsFresh is violated"

# Sector Dominion online play through the relay: all browsers play each turn from the same orders
must_pass LockstepBoard.tla LockstepBoard.cfg
must_fail LockstepBoard.tla LockstepBoardNonAtomic.cfg "Invariant Agreement is violated"
echo OK
