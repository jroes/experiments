//! Warp Traders: the universe. One shared galaxy where everyone trades, and where other traders are in the sectors with you.
//! Inspired by the old BBS space-trading doors (original rules and text). The server decides everything:
//!
//!  - **Ports are shared.** Stock moves when anyone trades, and drifts back to its resting level over hours, so a route that
//!    everyone runs gets worse and an untouched one recovers. Prices come from stock: plenty on the shelf is cheap, a bare shelf is dear.
//!  - **Turns, not a clock.** Each warp costs a turn. Turns refill slowly (1 per `turn_secs`, up to `turn_cap`), so you can play for a
//!    few minutes a few times a day. Trading itself is free.
//!  - **Other traders.** You see who is in your sector. You can attack them with fighters: the loser's ship is destroyed (cargo
//!    and fighters gone, back to Stardock), and the winner takes what fits in their holds. Credits are never taken. New
//!    players, and anyone just destroyed, are protected for a while, and nobody can be attacked at Stardock.
//!  - **Everything lazy.** Nothing ticks. Ports and turns are brought up to date from their timestamps whenever someone looks, so the
//!    machine can sleep when nobody is playing.
use super::{Ctx, Game};
use serde_json::{json, Value};
use std::collections::{BTreeSet, HashMap, VecDeque};

pub const GOODS: [&str; 3] = ["fuel", "organics", "equipment"];
const LABELS: [&str; 3] = ["Fuel ore", "Organics", "Equipment"];
const BASE: [f64; 3] = [20.0, 40.0, 80.0];
const FIGHTER_COST: i64 = 40;
const START_CREDITS: i64 = 1000;
const START_HOLDS: u32 = 20;
const MAX_HOLDS: u32 = 200;
const MAX_FIGHTERS: u32 = 5000;
const ATTACK_TURNS: u32 = 3;
const ONLINE_SECS: u64 = 120;
const NEWS_MAX: usize = 40;
const INBOX_MAX: usize = 30;
const MILESTONES: [i64; 9] = [2_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];

pub struct Config {
    pub seed: u64,
    pub sectors: usize,
    pub turn_secs: u64,
    pub turn_cap: u32,
    pub start_turns: u32,
    /// how fast a port's stock drifts back to rest (seconds for about two thirds of the way)
    pub port_tau: f64,
    pub protect_new_secs: u64,
    pub protect_death_secs: u64,
}

impl Config {
    pub fn from_env() -> Config {
        let n = |k: &str, d: u64| std::env::var(k).ok().and_then(|v| v.parse().ok()).unwrap_or(d);
        let seed = n("LAB_TW_SEED", crate::http::now_secs() ^ 0x5DEECE66D);
        Config {
            seed, sectors: n("LAB_TW_SECTORS", 250).clamp(20, 1000) as usize,
            turn_secs: n("LAB_TW_TURN_SECS", 90).max(1), turn_cap: n("LAB_TW_TURN_CAP", 600) as u32, start_turns: n("LAB_TW_START_TURNS", 300) as u32,
            port_tau: n("LAB_TW_PORT_TAU", 14_400) as f64,
            protect_new_secs: n("LAB_TW_PROTECT_NEW_SECS", 3 * 3600), protect_death_secs: n("LAB_TW_PROTECT_DEATH_SECS", 3600),
        }
    }
}

// ----- a small seeded random generator (xorshift64*): the server's own luck, not the game's rules -----
#[derive(Clone)]
pub struct Rng(u64);
impl Rng {
    pub fn new(seed: u64) -> Rng { Rng(seed.wrapping_mul(0x9E3779B97F4A7C15) | 1) }
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12; x ^= x << 25; x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545F4914F6CDD1D)
    }
    pub fn f(&mut self) -> f64 { (self.next() >> 11) as f64 / (1u64 << 53) as f64 }
}

#[derive(Clone)]
pub struct Port {
    /// per good: true if the port sells it (cheap when full), false if it buys it (dear when empty)
    pub sells: [bool; 3],
    pub max: [f64; 3],
    pub stock: [f64; 3],
    pub t: u64,
}

pub struct Sector {
    pub id: usize,
    pub x: f64,
    pub y: f64,
    pub warps: Vec<usize>,
    pub port: Option<Port>,
}

struct Seen { t: u64, stock: [f64; 3] }

struct Msg { t: u64, from: String, text: String }
struct News { t: u64, text: String }

pub struct Player {
    pub id: u32,
    pub name: String,
    pub sector: usize,
    pub credits: i64,
    pub holds: u32,
    pub fighters: u32,
    pub cargo: [u32; 3],
    paid: [f64; 3],
    turns: u32,
    turns_t: u64,
    visited: BTreeSet<usize>,
    seen: HashMap<usize, Seen>,
    kills: u32,
    deaths: u32,
    protected_until: u64,
    inbox: VecDeque<Msg>,
    joined: u64,
    milestone: usize,
    trades: u32,
}

