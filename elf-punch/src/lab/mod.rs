//! The lab: authoritative games. The browser is only a screen and a keyboard: the server owns the rules and the state, so nobody can
//! edit their own score. Contrast with `/kv`, where the browsers hold the rules and the server just stores what they write.
//!
//! A game is one type implementing [`Game`]. The lab gives it everything around the rules:
//!  - players: `POST /lab/<game>/join {"name"}` returns a secret token (shown once). Send it back as `Authorization: Bearer <token>`.
//!    Tokens are stored as SHA-256 hashes. There are no accounts, emails or passwords: the token is the player.
//!  - one endpoint to read what a player may see (`GET /lab/<game>/me`), one for public information (`GET /lab/<game>/board`),
//!    one for actions (`POST /lab/<game>/act`)
//!  - saving to `LAB_DIR` (default `/data/lab`), limits per address and per player, and "last seen" for presence
//! The game itself never touches sockets, files or clocks: it is handed `now` (seconds), so it is easy to test.
//!
//! To add a game: write a type that implements `Game` (see `clicker.rs`, 40 lines, and `tradewars.rs`), add it in `Lab::new`, and
//! write its rules tests next to it. State must be JSON-able (`save`/`load`), and everything it reads from a request is untrusted.
mod sha256;
mod tradewars;
#[cfg(test)]
mod clicker;

use crate::http::{err, limited, read_request, respond, Reply, Request};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::TcpStream;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::Duration;

/// What the lab tells a game about the world around one call.
pub struct Ctx<'a> {
    pub now: u64,
    /// when each player was last heard from (any authenticated call), in seconds
    pub last_seen: &'a HashMap<u32, u64>,
}

impl Ctx<'_> {
    pub fn online(&self, pid: u32, within: u64) -> bool {
        self.last_seen.get(&pid).map_or(false, |t| self.now.saturating_sub(*t) <= within)
    }
}

pub trait Game: Send {
    fn id(&self) -> &'static str;
    fn title(&self) -> &'static str;
    fn about(&self) -> &'static str;
    /// A new player has joined (the lab has checked the name). Set up their state.
    fn join(&mut self, ctx: &Ctx, pid: u32, name: &str) -> Result<(), String>;
    /// Everything this player may see right now (including what time has changed since they last looked).
    fn view(&mut self, ctx: &Ctx, pid: u32) -> Value;
    /// Public information: no login needed.
    fn board(&mut self, ctx: &Ctx) -> Value;
    /// One thing the player does. The action is untrusted JSON. `Err` is shown to the player and changes nothing.
    fn act(&mut self, ctx: &Ctx, pid: u32, action: &Value) -> Result<Value, String>;
    fn save(&self) -> Value;
    fn load(&mut self, v: &Value);
}

pub struct LabLimits {
    pub max_players: usize,
    pub ip_req_per_min: u32,
    pub ip_joins_per_hour: u32,
    pub act_per_min: u32,
}

impl LabLimits {
    pub fn from_env() -> LabLimits {
        let n = |k: &str, d: u64| std::env::var(k).ok().and_then(|v| v.parse().ok()).unwrap_or(d);
        LabLimits {
            max_players: n("LAB_MAX_PLAYERS", 1000) as usize,
            ip_req_per_min: n("LAB_IP_REQ_PER_MIN", 240) as u32,
            ip_joins_per_hour: n("LAB_IP_JOINS_PER_HOUR", 6) as u32,
            act_per_min: n("LAB_ACT_PER_MIN", 90) as u32,
        }
    }
}

struct PlayerRec {
    id: u32,
    name: String,
    hash: String, // sha256 of the token, hex
    joined: u64,
}

struct Slot {
    game: Box<dyn Game>,
    players: Vec<PlayerRec>,
    by_hash: HashMap<String, u32>,
    by_name: HashMap<String, u32>, // lowercase name -> id
    last_seen: HashMap<u32, u64>,
    next_id: u32,
    dirty: bool,
}

