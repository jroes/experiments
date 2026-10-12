'use strict';
// Reads a game exported with "Export game" and prints what matters for a review: who has what, what is near the player, and the battles.
// node tools/review.js file.json [--world Name]   (--world: also shows what a fleet of the player's strongest garrison would meet there)
const fs = require('fs');
const G = require('../sectordominion/game.js');

const file = process.argv[2];
if (!file) { console.error('usage: node tools/review.js export.json'); process.exit(1); }
const ex = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!ex || ex.format !== 'sectordominion-review' || !G.validState(ex.game)) { console.error('That is not a game export this version can read.'); process.exit(1); }
const s = ex.game, me = ex.seat || 1;
console.log(`turn ${s.turn}, ${s.difficulty}, ${s.worlds.length} worlds, exported from ${ex.app} (${ex.kind}), you are empire ${me}`);
for (const e of s.empires) {
  const ws = s.worlds.filter(w => w.owner === e.id);
  const ships = ws.reduce((n, w) => n + G.shipCount(w.garrison), 0) + s.fleets.filter(f => f.owner === e.id).reduce((n, f) => n + G.shipCount(f.ships), 0);
  console.log(`  ${e.id === me ? '*' : ' '} ${e.name.padEnd(16)} ${e.human ? 'human' : 'AI   '} ${e.alive ? 'alive' : 'dead '} worlds ${String(ws.length).padStart(2)} ships ${String(ships).padStart(3)} tech ${e.tech} credits ${Math.floor(e.credits)}`);
}
const mine = s.worlds.filter(w => w.owner === me);
console.log('\nmy fleets in transit:', s.fleets.filter(f => f.owner === me).map(f => `${G.describeShips(f.ships)} -> ${s.worlds[f.to].name}`).join('; ') || 'none');
console.log('\nworlds near me (nearest first):');
const near = s.worlds.filter(w => w.owner !== me).map(w => ({ w, d: Math.min(...mine.map(m => G.dist(m, w))) })).sort((a, b) => a.d - b.d).slice(0, 12);
for (const { w, d } of near) {
  const owner = w.owner ? s.empires[w.owner - 1].name.split(' ')[0] : (w.natives ? 'natives' : 'unclaimed');
  console.log(`  ${w.name.padEnd(10)} ${String(Math.round(d)).padStart(3)} away  ${owner.padEnd(9)} pop ${String(Math.floor(w.pop)).padStart(3)} defense ${G.worldDefense(w)} troops ${w.troops} garrison: ${G.describeShips(w.garrison)}`);
}
console.log('\nrecent battles:');
for (const l of s.log.filter(l => l.kind === 'battle').slice(0, 15)) console.log(`  T${l.turn} ${l.text}`);
const wi = process.argv.indexOf('--world');
if (wi > 0) {
  const w = s.worlds.find(x => x.name.toLowerCase() === String(process.argv[wi + 1]).toLowerCase());
  if (!w) console.log('\nno such world');
  else {
    const best = mine.reduce((a, b) => (G.shipValue(b.garrison) > G.shipValue(a.garrison) ? b : a), mine[0]);
    console.log(`\nwhat my biggest garrison (${best.name}: ${G.describeShips(best.garrison)}) would meet at ${w.name}:`, G.estimateBattle(s, best.garrison, me, w));
  }
}