pub struct TradeWars {
    cfg: Config,
    sectors: Vec<Sector>,
    players: HashMap<u32, Player>,
    news: VecDeque<News>,
    rng: Rng,
}

// ----- prices: stock decides, and what you buy you can sell back at the same price (no free money at one port) -----

pub fn unit_price(good: usize, stock: f64, max: f64) -> f64 {
    BASE[good] * (1.25 - 0.5 * (stock / max).clamp(0.0, 1.0))
}

/// What `qty` units cost (buying, rounded up) or pay (selling, rounded down). Each unit is priced on the stock edge it crosses.
pub fn quote(p: &Port, good: usize, qty: u32, buying: bool) -> i64 {
    let mut stock = p.stock[good];
    let mut total = 0.0;
    for _ in 0..qty {
        total += unit_price(good, if buying { stock - 1.0 } else { stock }, p.max[good]);
        stock += if buying { -1.0 } else { 1.0 };
    }
    if buying { (total - 1e-6).ceil() as i64 } else { (total + 1e-6).floor() as i64 }
}

fn hold_cost(holds: u32) -> i64 { 150 + 15 * holds as i64 }

impl Port {
    /// Brings the stock up to date: it drifts toward its resting level (full for what the port sells, nearly empty for what it buys).
    pub fn refresh(&mut self, now: u64, tau: f64) {
        if now <= self.t { return; }
        let f = 1.0 - (-((now - self.t) as f64) / tau).exp();
        for g in 0..3 {
            let rest = if self.sells[g] { 0.9 * self.max[g] } else { 0.05 * self.max[g] };
            self.stock[g] += (rest - self.stock[g]) * f;
        }
        self.t = now;
    }

    fn max_buy(&self, good: usize, holds_free: u32, credits: i64) -> u32 {
        let (mut lo, mut hi) = (0u32, (self.stock[good].floor().max(0.0) as u32).min(holds_free));
        while lo < hi { // largest q whose price fits the budget (the total only grows with q)
            let mid = (lo + hi + 1) / 2;
            if quote(self, good, mid, true) <= credits { lo = mid; } else { hi = mid - 1; }
        }
        lo
    }
}

// ----- the galaxy -----

fn dist(a: &Sector, b: &Sector) -> f64 { ((a.x - b.x).powi(2) + (a.y - b.y).powi(2)).sqrt() }

pub fn make_galaxy(seed: u64, n: usize, now: u64) -> Vec<Sector> {
    let mut rng = Rng::new(seed);
    let (w, h) = (220.0, 150.0);
    let mut sectors: Vec<Sector> = Vec::new();
    let mut tries = 0;
    while sectors.len() < n && tries < 100_000 {
        tries += 1;
        let (x, y) = (5.0 + rng.f() * (w - 10.0), 5.0 + rng.f() * (h - 10.0));
        let s = Sector { id: 0, x, y, warps: vec![], port: None };
        if sectors.iter().all(|o| dist(&s, o) > 7.0) { sectors.push(s); }
    }
    // sector 0 is Stardock: the one nearest the middle
    let mid = Sector { id: 0, x: w / 2.0, y: h / 2.0, warps: vec![], port: None };
    sectors.sort_by(|a, b| dist(a, &mid).partial_cmp(&dist(b, &mid)).unwrap());
    for (i, s) in sectors.iter_mut().enumerate() { s.id = i; s.x = (s.x * 10.0).round() / 10.0; s.y = (s.y * 10.0).round() / 10.0; }
    let n = sectors.len();
    // lanes: a spanning tree (so everything can be reached) plus each sector's two nearest
    let mut edges: Vec<(f64, usize, usize)> = Vec::new();
    for i in 0..n { for j in i + 1..n { edges.push((dist(&sectors[i], &sectors[j]), i, j)); } }
    edges.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
    let mut uf: Vec<usize> = (0..n).collect();
    fn find(uf: &mut Vec<usize>, x: usize) -> usize { if uf[x] != x { let r = find(uf, uf[x]); uf[x] = r; } uf[x] }
    let link = |sectors: &mut Vec<Sector>, a: usize, b: usize| {
        if !sectors[a].warps.contains(&b) { sectors[a].warps.push(b); }
        if !sectors[b].warps.contains(&a) { sectors[b].warps.push(a); }
    };
    for &(_, a, b) in &edges {
        let (ra, rb) = (find(&mut uf, a), find(&mut uf, b));
        if ra != rb { uf[ra] = rb; link(&mut sectors, a, b); }
    }
    for i in 0..n {
        let mut near: Vec<usize> = (0..n).filter(|&j| j != i).collect();
        near.sort_by(|&a, &b| dist(&sectors[a], &sectors[i]).partial_cmp(&dist(&sectors[b], &sectors[i])).unwrap());
        for &j in near.iter().take(2) { link(&mut sectors, i, j); }
    }
    for s in sectors.iter_mut() { s.warps.sort_unstable(); }
    // ports in about two thirds of the sectors (never at Stardock)
    for i in 1..n {
        if rng.f() > 0.68 { continue; }
        let sells_n = 1 + (rng.f() < 0.4) as usize;
        let mut order = [0usize, 1, 2];
        for k in (1..3).rev() { let j = (rng.f() * (k + 1) as f64) as usize; order.swap(k, j); }
        let mut sells = [false; 3];
        for &g in order.iter().take(sells_n) { sells[g] = true; }
        let (mut max, mut stock) = ([0.0; 3], [0.0; 3]);
        for g in 0..3 {
            max[g] = ((600.0 + rng.f() * 1400.0) * if g == 2 { 0.6 } else { 1.0 }).round();
            stock[g] = if sells[g] { max[g] * (0.5 + rng.f() * 0.5) } else { max[g] * rng.f() * 0.3 };
        }
        sectors[i].port = Some(Port { sells, max, stock, t: now });
    }
    sectors
}

