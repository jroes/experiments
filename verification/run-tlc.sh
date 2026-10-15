#!/usr/bin/env bash
# Model-checks the TLA+ specs in this folder with TLC.
# Needs Java 11+. Downloads a pinned tla2tools.jar and checks its hash.
set -euo pipefail
cd "$(dirname "$0")"

# v1.8.0 is a rolling pre-release that gets rebuilt (its hash changes), so pin the last fixed release
URL=https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar
SHA=936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88
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

# Sector Dominion online play through the shared store: all browsers play each turn from the same orders
must_pass LockstepBoard.tla LockstepBoard.cfg
must_fail LockstepBoard.tla LockstepBoardNonAtomic.cfg "Invariant Agreement is violated"

# Who plays which seat, and which links the host is offered
must_pass SeatRoster.tla SeatRoster.cfg
must_fail SeatRoster.tla SeatRoster_all.cfg "Invariant NoLinkToAI is violated"
must_fail SeatRoster.tla SeatRoster_base.cfg "Invariant NoLinkToAI is violated"
must_fail SeatRoster.tla SeatRosterNoGuard.cfg "Action property NoJoinOfAI is violated"
echo OK
