#!/usr/bin/env bash
# Model-checks verification/TurnSync.tla with TLC.
# Needs Java 11+. Downloads a pinned tla2tools.jar and checks its hash.
set -euo pipefail
cd "$(dirname "$0")"

URL=https://github.com/tlaplus/tlaplus/releases/download/v1.8.0/tla2tools.jar
SHA=7beec0f04818732a62fa193731711a99aa4f11279499b2360a7d156c519ea78d
JAR=.cache/tla2tools.jar
mkdir -p .cache
[ -f "$JAR" ] || curl -fsSL -o "$JAR" "$URL"
echo "$SHA  $JAR" | sha256sum -c - >/dev/null || { echo "tla2tools.jar hash mismatch"; rm -f "$JAR"; exit 1; }

tlc() { java -XX:+UseParallelGC -cp "$JAR" tlc2.TLC -workers auto -metadir .cache/states "$@" TurnSync.tla; }

echo "== fixed protocol (turn-tagged messages): must pass =="
tlc -config TurnSync.cfg | tee .cache/fixed.log | tail -n 4
grep -q "Model checking completed. No error has been found." .cache/fixed.log

echo "== original protocol (no turn tag): must fail ReadyIsFresh =="
tlc -config TurnSyncUntagged.cfg > .cache/untagged.log || true
grep -q "Invariant ReadyIsFresh is violated" .cache/untagged.log
echo "found the expected counterexample"
echo "OK"