fn ago(secs: u64) -> String {
    if secs < 90 { "just now".into() } else if secs < 5400 { format!("{} min ago", secs / 60) } else if secs < 129_600 { format!("{} h ago", secs / 3600) } else { format!("{} days ago", secs / 86_400) }
}

fn num(n: i64) -> String {
    let s = n.abs().to_string();
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() { if i > 0 && (s.len() - i) % 3 == 0 { out.push(','); } out.push(c); }
    if n < 0 { format!("-{out}") } else { out }
}

/// Who wins a fight between `a` attacking fighters and `d` defending ones: both sides lose fighters every round until one is gone.
/// Returns what is left of each. A tie in the last round destroys both (`(0, 0)`).
pub fn fight(rng: &mut Rng, a: u32, d: u32) -> (u32, u32) {
    let (mut a, mut d) = (a as f64, d as f64);
    for _ in 0..80 {
        if a <= 0.0 || d <= 0.0 { break; }
        let ka = (a * 0.35 * (0.7 + 0.6 * rng.f())).max(1.0);
        let kd = (d * 0.35 * (0.7 + 0.6 * rng.f())).max(1.0);
        d -= ka; a -= kd;
    }
    (a.max(0.0).floor() as u32, d.max(0.0).floor() as u32)
}

impl TradeWars {
    pub fn new(cfg: Config) -> TradeWars {
        let sectors = make_galaxy(cfg.seed, cfg.sectors, crate::http::now_secs());
        let rng = Rng::new(cfg.seed ^ 0xABCDEF);
        TradeWars { cfg, sectors, players: HashMap::new(), news: VecDeque::new(), rng }
    }

    fn push_news(&mut self, now: u64, text: String) {
        self.news.push_front(News { t: now, text });
        self.news.truncate(NEWS_MAX);
    }

    pub fn net_worth(p: &Player) -> i64 {
        let cargo: f64 = (0..3).map(|g| p.cargo[g] as f64 * BASE[g]).sum();
        p.credits + cargo as i64 + p.fighters as i64 * FIGHTER_COST / 2 + p.holds.saturating_sub(START_HOLDS) as i64 * 40
    }

    // brings a player's turns up to date
    fn refresh_turns(cfg: &Config, p: &mut Player, now: u64) {
        if p.turns >= cfg.turn_cap { p.turns_t = now; return; }
        let gained = (now.saturating_sub(p.turns_t) / cfg.turn_secs) as u32;
        if gained > 0 {
            p.turns = (p.turns + gained).min(cfg.turn_cap);
            p.turns_t = if p.turns >= cfg.turn_cap { now } else { p.turns_t + gained as u64 * cfg.turn_secs };
        }
    }

    fn refresh_port(&mut self, sec: usize, now: u64) {
        let tau = self.cfg.port_tau;
        if let Some(p) = self.sectors[sec].port.as_mut() { p.refresh(now, tau); }
    }

    /// moves a player into a sector: they learn it, and take a snapshot of the port
    fn arrive(&mut self, pid: u32, sec: usize, now: u64) {
        self.refresh_port(sec, now);
        let stock = self.sectors[sec].port.as_ref().map(|p| p.stock);
        let p = self.players.get_mut(&pid).unwrap();
        p.sector = sec;
        p.visited.insert(sec);
        if let Some(stock) = stock { p.seen.insert(sec, Seen { t: now, stock }); }
    }

    fn rank_of(&self, pid: u32) -> usize {
        let mine = Self::net_worth(&self.players[&pid]);
        1 + self.players.values().filter(|o| { let w = Self::net_worth(o); w > mine || (w == mine && o.id < pid) }).count()
    }

    fn port_json(&self, sec: usize) -> Value {
        match &self.sectors[sec].port {
            None => Value::Null,
            Some(p) => json!({"goods": (0..3).map(|g| json!({
                "good": GOODS[g], "label": LABELS[g], "mode": if p.sells[g] { "sell" } else { "buy" },
                "stock": p.stock[g].floor(), "max": p.max[g], "price": (unit_price(g, p.stock[g], p.max[g]) * 10.0).round() / 10.0,
            })).collect::<Vec<_>>()}),
        }
    }

