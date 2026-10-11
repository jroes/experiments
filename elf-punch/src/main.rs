//! Elf Castle Wood Puncher 5000: one shared in-memory world, ticking only while someone is connected.
//! std threads, no async runtime: one thread per connection (25 max), one tick thread.
mod store;

use std::collections::{HashMap, VecDeque};
use std::fmt::Write as _;
use std::io::{ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tungstenite::protocol::WebSocketConfig;
use tungstenite::{accept_with_config, Error as WsError, Message};

const W: f32 = 60.0;
const H: f32 = 60.0;
const MAXP: usize = 25;
const DT: f32 = 0.1;
const VIEW: f32 = 16.0;
const DAY: f32 = 150.0;
const NIGHT_AT: f32 = 90.0;
const NT: usize = 260;
const NROCKS: usize = 50;
/// (wood, stone) per piece kind: wall, stone wall, floor, torch, spikes, campfire.
const COST: [(i32, i32); 6] = [(2, 0), (0, 3), (1, 0), (2, 0), (4, 0), (6, 0)];
const WALL_HP: [i32; 5] = [8, 20, 4, 3, 10];
const IDLE_KICK: Duration = Duration::from_secs(120);

struct Rng(u32);
impl Rng {
    fn next(&mut self) -> f32 {
        self.0 = self.0.wrapping_add(0x6d2b_79f5);
        let mut t = self.0;
        t = (t ^ (t >> 15)).wrapping_mul(1 | t);
        t = t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t)) ^ t;
        ((t ^ (t >> 14)) as f64 / 4294967296.0) as f32
    }
}
fn dist(ax: f32, ay: f32, bx: f32, by: f32) -> f32 { (ax - bx).hypot(ay - by) }
fn r2(v: f32) -> f32 { (v * 100.0).round() / 100.0 }
type Key = (i32, i32);
fn wkey(x: f32, y: f32) -> Key { (x.floor() as i32, y.floor() as i32) }

/// Trees and boulders share a struct: the first NT entries are trees, the rest are rocks (stone).
struct Tree { x: f32, y: f32, hp: i32, regrow: f32, rock: bool }
/// A build piece on the 1x1 grid. kind: 0 wood wall, 1 stone wall, 2 floor, 3 torch, 4 spikes. Kinds 0 and 1 block movement.
struct Wall { x: f32, y: f32, hp: i32, kind: u8 }
struct Fire { x: f32, y: f32, fuel: f32 }
struct Goblin { x: f32, y: f32, hp: i32, scd: f32, cd: f32, wcd: f32, kx: f32, ky: f32, wind: f32, rec: f32, stun: f32 }
struct Player {
    tx: SyncSender<String>, name: String, alive: bool,
    x: f32, y: f32, hp: f32, hu: f32, wa: f32, wood: i32, stone: i32, axe: bool, club: bool, hammer: bool, look: u8, kills: u32, born: Instant,
    dx: f32, dy: f32, fx: f32, fy: f32, pcd: f32, pt: f32, last_act: Instant,
    stam: f32, roll_t: f32, roll_cd: f32, rdx: f32, rdy: f32, blocking: bool, block_t: f32, parry_t: f32,
}
enum Block { None, Edge, Tree, Wall(Key) }