#[derive(Default)]
struct IpRate { min_start: u64, reqs: u32, hour_start: u64, joins: u32 }
#[derive(Default)]
struct PlayerRate { min_start: u64, acts: u32 }

pub struct Lab {
    slots: Vec<Slot>,
    dir: PathBuf,
    lim: LabLimits,
    ips: HashMap<String, IpRate>,
    acts: HashMap<(usize, u32), PlayerRate>,
}

/// 2 to 16 letters, digits, spaces, `_` and `-`; spaces collapsed. `None` if it will not do.
pub fn clean_name(raw: &str) -> Option<String> {
    let t: String = raw.chars().filter(|c| c.is_ascii_alphanumeric() || *c == ' ' || *c == '_' || *c == '-').collect();
    let t = t.split_whitespace().collect::<Vec<_>>().join(" ");
    if t.len() < 2 || t.len() > 16 { return None; }
    if ["admin", "system", "server", "everyone", "news"].contains(&t.to_ascii_lowercase().as_str()) { return None; }
    Some(t)
}

fn random_token() -> Option<String> {
    use std::io::Read;
    let mut b = [0u8; 16];
    std::fs::File::open("/dev/urandom").ok()?.read_exact(&mut b).ok()?;
    Some(sha256::hex(&b))
}

impl Lab {
    pub fn new(dir: PathBuf, lim: LabLimits, games: Vec<Box<dyn Game>>) -> Lab {
        let mut lab = Lab { slots: Vec::new(), dir, lim, ips: HashMap::new(), acts: HashMap::new() };
        for game in games {
            let mut slot = Slot { game, players: Vec::new(), by_hash: HashMap::new(), by_name: HashMap::new(), last_seen: HashMap::new(), next_id: 1, dirty: false };
            lab.load_slot(&mut slot);
            lab.slots.push(slot);
        }
        lab
    }

    fn path(&self, id: &str) -> PathBuf { self.dir.join(format!("{id}.json")) }

    // A save that cannot be read is moved aside and the game starts fresh: the server must always come up (the store shares this process).
    fn load_slot(&self, slot: &mut Slot) {
        let path = self.path(slot.game.id());
        let Ok(text) = std::fs::read_to_string(&path) else { return };
        let parsed: Result<Value, _> = serde_json::from_str(&text);
        let Some(v) = parsed.ok().filter(|v| v["v"] == 1) else {
            let aside = path.with_extension(format!("corrupt-{}", crate::http::now_secs()));
            eprintln!("lab: {} could not be read; moved to {}", path.display(), aside.display());
            let _ = std::fs::rename(&path, aside);
            return;
        };
        slot.next_id = v["next_id"].as_u64().unwrap_or(1) as u32;
        for p in v["players"].as_array().into_iter().flatten() {
            let (Some(id), Some(name), Some(hash)) = (p["id"].as_u64(), p["name"].as_str(), p["hash"].as_str()) else { continue };
            let id = id as u32;
            slot.by_hash.insert(hash.to_string(), id);
            slot.by_name.insert(name.to_ascii_lowercase(), id);
            slot.players.push(PlayerRec { id, name: name.to_string(), hash: hash.to_string(), joined: p["joined"].as_u64().unwrap_or(0) });
        }
        slot.game.load(&v["game"]);
    }

    /// Writes every game that changed since the last save (tmp file, then rename, so a crash never leaves half a file).
    pub fn save_dirty(&mut self) {
        let _ = std::fs::create_dir_all(&self.dir);
        for i in 0..self.slots.len() {
            if !self.slots[i].dirty { continue; }
            let s = &self.slots[i];
            let v = json!({
                "v": 1, "next_id": s.next_id,
                "players": s.players.iter().map(|p| json!({"id": p.id, "name": p.name, "hash": p.hash, "joined": p.joined})).collect::<Vec<_>>(),
                "game": s.game.save(),
            });
            let path = self.path(s.game.id());
            let tmp = path.with_extension("json.tmp");
            if std::fs::write(&tmp, v.to_string()).and_then(|_| std::fs::rename(&tmp, &path)).is_ok() { self.slots[i].dirty = false; }
            else { eprintln!("lab: could not save {}", path.display()); }
        }
    }