    fn view_for(&mut self, ctx: &Ctx, pid: u32) -> Value {
        let now = ctx.now;
        let sec = self.players[&pid].sector;
        self.refresh_port(sec, now);
        let cfg = &self.cfg;
        let p = self.players.get_mut(&pid).unwrap();
        Self::refresh_turns(cfg, p, now);
        let p = &self.players[&pid];
        let mut known: BTreeSet<usize> = p.visited.clone();
        for &v in &p.visited { for &w in &self.sectors[v].warps { known.insert(w); } }
        let map: Vec<Value> = known.iter().map(|&i| {
            let s = &self.sectors[i];
            let seen = p.seen.get(&i).and_then(|sn| s.port.as_ref().map(|port| json!({
                "t": sn.t, "ago": ago(now.saturating_sub(sn.t)),
                "goods": (0..3).map(|g| json!({"good": GOODS[g], "mode": if port.sells[g] { "sell" } else { "buy" }, "stock": sn.stock[g].floor(), "max": port.max[g],
                    "price": (unit_price(g, sn.stock[g], port.max[g]) * 10.0).round() / 10.0})).collect::<Vec<_>>(),
            })));
            json!({"id": i, "x": s.x, "y": s.y, "warps": s.warps, "visited": p.visited.contains(&i), "port": seen, "dock": i == 0})
        }).collect();
        let here: Vec<Value> = self.players.values().filter(|o| o.id != pid && o.sector == p.sector).map(|o| {
            let size = match o.fighters { 0 => "none", 1..=19 => "a few", 20..=99 => "some", _ => "many" };
            let loaded = o.cargo.iter().sum::<u32>() * 2 >= o.holds;
            json!({"name": o.name, "online": ctx.online(o.id, ONLINE_SECS), "protected": o.protected_until > now, "fighters": size, "loaded": loaded})
        }).collect();
        let next_in = if p.turns >= cfg.turn_cap { 0 } else { cfg.turn_secs - now.saturating_sub(p.turns_t).min(cfg.turn_secs - 1) };
        json!({
            "now": now,
            "you": {
                "id": pid, "name": p.name, "credits": p.credits, "turns": p.turns, "turns_cap": cfg.turn_cap, "next_turn_in": next_in, "turn_secs": cfg.turn_secs,
                "holds": p.holds, "cargo": {"fuel": p.cargo[0], "organics": p.cargo[1], "equipment": p.cargo[2]},
                "avg_paid": {"fuel": avg(p.paid[0], p.cargo[0]), "organics": avg(p.paid[1], p.cargo[1]), "equipment": avg(p.paid[2], p.cargo[2])},
                "fighters": p.fighters, "sector": p.sector, "kills": p.kills, "deaths": p.deaths,
                "protected_secs": p.protected_until.saturating_sub(now), "net_worth": Self::net_worth(p), "rank": self.rank_of(pid), "players": self.players.len(),
            },
            "sector": {"id": p.sector, "x": self.sectors[p.sector].x, "y": self.sectors[p.sector].y, "warps": self.sectors[p.sector].warps,
                "dock": p.sector == 0, "port": self.port_json(p.sector), "here": here},
            "map": map,
            "inbox": p.inbox.iter().map(|m| json!({"t": m.t, "ago": ago(now.saturating_sub(m.t)), "from": m.from, "text": m.text})).collect::<Vec<_>>(),
            "news": self.news.iter().take(15).map(|n| json!({"t": n.t, "ago": ago(now.saturating_sub(n.t)), "text": n.text})).collect::<Vec<_>>(),
            "costs": {"hold": hold_cost(p.holds), "fighter": FIGHTER_COST, "attack_turns": ATTACK_TURNS, "max_holds": MAX_HOLDS},
        })
    }

    // shortest known route: through sectors the player has visited (and the target)
    fn route(&self, pid: u32, to: usize) -> Option<Vec<usize>> {
        let p = &self.players[&pid];
        let ok = |i: usize| p.visited.contains(&i) || i == to;
        let mut prev: HashMap<usize, usize> = HashMap::new();
        let mut q = VecDeque::from([p.sector]);
        let mut seen: BTreeSet<usize> = BTreeSet::from([p.sector]);
        while let Some(c) = q.pop_front() {
            if c == to { break; }
            for &n in &self.sectors[c].warps {
                if seen.contains(&n) || !ok(n) { continue; }
                seen.insert(n); prev.insert(n, c); q.push_back(n);
            }
        }
        if !seen.contains(&to) { return None; }
        let mut out = vec![];
        let mut c = to;
        while c != p.sector { out.push(c); c = prev[&c]; }
        out.reverse();
        Some(out)
    }