struct World {
    rng: Rng, trees: Vec<Tree>, walls: HashMap<Key, Wall>, wall_order: VecDeque<Key>, fires: Vec<Fire>,
    mushrooms: Vec<(f32, f32)>, goblins: HashMap<u32, Goblin>, players: HashMap<u32, Player>,
    next_id: u32, tod: f32, tick: u64, events: Vec<(&'static str, f32, f32)>,
}

fn blocked(trees: &[Tree], walls: &HashMap<Key, Wall>, x: f32, y: f32, for_player: bool) -> Block {
    if x < 0.4 || y < 0.4 || x > W - 0.4 || y > H - 0.4 { return Block::Edge; }
    for (ox, oy) in [(-0.3, -0.3), (0.3, -0.3), (-0.3, 0.3), (0.3, 0.3)] {
        let k = wkey(x + ox, y + oy);
        if walls.get(&k).map_or(false, |w| w.kind < 2) { return Block::Wall(k); }
    }
    if for_player {
        for t in trees {
            if t.hp > 0 && (t.x - x).abs() < 0.9 && (t.y - y).abs() < 0.9 && dist(t.x, t.y, x, y) < if t.rock { 0.8 } else { 0.6 } { return Block::Tree; }
        }
    }
    Block::None
}
/// Slide along each axis independently; returns the new position and the first thing hit.
fn mv(trees: &[Tree], walls: &HashMap<Key, Wall>, x: f32, y: f32, dx: f32, dy: f32, fp: bool) -> (f32, f32, Block) {
    let (mut nx, mut ny, mut hit) = (x, y, Block::None);
    match blocked(trees, walls, nx + dx, ny, fp) { Block::None => nx += dx, b => hit = b }
    match blocked(trees, walls, nx, ny + dy, fp) { Block::None => ny += dy, b => if matches!(hit, Block::None) { hit = b } }
    (nx, ny, hit)
}

fn hurt(p: &mut Player, events: &mut Vec<(&'static str, f32, f32)>, n: f32, why: &str) {
    p.hp -= n;
    events.push(("hurt", r2(p.x), r2(p.y)));
    if p.hp <= 0.0 && p.alive {
        p.alive = false;
        let secs = p.born.elapsed().as_secs();
        let _ = p.tx.try_send(format!(r#"{{"t":"dead","secs":{secs},"kills":{},"why":"{why}"}}"#, p.kills));
    }
}

impl World {
    fn new() -> World {
        let mut rng = Rng(5000);
        let mut trees: Vec<Tree> = Vec::new();
        while trees.len() < 260 {
            let (x, y) = (1.0 + rng.next() * (W - 2.0), 1.0 + rng.next() * (H - 2.0));
            if dist(x, y, W / 2.0, H / 2.0) < 4.0 || trees.iter().any(|t| dist(t.x, t.y, x, y) < 1.6) { continue; }
            trees.push(Tree { x: r2(x), y: r2(y), hp: 4, regrow: 0.0, rock: false });
        }
        while trees.len() < NT + NROCKS {
            let (x, y) = (1.5 + rng.next() * (W - 3.0), 1.5 + rng.next() * (H - 3.0));
            if dist(x, y, W / 2.0, H / 2.0) < 5.0 || trees.iter().any(|t| dist(t.x, t.y, x, y) < 2.5) { continue; }
            trees.push(Tree { x: r2(x), y: r2(y), hp: 5, regrow: 0.0, rock: true });
        }
        World { rng, trees, walls: HashMap::new(), wall_order: VecDeque::new(), fires: vec![], mushrooms: vec![],
                goblins: HashMap::new(), players: HashMap::new(), next_id: 1,
                tod: std::env::var("TOD_START").ok().and_then(|s| s.parse().ok()).unwrap_or(0.0), tick: 0, events: vec![] }
    }
    /// The durable part of the world: time of day, tree stumps, walls and fires. Players and goblins start fresh.
    fn save(&self, path: &str) {
        let trees: Vec<_> = self.trees.iter().map(|t| serde_json::json!([t.hp, t.regrow])).collect();
        let walls: Vec<_> = self.walls.values().map(|w| serde_json::json!([w.x, w.y, w.hp, w.kind])).collect();
        let fires: Vec<_> = self.fires.iter().map(|f| serde_json::json!([f.x, f.y, f.fuel])).collect();
        let doc = serde_json::json!({ "v": 1, "tod": self.tod, "trees": trees, "walls": walls, "fires": fires });
        let tmp = format!("{path}.tmp");
        if std::fs::write(&tmp, doc.to_string()).is_ok() { let _ = std::fs::rename(&tmp, path); }
    }
    fn load(&mut self, path: &str) {
        let Ok(text) = std::fs::read_to_string(path) else { return };
        let Ok(d) = serde_json::from_str::<serde_json::Value>(&text) else { return };
        let f = |v: &serde_json::Value| v.as_f64().unwrap_or(0.0) as f32;
        if let Some(a) = d["trees"].as_array() {
            if a.len() <= self.trees.len() { for (t, v) in self.trees.iter_mut().zip(a) { t.hp = v[0].as_i64().unwrap_or(4) as i32; t.regrow = f(&v[1]); } }
        }
        self.tod = f(&d["tod"]);
        for v in d["walls"].as_array().into_iter().flatten() {
            let (x, y) = (f(&v[0]), f(&v[1]));
            let k = wkey(x, y);
            self.walls.insert(k, Wall { x, y, hp: v[2].as_i64().unwrap_or(8) as i32, kind: v[3].as_u64().unwrap_or(0).min(4) as u8 });
            self.wall_order.push_back(k);
        }
        for v in d["fires"].as_array().into_iter().flatten() { self.fires.push(Fire { x: f(&v[0]), y: f(&v[1]), fuel: f(&v[2]) }); }
    }
    fn night(&self) -> bool { self.tod % DAY >= NIGHT_AT }

    fn spawn(&mut self, id: u32) {
        let (mut x, mut y) = (W / 2.0, H / 2.0);
        for _ in 0..20 {
            let (a, r) = (self.rng.next() * 6.283, 1.0 + self.rng.next() * 3.0);
            x = W / 2.0 + a.cos() * r; y = H / 2.0 + a.sin() * r;
            if matches!(blocked(&self.trees, &self.walls, x, y, true), Block::None) { break; }
        }
        if let Some(p) = self.players.get_mut(&id) {
            p.x = x; p.y = y; p.hp = 10.0; p.hu = 100.0; p.wa = 100.0; p.wood = std::env::var("START_WOOD").ok().and_then(|v| v.parse().ok()).unwrap_or(0); p.stone = std::env::var("START_STONE").ok().and_then(|v| v.parse().ok()).unwrap_or(0); p.axe = false; p.club = false; p.hammer = false; p.kills = 0; p.born = Instant::now();
            p.alive = true; p.dx = 0.0; p.dy = 0.0; p.fx = 1.0; p.fy = 0.0; p.pcd = 0.0; p.pt = 0.0; p.last_act = Instant::now();
            p.stam = 100.0; p.roll_t = 0.0; p.roll_cd = 0.0; p.blocking = false; p.block_t = 0.0; p.parry_t = 0.0;
        }
    }

    fn punch(&mut self, id: u32) {
        let Some(p) = self.players.get_mut(&id) else { return };
        if !p.alive || p.hammer || p.pcd > 0.0 || p.roll_t > 0.0 || p.stam < 8.0 { return; }
        p.pcd = 0.35; p.pt = 0.3; p.stam -= 8.0; p.blocking = false;
        let mut best: Option<(u32, f32)> = None;
        for (gid, g) in &self.goblins {
            let d = dist(p.x, p.y, g.x, g.y);
            if d < best.map_or(1.5, |b| b.1) { best = Some((*gid, d)); }
        }
        if let Some((gid, _)) = best {
            let g = self.goblins.get_mut(&gid).unwrap();
            let crit = g.stun > 0.0;
            g.hp -= match (crit, p.club) { (true, true) => 5, (true, false) => 3, (false, true) => 2, _ => 1 }; g.kx = g.x - p.x; g.ky = g.y - p.y;
            if crit { g.stun = 0.0; self.events.push(("crit", r2(g.x), r2(g.y))); }
            p.fx = -g.kx; p.fy = -g.ky;
            self.events.push(("hit", r2(g.x), r2(g.y)));
            if g.hp <= 0 {
                let (x, y) = (g.x, g.y);
                self.goblins.remove(&gid); p.kills += 1; self.events.push(("kill", r2(x), r2(y)));
            }
            return;
        }
        let mut bt: Option<(usize, f32)> = None;
        for (i, t) in self.trees.iter().enumerate() {
            if t.hp > 0 { let d = dist(p.x, p.y, t.x, t.y); if d < bt.map_or(1.5, |b| b.1) { bt = Some((i, d)); } }
        }
        if let Some((i, _)) = bt {
            let t = &mut self.trees[i];
            t.hp -= if p.axe { 2 } else { 1 }; p.fx = t.x - p.x; p.fy = t.y - p.y;
            self.events.push((if t.rock { "chip" } else { "hit" }, t.x, t.y));
            if t.hp <= 0 {
                if t.rock { t.regrow = 120.0; p.stone += 3; self.events.push(("shatter", t.x, t.y)); }
                else { t.regrow = 90.0; p.wood += 3; self.events.push(("fell", t.x, t.y)); }
            }
        }
    }

    /// Quick-build (Q / F): a wall or campfire on the grid cell in front of the player.
    fn quick(&mut self, id: u32, wall: bool) {
        let Some(p) = self.players.get(&id) else { return };
        let len = p.fx.hypot(p.fy).max(0.0001);
        let (fx, fy) = (p.x + p.fx / len * 1.4, p.y + p.fy / len * 1.4);
        self.place(id, if wall { 0 } else { 5 }, fx.floor() as i32, fy.floor() as i32);
    }

    /// Place a piece on grid cell (cx, cy). A campfire on an existing fire feeds it instead.
    fn place(&mut self, id: u32, kind: usize, cx: i32, cy: i32) {
        let Some(p) = self.players.get(&id) else { return };
        if !p.alive || kind > 5 || p.pcd > 0.0 { return; }
        let (wood, stone, px, py) = (p.wood, p.stone, p.x, p.y);
        let (cw, cs) = COST[kind];
        let (mx, my) = (cx as f32 + 0.5, cy as f32 + 0.5);
        if cx < 1 || cy < 1 || cx >= W as i32 - 1 || cy >= H as i32 - 1 || dist(px, py, mx, my) > 6.5 { return; }
        let k = (cx, cy);
        if self.walls.contains_key(&k) { return; }
        let (mut spend_w, mut spend_s) = (cw, cs);
        if kind == 5 {
            if let Some(f) = self.fires.iter_mut().find(|f| dist(f.x, f.y, mx, my) < 0.9) {
                if wood < 2 { return; }
                f.fuel = (f.fuel + 40.0).min(180.0); spend_w = 2; spend_s = 0;
            } else {
                if wood < cw || self.fires.len() >= 40 || self.trees.iter().any(|t| t.hp > 0 && dist(t.x, t.y, mx, my) < 0.9) { return; }
                self.fires.push(Fire { x: mx, y: my, fuel: 100.0 });
            }
        } else {
            if wood < cw || stone < cs || self.trees.iter().any(|t| t.hp > 0 && dist(t.x, t.y, mx, my) < 0.9) { return; }
            if kind < 2 && (self.players.values().any(|o| o.alive && wkey(o.x, o.y) == k) || self.goblins.values().any(|g| wkey(g.x, g.y) == k)) { return; }
            self.walls.insert(k, Wall { x: mx, y: my, hp: WALL_HP[kind], kind: kind as u8 });
            self.wall_order.push_back(k);
            while self.walls.len() > 400 {
                match self.wall_order.pop_front() { Some(old) => { self.walls.remove(&old); } None => break }
            }
        }
        let p = self.players.get_mut(&id).unwrap();
        p.wood -= spend_w; p.stone -= spend_s; p.pcd = 0.25; p.pt = 0.3;
        self.events.push(("build", mx, my));
    }

    /// Hammer demolish: remove the piece (or campfire) on a cell and refund half its cost.
    fn demolish(&mut self, id: u32, cx: i32, cy: i32) {
        let Some(p) = self.players.get_mut(&id) else { return };
        let (mx, my) = (cx as f32 + 0.5, cy as f32 + 0.5);
        if !p.alive || p.pcd > 0.0 || dist(p.x, p.y, mx, my) > 6.5 { return; }
        let k = (cx, cy);
        if let Some(w) = self.walls.remove(&k) {
            let (cw, cs) = COST[w.kind as usize];
            p.wood += cw / 2; p.stone += cs / 2;
            self.wall_order.retain(|o| *o != k);
        } else if let Some(i) = self.fires.iter().position(|f| dist(f.x, f.y, mx, my) < 0.9) {
            self.fires.remove(i); p.wood += 3;
        } else { return; }
        p.pcd = 0.25; p.pt = 0.3;
        self.events.push(("demolish", mx, my));
    }

    fn craft(&mut self, id: u32, what: &str) {
        let Some(p) = self.players.get_mut(&id) else { return };
        if !p.alive { return; }
        match what {
            "axe" if !p.axe && p.wood >= 4 && p.stone >= 2 => { p.wood -= 4; p.stone -= 2; p.axe = true; }
            "club" if !p.club && p.wood >= 3 && p.stone >= 3 => { p.wood -= 3; p.stone -= 3; p.club = true; }
            _ => {}
        }
    }

    fn step(&mut self) {
        self.tick += 1; self.tod += DT;
        let night = self.night();
        let ids: Vec<u32> = self.players.iter().filter(|(_, p)| p.alive).map(|(i, _)| *i).collect();
        for id in &ids {
            let p = self.players.get_mut(id).unwrap();
            p.pcd = (p.pcd - DT).max(0.0); p.pt = (p.pt - DT).max(0.0);
            p.roll_cd = (p.roll_cd - DT).max(0.0); p.parry_t = (p.parry_t - DT).max(0.0);
            if p.blocking { p.block_t += DT; p.stam -= 6.0 * DT; if p.stam <= 0.0 { p.stam = 0.0; p.blocking = false; } }
            else if p.roll_t <= 0.0 { p.stam = (p.stam + 18.0 * DT).min(100.0); }
            if p.roll_t > 0.0 {
                p.roll_t = (p.roll_t - DT).max(0.0);
                let (x, y, _) = mv(&self.trees, &self.walls, p.x, p.y, p.rdx * 7.0 * DT, p.rdy * 7.0 * DT, true);
                p.x = x; p.y = y;
            } else if p.dx != 0.0 || p.dy != 0.0 {
                p.fx = p.dx; p.fy = p.dy;
                let sp = if p.blocking { 2.0 } else { 4.0 };
                let (x, y, _) = mv(&self.trees, &self.walls, p.x, p.y, p.dx * sp * DT, p.dy * sp * DT, true);
                p.x = x; p.y = y;
            }
            let near_fire = self.fires.iter().any(|f| dist(f.x, f.y, p.x, p.y) < 3.5) || self.walls.values().any(|w| w.kind == 3 && dist(w.x, w.y, p.x, p.y) < 2.2);
            p.hu = (p.hu - 0.5 * DT).max(0.0);
            p.wa = (p.wa + (if near_fire { 5.0 } else if night { -1.5 } else { 1.0 }) * DT).clamp(0.0, 100.0);
            if p.hu <= 0.0 { hurt(p, &mut self.events, 0.3 * DT, "starved"); }
            if p.alive && p.wa <= 0.0 { hurt(p, &mut self.events, 0.4 * DT, "froze"); }
            if p.alive && p.hu > 50.0 && p.wa > 50.0 { p.hp = (p.hp + 0.3 * DT).min(10.0); }
            if p.alive {
                let (px, py) = (p.x, p.y);
                let before = self.mushrooms.len();
                self.mushrooms.retain(|m| dist(m.0, m.1, px, py) >= 0.8);
                for _ in self.mushrooms.len()..before { p.hu = (p.hu + 25.0).min(100.0); }
            }
        }
        for f in &mut self.fires { f.fuel -= DT; }
        self.fires.retain(|f| f.fuel > 0.0);
        for t in &mut self.trees { if t.hp <= 0 { t.regrow -= DT; if t.regrow <= 0.0 { t.hp = if t.rock { 5 } else { 4 }; } } }
        while self.mushrooms.len() < 35 { let m = (r2(2.0 + self.rng.next() * (W - 4.0)), r2(2.0 + self.rng.next() * (H - 4.0))); self.mushrooms.push(m); }

        // goblins
        let want = if night { (2 + ids.len() * 3 / 2).min(20) } else { 0 };
        if self.goblins.len() < want && !ids.is_empty() && self.rng.next() < 0.12 {
            let id = ids[(self.rng.next() * ids.len() as f32) as usize % ids.len()];
            let (px, py) = { let p = &self.players[&id]; (p.x, p.y) };
            let a = self.rng.next() * 6.283;
            let (x, y) = (px + a.cos() * 14.0, py + a.sin() * 14.0);
            if matches!(blocked(&self.trees, &self.walls, x, y, false), Block::None) {
                let gid = self.next_id; self.next_id += 1;
                self.goblins.insert(gid, Goblin { x, y, hp: 3, scd: 0.0, cd: 1.0, wcd: 0.0, kx: 0.0, ky: 0.0, wind: 0.0, rec: 0.0, stun: 0.0 });
            }
        }
        if !night { if let Some(&k) = self.goblins.keys().next() { self.goblins.remove(&k); } }
        let mut broken: Vec<Key> = vec![];
        for g in self.goblins.values_mut() {
            g.cd = (g.cd - DT).max(0.0); g.wcd = (g.wcd - DT).max(0.0); g.scd = (g.scd - DT).max(0.0);
            if g.scd <= 0.0 {
                let k = wkey(g.x, g.y);
                if let Some(w) = self.walls.get_mut(&k) {
                    if w.kind == 4 { g.hp -= 1; g.scd = 0.7; w.hp -= 1; self.events.push(("hit", r2(g.x), r2(g.y))); if w.hp <= 0 { broken.push(k); } }
                }
            }
            if g.kx != 0.0 || g.ky != 0.0 {
                let l = g.kx.hypot(g.ky).max(0.0001);
                let (x, y, _) = mv(&self.trees, &self.walls, g.x, g.y, g.kx / l * 0.6, g.ky / l * 0.6, false);
                g.x = x; g.y = y; g.kx = 0.0; g.ky = 0.0;
            }
            let mut tp: Option<(u32, f32)> = None;
            for (id, p) in &self.players { if p.alive { let d = dist(p.x, p.y, g.x, g.y); if d < tp.map_or(18.0, |t| t.1) { tp = Some((*id, d)); } } }
            let Some((pid, td)) = tp else { continue };
            let (tx, ty) = { let p = &self.players[&pid]; (p.x, p.y) };
            if g.stun > 0.0 { g.stun -= DT; continue; }
            if g.rec > 0.0 { g.rec -= DT; continue; }
            if g.wind > 0.0 {
                g.wind -= DT;
                if g.wind <= 0.0 {
                    g.rec = 0.8; g.cd = 1.6;
                    let p = self.players.get_mut(&pid).unwrap();
                    if td > 1.5 { continue; }
                    if p.roll_t > 0.0 { self.events.push(("dodge", r2(p.x), r2(p.y))); }
                    else if p.blocking && p.block_t <= 0.5 {
                        g.stun = 1.8; p.stam = (p.stam + 25.0).min(100.0); p.parry_t = 0.5;
                        self.events.push(("parry", r2(p.x), r2(p.y)));
                    } else if p.blocking && p.stam >= 15.0 {
                        p.stam -= 15.0; self.events.push(("block", r2(p.x), r2(p.y)));
                        hurt(p, &mut self.events, 0.4, "goblins");
                    } else { p.blocking = false; hurt(p, &mut self.events, 1.5, "goblins"); }
                }
                continue;
            }
            if td < 1.15 {
                if g.cd <= 0.0 { g.wind = 0.65; }
                continue;
            }
            let (mut mx, mut my) = ((tx - g.x) / td, (ty - g.y) / td);
            if let Some(f) = self.fires.iter().find(|f| dist(f.x, f.y, g.x, g.y) < 2.2) {
                let d = dist(f.x, f.y, g.x, g.y).max(0.0001);
                mx = (g.x - f.x) / d; my = (g.y - f.y) / d;
            }
            let (x, y, hit) = mv(&self.trees, &self.walls, g.x, g.y, mx * 1.6 * DT, my * 1.6 * DT, false);
            g.x = x; g.y = y;
            if let Block::Wall(k) = hit {
                if g.wcd <= 0.0 { g.wcd = 1.0; if let Some(w) = self.walls.get_mut(&k) { w.hp -= 1; if w.hp <= 0 { broken.push(k); } } }
            }
        }
        let dead: Vec<u32> = self.goblins.iter().filter(|(_, g)| g.hp <= 0).map(|(i, _)| *i).collect();
        for i in dead { if let Some(g) = self.goblins.remove(&i) { self.events.push(("kill", r2(g.x), r2(g.y))); } }
        for k in broken { self.walls.remove(&k); self.wall_order.retain(|o| *o != k); }

        self.snapshots();
        self.events.clear();
    }

    fn snapshots(&mut self) {
        let lb = if self.tick % 20 == 0 {
            let mut v: Vec<(&str, u64, u32)> = self.players.values().filter(|p| p.alive).map(|p| (p.name.as_str(), p.born.elapsed().as_secs(), p.kills)).collect();
            v.sort_by(|a, b| b.1.cmp(&a.1)); v.truncate(5);
            Some(v.iter().map(|(n, s, k)| format!(r#"["{n}",{s},{k}]"#)).collect::<Vec<_>>().join(","))
        } else { None };
        let n = self.players.len();
        let tm = r2(self.tod % DAY);
        for p in self.players.values().filter(|p| p.alive) {
            let near = |x: f32, y: f32| (x - p.x).abs() < VIEW && (y - p.y).abs() < VIEW;
            let mut s = String::with_capacity(1024);
            let _ = write!(s, r#"{{"t":"s","tm":{tm},"n":{n},"me":[{:.2},{:.2},{:.1},{},{},{},{},{},{},{}],"p":["#, p.x, p.y, p.hp, p.hu.round(), p.wa.round(), p.wood, p.kills, p.stam.round(), p.stone, p.axe as u8 | (p.club as u8) << 1);
            let mut first = true;
            for (id, o) in self.players.iter().filter(|(_, o)| o.alive && near(o.x, o.y)) {
                if !first { s.push(','); } first = false;
                let st = if o.roll_t > 0.0 { 2 } else if o.parry_t > 0.0 { 4 } else if o.blocking { 3 } else { 0 };
                let eq = o.hammer as u8 | (o.axe as u8) << 1 | (o.club as u8) << 2 | (o.look & 1) << 3;
                let _ = write!(s, r#"[{id},{:.2},{:.2},{},{},"{}",{st},{eq}]"#, o.x, o.y, if o.fx < 0.0 { -1 } else { 1 }, (o.pt > 0.0) as u8, o.name);
            }
            s.push_str(r#"],"g":["#);
            first = true;
            for (id, g) in self.goblins.iter().filter(|(_, g)| near(g.x, g.y)) {
                if !first { s.push(','); } first = false;
                let st = if g.stun > 0.0 { 3 } else if g.wind > 0.0 { 1 } else { 0 };
                let _ = write!(s, "[{id},{:.2},{:.2},{},{st}]", g.x, g.y, g.hp);
            }
            s.push_str(r#"],"f":["#);
            first = true;
            for f in self.fires.iter().filter(|f| near(f.x, f.y)) {
                if !first { s.push(','); } first = false;
                let _ = write!(s, "[{:.2},{:.2},{}]", f.x, f.y, f.fuel.round());
            }
            s.push_str(r#"],"w":["#);
            first = true;
            for w in self.walls.values().filter(|w| near(w.x, w.y)) {
                if !first { s.push(','); } first = false;
                let _ = write!(s, "[{:.1},{:.1},{},{}]", w.x, w.y, w.hp, w.kind);
            }
            s.push_str(r#"],"m":["#);
            first = true;
            for m in self.mushrooms.iter().filter(|m| near(m.0, m.1)) {
                if !first { s.push(','); } first = false;
                let _ = write!(s, "[{:.2},{:.2}]", m.0, m.1);
            }
            s.push_str(r#"],"tf":["#);
            first = true;
            for (i, _) in self.trees.iter().enumerate().filter(|(_, t)| t.hp <= 0 && near(t.x, t.y)) {
                if !first { s.push(','); } first = false;
                let _ = write!(s, "{i}");
            }
            s.push_str(r#"],"ev":["#);
            first = true;
            for e in self.events.iter().filter(|e| near(e.1, e.2)) {
                if !first { s.push(','); } first = false;
                let _ = write!(s, r#"["{}",{:.2},{:.2}]"#, e.0, e.1, e.2);
            }
            s.push(']');
            if let Some(lb) = &lb { let _ = write!(s, r#","lb":[{lb}]"#); }
            s.push('}');
            let _ = p.tx.try_send(s); // a slow client just misses a snapshot
        }
    }
}

type Shared = Arc<(Mutex<World>, Condvar)>;

fn save_path() -> String { std::env::var("WORLD_FILE").unwrap_or_else(|_| "/data/world.json".into()) }

fn tick_loop(shared: Shared) {
    let (lock, cv) = &*shared;
    let mut next = Instant::now();
    let mut last_save = Instant::now();
    let mut dirty = false;
    loop {
        {
            let mut w = lock.lock().unwrap();
            while w.players.is_empty() {
                // Last player left: save once, then sleep until someone connects (Fly stops the machine meanwhile).
                if dirty { w.save(&save_path()); dirty = false; }
                w.goblins.clear();
                w = cv.wait(w).unwrap(); next = Instant::now(); last_save = Instant::now();
            }
            w.step();
            dirty = true;
            if last_save.elapsed() >= Duration::from_secs(30) { w.save(&save_path()); last_save = Instant::now(); dirty = false; }
        }
        next += Duration::from_millis((DT * 1000.0) as u64);
        let now = Instant::now();
        if next > now { thread::sleep(next - now); } else { next = now; }
    }
}

const INDEX: &[u8] = include_bytes!("../public/index.html");
const GAME: &[u8] = include_bytes!("../public/game.js");
const AUDIO: &[u8] = include_bytes!("../public/audio.js");
const THREE: &[u8] = include_bytes!("../public/three.js.gz");

fn http(mut s: TcpStream, shared: Shared) {
    let _ = s.set_read_timeout(Some(Duration::from_secs(5)));
    let mut buf = [0u8; 2048];
    let mut n = 0;
    while n < buf.len() {
        match s.read(&mut buf[n..]) { Ok(0) | Err(_) => break, Ok(k) => n += k }
        if buf[..n].windows(4).any(|w| w == b"\r\n\r\n") { break; }
    }
    let req = String::from_utf8_lossy(&buf[..n]);
    let mut parts = req.split_whitespace();
    let (method, path) = (parts.next().unwrap_or(""), parts.next().unwrap_or("").split('?').next().unwrap_or(""));
    let stats;
    let (status, ctype, body, enc): (&str, &str, &[u8], &str) = match (method, path) {
        ("GET", "/stats") => {
            let st = std::fs::read_to_string("/proc/self/status").unwrap_or_default();
            let kb = |k: &str| st.lines().find(|l| l.starts_with(k)).and_then(|l| l.split_whitespace().nth(1)).and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
            let bin = std::env::current_exe().and_then(|p| std::fs::metadata(p)).map(|m| m.len()).unwrap_or(0);
            let (players, goblins) = { let w = shared.0.lock().unwrap(); (w.players.len(), w.goblins.len()) };
            stats = format!(r#"{{"binary_bytes":{bin},"rss_kb":{},"peak_rss_kb":{},"threads":{},"players":{players},"goblins":{goblins}}}"#, kb("VmRSS:"), kb("VmHWM:"), kb("Threads:"));
            ("200 OK", "application/json", stats.as_bytes(), "")
        }
        ("GET", "/healthz") => ("200 OK", "text/plain", b"ok", ""),
        ("GET", "/") | ("GET", "/index.html") => ("200 OK", "text/html; charset=utf-8", INDEX, ""),
        ("GET", "/game.js") => ("200 OK", "text/javascript", GAME, ""),
        ("GET", "/audio.js") => ("200 OK", "text/javascript", AUDIO, ""),
        ("GET", "/three.js") => ("200 OK", "text/javascript", THREE, "Content-Encoding: gzip\r\n"),
        _ => ("404 Not Found", "text/plain", b"not found", ""),
    };
    let head = format!("HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\n{enc}Content-Length: {}\r\nCache-Control: public, max-age=300\r\nConnection: close\r\n\r\n", body.len());
    let _ = s.write_all(head.as_bytes());
    if method != "HEAD" { let _ = s.write_all(body); }
}

fn sanitize(name: &str) -> String {
    let n: String = name.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == ' ' || *c == '-').collect();
    let n: String = n.trim().chars().take(12).collect();
    if n.is_empty() { "elf".into() } else { n }
}

fn ws_conn(stream: TcpStream, shared: Shared) {
    let _ = stream.set_nodelay(true);
    let cfg = WebSocketConfig::default().max_message_size(Some(512)).max_frame_size(Some(512));
    let Ok(mut ws) = accept_with_config(stream, Some(cfg)) else { return };
    let (lock, cv) = &*shared;
    let (tx, rx): (SyncSender<String>, Receiver<String>) = sync_channel(8);
    let id = {
        let mut w = lock.lock().unwrap();
        if w.players.len() >= MAXP { drop(w); let _ = ws.send(Message::text(r#"{"t":"full"}"#)); let _ = ws.close(None); return; }
        let id = w.next_id; w.next_id += 1;
        let now = Instant::now();
        w.players.insert(id, Player { tx, name: "elf".into(), alive: false, x: 0.0, y: 0.0, hp: 0.0, hu: 0.0, wa: 0.0, wood: 0, stone: 0, axe: false, club: false, hammer: false, look: 0, kills: 0,
            born: now, dx: 0.0, dy: 0.0, fx: 1.0, fy: 0.0, pcd: 0.0, pt: 0.0, last_act: now,
            stam: 100.0, roll_t: 0.0, roll_cd: 0.0, rdx: 0.0, rdy: 0.0, blocking: false, block_t: 0.0, parry_t: 0.0 });
        id
    };
    cv.notify_all();
    let _ = ws.get_mut().set_read_timeout(Some(Duration::from_millis(50)));
    let (mut tokens, mut refill) = (40i32, Instant::now());
    'conn: loop {
        if refill.elapsed() >= Duration::from_millis(500) {
            refill = Instant::now(); tokens = (tokens + 20).min(40);
            let idle = lock.lock().unwrap().players.get(&id).map_or(true, |p| p.last_act.elapsed() > IDLE_KICK);
            if idle { break; }
        }
        match ws.read() {
            Ok(Message::Text(t)) => {
                tokens -= 1;
                if tokens < 0 { continue; }
                let Ok(m) = serde_json::from_str::<serde_json::Value>(t.as_str()) else { continue };
                let mut w = lock.lock().unwrap();
                match m["t"].as_str().unwrap_or("") {
                    "join" => {
                        if let Some(p) = w.players.get_mut(&id) { p.name = sanitize(m["name"].as_str().unwrap_or("")); p.look = (m["look"].as_u64().unwrap_or(0) & 1) as u8; }
                        w.spawn(id);
                        let mut init = String::from(r#"{"t":"init","id":"#);
                        let _ = write!(init, r#"{id},"w":{W},"h":{H},"trees":["#);
                        for (i, t) in w.trees[..NT].iter().enumerate() { if i > 0 { init.push(','); } let _ = write!(init, "[{},{}]", t.x, t.y); }
                        init.push_str(r#"],"rocks":["#);
                        for (i, t) in w.trees[NT..].iter().enumerate() { if i > 0 { init.push(','); } let _ = write!(init, "[{},{}]", t.x, t.y); }
                        init.push_str("]}");
                        if let Some(p) = w.players.get(&id) { let _ = p.tx.try_send(init); }
                    }
                    kind => {
                        if !w.players.get(&id).map_or(false, |p| p.alive) { continue; }
                        match kind {
                            "in" => {
                                let (mut dx, mut dy) = (m["x"].as_f64().unwrap_or(0.0) as f32, m["y"].as_f64().unwrap_or(0.0) as f32);
                                if !dx.is_finite() || !dy.is_finite() { continue; }
                                let l = dx.hypot(dy);
                                if l > 1.0 { dx /= l; dy /= l; }
                                let p = w.players.get_mut(&id).unwrap();
                                p.dx = dx; p.dy = dy; if l > 0.0 { p.last_act = Instant::now(); }
                            }
                            "dodge" => {
                                let p = w.players.get_mut(&id).unwrap();
                                if p.roll_t <= 0.0 && p.roll_cd <= 0.0 && p.stam >= 20.0 {
                                    let (mut dx, mut dy) = if p.dx != 0.0 || p.dy != 0.0 { (p.dx, p.dy) } else { (p.fx, p.fy) };
                                    let l = dx.hypot(dy).max(0.0001); dx /= l; dy /= l;
                                    p.rdx = dx; p.rdy = dy; p.roll_t = 0.4; p.roll_cd = 0.9; p.stam -= 20.0; p.blocking = false; p.last_act = Instant::now();
                                }
                            }
                            "block" => {
                                let p = w.players.get_mut(&id).unwrap();
                                let on = m["on"].as_bool().unwrap_or(false) && p.roll_t <= 0.0 && p.stam > 5.0;
                                if on && !p.blocking { p.block_t = 0.0; }
                                p.blocking = on; p.last_act = Instant::now();
                            }
                            "punch" => { w.players.get_mut(&id).unwrap().last_act = Instant::now(); w.punch(id); }
                            "wall" | "fire" => { w.players.get_mut(&id).unwrap().last_act = Instant::now(); w.quick(id, kind == "wall"); }
                            "place" | "remove" => {
                                let cell = |k: &str| m[k].as_i64().unwrap_or(0).clamp(-1000, 1000) as i32;
                                let (cx, cy) = (cell("cx"), cell("cy"));
                                w.players.get_mut(&id).unwrap().last_act = Instant::now();
                                if kind == "place" { w.place(id, m["k"].as_u64().unwrap_or(99).min(99) as usize, cx, cy); } else { w.demolish(id, cx, cy); }
                            }
                            "equip" => { let p = w.players.get_mut(&id).unwrap(); p.hammer = m["h"].as_bool().unwrap_or(false); if p.hammer { p.blocking = false; } p.last_act = Instant::now(); }
                            "craft" => { w.craft(id, m["k"].as_str().unwrap_or("")); }
                            _ => {}
                        }
                    }
                }
            }
            Ok(Message::Close(_)) => break,
            Ok(_) => {}
            Err(WsError::Io(e)) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(_) => break,
        }
        for msg in rx.try_iter() {
            if ws.send(Message::text(msg)).is_err() { break 'conn; }
        }
        if let Err(e) = ws.flush() { if !matches!(&e, WsError::Io(io) if io.kind() == ErrorKind::WouldBlock) { break; } }
    }
    lock.lock().unwrap().players.remove(&id);
}

fn main() {
    let port = std::env::var("PORT").unwrap_or_else(|_| "8080".into());
    let listener = TcpListener::bind(format!("0.0.0.0:{port}")).expect("bind");
    let mut world = World::new();
    world.load(&save_path());
    store::init();
    let shared: Shared = Arc::new((Mutex::new(world), Condvar::new()));
    { let s = shared.clone(); thread::spawn(move || tick_loop(s)); }
    println!("elf-punch on {port}");
    let live = Arc::new(AtomicUsize::new(0));
    for stream in listener.incoming().flatten() {
        if live.fetch_add(1, Ordering::SeqCst) >= 120 { live.fetch_sub(1, Ordering::SeqCst); continue; }
        let (shared, live) = (shared.clone(), live.clone());
        thread::Builder::new().stack_size(128 * 1024).spawn(move || {
            let mut peek = [0u8; 512];
            let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
            let n = stream.peek(&mut peek).unwrap_or(0);
            let head = String::from_utf8_lossy(&peek[..n]).to_ascii_lowercase();
            let kv = head.split_whitespace().nth(1).map_or(false, |p| p == "/kv" || p.starts_with("/kv/"));
            if kv { let _ = stream.set_read_timeout(Some(Duration::from_secs(5))); store::serve(stream); }
            else if head.starts_with("get /ws ") || head.starts_with("get /ws?") { let _ = stream.set_read_timeout(None); ws_conn(stream, shared); } else { http(stream, shared); }
            live.fetch_sub(1, Ordering::SeqCst);
        }).ok();
    }
}