    fn rate_ip(&mut self, ip: &str, now: u64, join: bool) -> Option<Reply> {
        if self.ips.len() > 5000 { self.ips.retain(|_, r| now.saturating_sub(r.min_start) < 3600); }
        let r = self.ips.entry(ip.to_string()).or_default();
        if now.saturating_sub(r.min_start) >= 60 { r.min_start = now; r.reqs = 0; }
        if now.saturating_sub(r.hour_start) >= 3600 { r.hour_start = now; r.joins = 0; }
        r.reqs += 1;
        if r.reqs > self.lim.ip_req_per_min { return Some(limited(60 - now.saturating_sub(r.min_start).min(59), "too many requests from this address")); }
        if join {
            r.joins += 1;
            if r.joins > self.lim.ip_joins_per_hour { return Some(limited(3600 - now.saturating_sub(r.hour_start).min(3599), "too many new players from this address")); }
        }
        None
    }

    fn token_of(req: &Request) -> Option<String> {
        let v = req.header("authorization")?;
        let t = v.strip_prefix("Bearer ").or_else(|| v.strip_prefix("bearer "))?.trim();
        (t.len() >= 16 && t.len() <= 128).then(|| t.to_string())
    }

    /// The whole API, with no sockets in it (so the tests call it directly).
    pub fn handle(&mut self, req: &Request, now: u64) -> Reply {
        let rest = req.path.strip_prefix("/lab").unwrap_or("").trim_matches('/');
        let parts: Vec<&str> = if rest.is_empty() { vec![] } else { rest.split('/').collect() };
        if let Some(rep) = self.rate_ip(&req.ip, now, req.method == "POST" && parts.get(1) == Some(&"join")) { return rep; }
        if req.method == "OPTIONS" { return Reply { status: 204, body: String::new(), retry_after: None }; }
        if parts.is_empty() {
            if req.method != "GET" { return err(405, "method_not_allowed", "GET only"); }
            let list: Vec<Value> = self.slots.iter().map(|s| json!({"id": s.game.id(), "title": s.game.title(), "about": s.game.about(), "players": s.players.len()})).collect();
            return Reply { status: 200, body: json!({"games": list, "now": now}).to_string(), retry_after: None };
        }
        let Some(si) = self.slots.iter().position(|s| s.game.id() == parts[0]) else { return err(404, "no_such_game", "no such game") };
        let action = parts.get(1).copied().unwrap_or("");
        if parts.len() > 2 { return err(404, "not_found", "no such endpoint"); }
        match (req.method.as_str(), action) {
            ("GET", "board") => {
                let slot = &mut self.slots[si];
                let ctx = Ctx { now, last_seen: &slot.last_seen };
                Reply { status: 200, body: slot.game.board(&ctx).to_string(), retry_after: None }
            }
            ("POST", "join") => self.join(si, req, now),
            ("GET", "me") | ("POST", "act") => {
                let Some(token) = Self::token_of(req) else { return err(401, "no_token", "send your token as Authorization: Bearer <token>") };
                let hash = sha256::sha256_hex(&token);
                let Some(&pid) = self.slots[si].by_hash.get(&hash) else { return err(401, "bad_token", "that token is not a player of this game") };
                self.slots[si].last_seen.insert(pid, now);
                if action == "act" {
                    let r = self.acts.entry((si, pid)).or_default();
                    if now.saturating_sub(r.min_start) >= 60 { r.min_start = now; r.acts = 0; }
                    r.acts += 1;
                    if r.acts > self.lim.act_per_min { return limited(60 - now.saturating_sub(r.min_start).min(59), "slow down"); }
                    let Ok(v) = serde_json::from_slice::<Value>(&req.body) else { return err(400, "bad_json", "the body is not JSON") };
                    let slot = &mut self.slots[si];
                    let ctx = Ctx { now, last_seen: &slot.last_seen };
                    let res = slot.game.act(&ctx, pid, &v);
                    // a refused action changes nothing, so there is nothing to save (and a flood of refusals costs no disk)
                    match res {
                        Ok(out) => { slot.dirty = true; Reply { status: 200, body: out.to_string(), retry_after: None } }
                        Err(msg) => err(400, "refused", &msg),
                    }
                } else {
                    let slot = &mut self.slots[si];
                    let ctx = Ctx { now, last_seen: &slot.last_seen };
                    let v = slot.game.view(&ctx, pid); // (time-based state is stored with its timestamp, so looking changes nothing that needs saving)
                    Reply { status: 200, body: v.to_string(), retry_after: None }
                }
            }
            _ => err(404, "not_found", "no such endpoint"),
        }
    }