    fn warp_step(&mut self, pid: u32, to: usize, now: u64) -> Result<(), String> {
        let p = &self.players[&pid];
        if !self.sectors[p.sector].warps.contains(&to) { return Err("There is no warp lane there.".into()); }
        if p.turns < 1 { return Err("You are out of turns. They come back slowly.".into()); }
        self.players.get_mut(&pid).unwrap().turns -= 1;
        self.arrive(pid, to, now);
        Ok(())
    }

    fn good_of(a: &Value) -> Result<usize, String> {
        let g = a["good"].as_str().ok_or("Which good?")?;
        GOODS.iter().position(|x| *x == g).ok_or_else(|| "That is not something a port trades.".to_string())
    }

    // a quantity: a whole number, or "max"
    fn qty_of(a: &Value) -> Result<Option<u32>, String> {
        if a["qty"].as_str() == Some("max") { return Ok(None); }
        let n = a["qty"].as_u64().ok_or("The amount must be a whole number.")?;
        if n < 1 || n > 1_000_000 { return Err("The amount must be at least 1.".into()); }
        Ok(Some(n as u32))
    }

    fn trade(&mut self, pid: u32, a: &Value, buying: bool, now: u64) -> Result<String, String> {
        let g = Self::good_of(a)?;
        let want = Self::qty_of(a)?;
        let sec = self.players[&pid].sector;
        self.refresh_port(sec, now);
        let port = self.sectors[sec].port.as_ref().ok_or("There is no port here.")?;
        if port.sells[g] != buying { return Err(format!("This port will not {} {}.", if buying { "sell you" } else { "buy" }, LABELS[g].to_lowercase())); }
        let p = self.players.get(&pid).unwrap();
        if buying {
            let free = p.holds.saturating_sub(p.cargo.iter().sum());
            let best = port.max_buy(g, free, p.credits);
            let qty = want.unwrap_or(best);
            if qty < 1 { return Err("You cannot afford any, or have no room.".into()); }
            if qty as f64 > port.stock[g].floor() { return Err(format!("The port has only {}.", port.stock[g].floor())); }
            if qty > free { return Err("You do not have enough empty holds.".into()); }
            let cost = quote(port, g, qty, true);
            if cost > p.credits { return Err("You cannot afford that.".into()); }
            let port = self.sectors[sec].port.as_mut().unwrap();
            port.stock[g] -= qty as f64;
            let p = self.players.get_mut(&pid).unwrap();
            p.credits -= cost; p.paid[g] += cost as f64; p.cargo[g] += qty; p.trades += 1;
            Ok(format!("Bought {qty} {} for {}.", LABELS[g].to_lowercase(), num(cost)))
        } else {
            let room = (port.max[g] - port.stock[g]).floor().max(0.0) as u32;
            let qty = want.unwrap_or_else(|| p.cargo[g].min(room));
            if qty < 1 { return Err(if room < 1 { "The port is full of that.".into() } else { "You have none to sell.".into() }); }
            if qty > p.cargo[g] { return Err(format!("You only have {}.", p.cargo[g])); }
            if qty > room { return Err("The port cannot take that much.".into()); }
            let gain = quote(port, g, qty, false);
            let avg = if p.cargo[g] > 0 { p.paid[g] / p.cargo[g] as f64 } else { 0.0 };
            let profit = gain - (avg * qty as f64).round() as i64;
            let port = self.sectors[sec].port.as_mut().unwrap();
            port.stock[g] += qty as f64;
            let p = self.players.get_mut(&pid).unwrap();
            p.paid[g] = (p.paid[g] - avg * qty as f64).max(0.0);
            p.credits += gain; p.cargo[g] -= qty; p.trades += 1;
            Ok(format!("Sold {qty} {} for {} ({}{}).", LABELS[g].to_lowercase(), num(gain), if profit >= 0 { "+" } else { "" }, num(profit)))
        }
    }

    fn check_milestone(&mut self, pid: u32, now: u64) {
        let p = &self.players[&pid];
        let w = Self::net_worth(p);
        let reached = MILESTONES.iter().take_while(|m| **m <= w).count();
        if reached > p.milestone {
            let name = p.name.clone();
            self.players.get_mut(&pid).unwrap().milestone = reached;
            self.push_news(now, format!("{name} is now worth {} credits.", num(MILESTONES[reached - 1])));
        }
    }

    fn attack(&mut self, pid: u32, a: &Value, now: u64) -> Result<String, String> {
        let name = a["target"].as_str().ok_or("Attack whom?")?.trim().to_ascii_lowercase();
        let tid = self.players.values().find(|o| o.name.to_ascii_lowercase() == name).map(|o| o.id).ok_or("There is no trader by that name.")?;
        if tid == pid { return Err("You cannot attack yourself.".into()); }
        let (me, them) = (&self.players[&pid], &self.players[&tid]);
        if me.sector != them.sector { return Err("They are not in your sector.".into()); }
        if me.sector == 0 { return Err("Nobody fights at Stardock.".into()); }
        if them.protected_until > now { return Err(format!("{} is protected for another {}.", them.name, ago_in(them.protected_until - now))); }
        if me.fighters < 1 { return Err("You have no fighters to attack with.".into()); }
        if me.turns < ATTACK_TURNS { return Err(format!("An attack takes {ATTACK_TURNS} turns.")); }
        let (af, df) = (me.fighters, them.fighters);
        let (a_left, d_left) = fight(&mut self.rng, af, df);
        let sec = me.sector;
        let (an, dn) = (me.name.clone(), them.name.clone());
        self.players.get_mut(&pid).unwrap().turns -= ATTACK_TURNS;
        self.players.get_mut(&pid).unwrap().protected_until = 0; // attacking ends your own protection
        let attacker_won = a_left > 0 && d_left == 0;
        let defender_won = d_left > 0;
        let (winner, loser, left) = if attacker_won { (pid, tid, a_left) } else if defender_won { (tid, pid, d_left) } else { (0, 0, 0) };
        if winner == 0 { // both destroyed
            for id in [pid, tid] { self.destroy(id, now); }
            self.push_news(now, format!("{an} and {dn} destroyed each other in sector {}.", sec + 1));
            return Ok(format!("Both ships were destroyed. You are back at Stardock with nothing but your credits."));
        }
        // the loser's cargo goes to the winner as far as their holds allow; the rest is lost
        let mut took = [0u32; 3];
        {
            let l = &self.players[&loser];
            let w = &self.players[&winner];
            let mut free = w.holds.saturating_sub(w.cargo.iter().sum());
            for g in 0..3 { let t = l.cargo[g].min(free); took[g] = t; free -= t; }
        }
        let lost_cargo: u32 = self.players[&loser].cargo.iter().sum();
        self.destroy(loser, now);
        let w = self.players.get_mut(&winner).unwrap();
        w.fighters = left; w.kills += 1;
        for g in 0..3 { w.cargo[g] += took[g]; w.paid[g] += took[g] as f64 * BASE[g]; }
        let took_total: u32 = took.iter().sum();
        let (wn, ln) = if winner == pid { (an.clone(), dn.clone()) } else { (dn.clone(), an.clone()) };
        self.push_news(now, format!("{wn} destroyed {ln} in sector {}{}.", sec + 1, if took_total > 0 { format!(" and took {took_total} units of cargo") } else { String::new() }));
        self.check_milestone(winner, now);
        let note = format!("{wn} destroyed {ln} in sector {} with {left} fighters left{}.", sec + 1, if lost_cargo > 0 { format!("; {took_total} of {lost_cargo} units of cargo changed hands") } else { String::new() });
        // whoever lost is told, in their inbox
        let t = now;
        let other = if loser == pid { tid } else { pid };
        let _ = other;
        self.players.get_mut(&tid).unwrap().inbox.push_front(Msg { t, from: "News".into(), text: note.clone() });
        self.players.get_mut(&tid).unwrap().inbox.truncate(INBOX_MAX);
        Ok(if attacker_won { format!("Victory. {note}") } else { format!("Defeat. {note}") })
    }

    // a destroyed ship: fighters and cargo gone, back at Stardock, protected for a while. Credits stay.
    fn destroy(&mut self, id: u32, now: u64) {
        let prot = self.cfg.protect_death_secs;
        let p = self.players.get_mut(&id).unwrap();
        p.fighters = 0; p.cargo = [0; 3]; p.paid = [0.0; 3];
        p.sector = 0; p.visited.insert(0);
        p.deaths += 1;
        p.protected_until = now + prot;
    }

    fn say(&mut self, pid: u32, a: &Value, now: u64) -> Result<String, String> {
        let to = a["to"].as_str().ok_or("Say it to whom?")?.trim().to_ascii_lowercase();
        let text: String = a["text"].as_str().ok_or("Say what?")?.chars().filter(|c| !c.is_control()).collect::<String>().trim().chars().take(140).collect();
        if text.is_empty() { return Err("Say what?".into()); }
        let tid = self.players.values().find(|o| o.name.to_ascii_lowercase() == to).map(|o| o.id).ok_or("There is no trader by that name.")?;
        let from = self.players[&pid].name.clone();
        let target = self.players.get_mut(&tid).unwrap();
        target.inbox.push_front(Msg { t: now, from, text });
        target.inbox.truncate(INBOX_MAX);
        Ok(format!("Sent to {}.", target.name))
    }
}

fn avg(paid: f64, n: u32) -> f64 { if n == 0 { 0.0 } else { (paid / n as f64 * 10.0).round() / 10.0 } }
fn ago_in(secs: u64) -> String { if secs < 90 { "a minute".into() } else if secs < 5400 { format!("{} minutes", secs / 60) } else { format!("{} hours", (secs + 1800) / 3600) } }

impl Game for TradeWars {
    fn id(&self) -> &'static str { "warptraders" }
    fn title(&self) -> &'static str { "Warp Traders: the universe" }
    fn about(&self) -> &'static str { "One shared galaxy. Buy low, sell high, and watch who else is in the sector." }