    fn join(&mut self, si: usize, req: &Request, now: u64) -> Reply {
        let Ok(v) = serde_json::from_slice::<Value>(&req.body) else { return err(400, "bad_json", "send {\"name\": \"...\"}") };
        let Some(name) = v["name"].as_str().and_then(clean_name) else {
            return err(400, "bad_name", "a name is 2 to 16 letters, digits, spaces, _ or -");
        };
        if self.slots[si].players.len() >= self.lim.max_players { return err(507, "full", "this game is full"); }
        let lower = name.to_ascii_lowercase();
        if self.slots[si].by_name.contains_key(&lower) { return err(409, "name_taken", "that name is taken"); }
        let Some(token) = random_token() else { return err(500, "no_randomness", "could not make a token") };
        let slot = &mut self.slots[si];
        let pid = slot.next_id;
        let ctx = Ctx { now, last_seen: &slot.last_seen };
        if let Err(m) = slot.game.join(&ctx, pid, &name) { return err(400, "refused", &m); }
        slot.next_id += 1;
        let hash = sha256::sha256_hex(&token);
        slot.by_hash.insert(hash.clone(), pid);
        slot.by_name.insert(lower, pid);
        slot.players.push(PlayerRec { id: pid, name: name.clone(), hash, joined: now });
        slot.last_seen.insert(pid, now);
        slot.dirty = true;
        Reply { status: 201, body: json!({"id": pid, "name": name, "token": token}).to_string(), retry_after: None }
    }
}

// ----- the running server -----

static LAB: OnceLock<Mutex<Lab>> = OnceLock::new();

/// All the games this server hosts.
fn games() -> Vec<Box<dyn Game>> {
    vec![Box::new(tradewars::TradeWars::new(tradewars::Config::from_env()))]
}

pub fn init() {
    let dir = PathBuf::from(std::env::var("LAB_DIR").unwrap_or_else(|_| "/data/lab".into()));
    let lab = Lab::new(dir, LabLimits::from_env(), games());
    let _ = LAB.set(Mutex::new(lab));
    // saves what changed every few seconds; asleep work costs nothing when nothing changed
    thread::spawn(|| loop {
        thread::sleep(Duration::from_secs(3));
        if let Some(l) = LAB.get() { l.lock().unwrap().save_dirty(); }
    });
}

pub fn serve(mut s: TcpStream) {
    let Some(lab) = LAB.get() else { return };
    let r = match read_request(&mut s, 16_384) {
        Ok(r) => r,
        Err(Some(rep)) => return respond(&mut s, &rep),
        Err(None) => return,
    };
    let rep = lab.lock().unwrap().handle(&r, crate::http::now_secs());
    respond(&mut s, &rep);
}

#[cfg(test)]
mod tests;