    fn join(&mut self, ctx: &Ctx, pid: u32, name: &str) -> Result<(), String> {
        let now = ctx.now;
        let p = Player {
            id: pid, name: name.to_string(), sector: 0, credits: START_CREDITS, holds: START_HOLDS, fighters: 0, cargo: [0; 3], paid: [0.0; 3],
            turns: self.cfg.start_turns, turns_t: now, visited: BTreeSet::from([0]), seen: HashMap::new(), kills: 0, deaths: 0,
            protected_until: now + self.cfg.protect_new_secs, inbox: VecDeque::new(), joined: now, milestone: 0, trades: 0,
        };
        self.players.insert(pid, p);
        self.push_news(now, format!("{name} docked at Stardock."));
        Ok(())
    }

    fn view(&mut self, ctx: &Ctx, pid: u32) -> Value {
        if !self.players.contains_key(&pid) { return json!({"error": "not playing"}); }
        self.view_for(ctx, pid)
    }

    fn board(&mut self, ctx: &Ctx) -> Value {
        let mut rows: Vec<&Player> = self.players.values().collect();
        rows.sort_by(|a, b| Self::net_worth(b).cmp(&Self::net_worth(a)).then(a.id.cmp(&b.id)));
        let online = rows.iter().filter(|p| ctx.online(p.id, ONLINE_SECS)).count();
        json!({
            "now": ctx.now, "players": rows.len(), "online": online, "sectors": self.sectors.len(),
            "top": rows.iter().take(25).enumerate().map(|(i, p)| json!({"rank": i + 1, "name": p.name, "net_worth": Self::net_worth(p), "kills": p.kills, "online": ctx.online(p.id, ONLINE_SECS)})).collect::<Vec<_>>(),
            "news": self.news.iter().take(20).map(|n| json!({"t": n.t, "ago": ago(ctx.now.saturating_sub(n.t)), "text": n.text})).collect::<Vec<_>>(),
        })
    }

    fn act(&mut self, ctx: &Ctx, pid: u32, a: &Value) -> Result<Value, String> {
        let now = ctx.now;
        if !self.players.contains_key(&pid) { return Err("You are not playing.".into()); }
        {
            let cfg = &self.cfg;
            Self::refresh_turns(cfg, self.players.get_mut(&pid).unwrap(), now);
        }
        let sec = self.players[&pid].sector;
        let msg: String = match a["do"].as_str().unwrap_or("") {
            "warp" => {
                let to = a["to"].as_u64().ok_or("Where to?")? as usize;
                if to >= self.sectors.len() { return Err("There is no such sector.".into()); }
                self.warp_step(pid, to, now)?;
                format!("Warped to sector {}.", to + 1)
            }
            "travel" => {
                let to = a["to"].as_u64().ok_or("Where to?")? as usize;
                if to >= self.sectors.len() { return Err("There is no such sector.".into()); }
                if to == sec { return Err("You are already there.".into()); }
                let route = self.route(pid, to).ok_or("You do not know a way there yet.")?;
                if route.len() as u32 > self.players[&pid].turns { return Err(format!("That is {} warps and you have {} turns.", route.len(), self.players[&pid].turns)); }
                for step in &route { self.warp_step(pid, *step, now)?; }
                format!("Travelled {} warps to sector {}.", route.len(), to + 1)
            }
            "buy" => self.trade(pid, a, true, now)?,
            "sell" => self.trade(pid, a, false, now)?,
            "holds" => {
                if sec != 0 { return Err("Only at Stardock.".into()); }
                let p = self.players.get_mut(&pid).unwrap();
                if p.holds + 5 > MAX_HOLDS { return Err("That is as many holds as a ship can carry.".into()); }
                let c = hold_cost(p.holds);
                if p.credits < c { return Err("You cannot afford that.".into()); }
                p.credits -= c; p.holds += 5;
                format!("Added 5 holds for {}.", num(c))
            }
            "fighters" => {
                if sec != 0 { return Err("Only at Stardock.".into()); }
                let n = a["qty"].as_u64().filter(|n| (1..=100_000).contains(n)).ok_or("Buy at least 1 fighter.")? as u32;
                let p = self.players.get_mut(&pid).unwrap();
                if p.fighters + n > MAX_FIGHTERS { return Err(format!("A ship can carry {MAX_FIGHTERS} fighters at most.")); }
                let c = n as i64 * FIGHTER_COST;
                if p.credits < c { return Err("You cannot afford that.".into()); }
                p.credits -= c; p.fighters += n;
                format!("Bought {n} fighters for {}.", num(c))
            }
            "attack" => self.attack(pid, a, now)?,
            "say" => self.say(pid, a, now)?,
            _ => return Err("Unknown action.".into()),
        };
        self.check_milestone(pid, now);
        let view = self.view_for(ctx, pid);
        Ok(json!({"msg": msg, "view": view}))
    }

    fn save(&self) -> Value {
        json!({
            "seed": self.cfg.seed,
            "sectors": self.sectors.iter().map(|s| json!({"id": s.id, "x": s.x, "y": s.y, "warps": s.warps,
                "port": s.port.as_ref().map(|p| json!({"sells": p.sells, "max": p.max, "stock": p.stock, "t": p.t}))})).collect::<Vec<_>>(),
            "players": self.players.values().map(|p| json!({
                "id": p.id, "name": p.name, "sector": p.sector, "credits": p.credits, "holds": p.holds, "fighters": p.fighters, "cargo": p.cargo, "paid": p.paid,
                "turns": p.turns, "turns_t": p.turns_t, "visited": p.visited, "kills": p.kills, "deaths": p.deaths, "protected_until": p.protected_until,
                "joined": p.joined, "milestone": p.milestone, "trades": p.trades,
                "seen": p.seen.iter().map(|(k, s)| json!({"sector": k, "t": s.t, "stock": s.stock})).collect::<Vec<_>>(),
                "inbox": p.inbox.iter().map(|m| json!({"t": m.t, "from": m.from, "text": m.text})).collect::<Vec<_>>(),
            })).collect::<Vec<_>>(),
            "news": self.news.iter().map(|n| json!({"t": n.t, "text": n.text})).collect::<Vec<_>>(),
        })
    }

    fn load(&mut self, v: &Value) {
        let arr3 = |x: &Value| -> [f64; 3] { let mut o = [0.0; 3]; for i in 0..3 { o[i] = x[i].as_f64().unwrap_or(0.0); } o };
        let bool3 = |x: &Value| -> [bool; 3] { let mut o = [false; 3]; for i in 0..3 { o[i] = x[i].as_bool().unwrap_or(false); } o };
        let sectors: Vec<Sector> = v["sectors"].as_array().into_iter().flatten().enumerate().map(|(i, s)| Sector {
            id: i, x: s["x"].as_f64().unwrap_or(0.0), y: s["y"].as_f64().unwrap_or(0.0),
            warps: s["warps"].as_array().into_iter().flatten().filter_map(|w| w.as_u64().map(|w| w as usize)).collect(),
            port: s["port"].is_object().then(|| Port { sells: bool3(&s["port"]["sells"]), max: arr3(&s["port"]["max"]), stock: arr3(&s["port"]["stock"]), t: s["port"]["t"].as_u64().unwrap_or(0) }),
        }).collect();
        if sectors.len() < 2 { return; } // nothing usable: keep the galaxy made at start
        let n = sectors.len();
        if sectors.iter().any(|s| s.warps.iter().any(|&w| w >= n)) { return; }
        self.sectors = sectors;
        if let Some(seed) = v["seed"].as_u64() { self.cfg.seed = seed; }
        self.players.clear();
        for p in v["players"].as_array().into_iter().flatten() {
            let (Some(id), Some(name)) = (p["id"].as_u64(), p["name"].as_str()) else { continue };
            let sector = (p["sector"].as_u64().unwrap_or(0) as usize).min(n - 1);
            let mut cargo = [0u32; 3];
            for g in 0..3 { cargo[g] = p["cargo"][g].as_u64().unwrap_or(0) as u32; }
            self.players.insert(id as u32, Player {
                id: id as u32, name: name.to_string(), sector, credits: p["credits"].as_i64().unwrap_or(START_CREDITS), holds: p["holds"].as_u64().unwrap_or(START_HOLDS as u64) as u32,
                fighters: p["fighters"].as_u64().unwrap_or(0) as u32, cargo, paid: arr3(&p["paid"]), turns: p["turns"].as_u64().unwrap_or(0) as u32, turns_t: p["turns_t"].as_u64().unwrap_or(0),
                visited: p["visited"].as_array().into_iter().flatten().filter_map(|x| x.as_u64().map(|x| x as usize)).filter(|x| *x < n).collect::<BTreeSet<_>>(),
                seen: p["seen"].as_array().into_iter().flatten().filter_map(|s| Some((s["sector"].as_u64()? as usize, Seen { t: s["t"].as_u64()?, stock: arr3(&s["stock"]) }))).collect(),
                kills: p["kills"].as_u64().unwrap_or(0) as u32, deaths: p["deaths"].as_u64().unwrap_or(0) as u32, protected_until: p["protected_until"].as_u64().unwrap_or(0),
                inbox: p["inbox"].as_array().into_iter().flatten().filter_map(|m| Some(Msg { t: m["t"].as_u64()?, from: m["from"].as_str()?.to_string(), text: m["text"].as_str()?.to_string() })).collect(),
                joined: p["joined"].as_u64().unwrap_or(0), milestone: p["milestone"].as_u64().unwrap_or(0) as usize, trades: p["trades"].as_u64().unwrap_or(0) as u32,
            });
            if let Some(pl) = self.players.get_mut(&(id as u32)) { pl.visited.insert(0); }
        }
        self.news = v["news"].as_array().into_iter().flatten().filter_map(|m| Some(News { t: m["t"].as_u64()?, text: m["text"].as_str()?.to_string() })).collect();
    }
}
