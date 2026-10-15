//! Jetfall relay (`GET /jetfall`, WebSocket). One player's browser hosts the game; the server only puts people in rooms, passes
//! WebRTC signaling between host and guests, and passes binary game packets when WebRTC can't connect. All in memory, nothing saved.
//!
//! Latency matters (a host sends at 30 Hz to up to 15 guests), so this does not use tungstenite's read-with-timeout loop.
//! tungstenite only does the HTTP handshake; after that each connection has one blocking reader thread, and any thread can write a
//! frame straight into any peer's socket through `Peer` (a mutex around a cloned `TcpStream`, 1 s write timeout). A write that
//! fails or times out marks the peer dead and shuts its socket, which wakes its reader so it cleans up.
//!
//! Lock order: the hub, then a room. Nothing takes the hub while holding a room.

use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::io::{self, ErrorKind, Read, Write};
use std::net::{Shutdown, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

const ALPHABET: &[u8; 32] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const INFO_MAX: usize = 600;
const SIG_MAX: usize = 16 * 1024;
const LIST_MAX: usize = 50;
const BROADCAST: u16 = 0xFFFF;

struct Cfg {
    room_max: usize,
    rooms: usize,
    conns: usize,
    bin_max: usize,
    text_max: usize,
    host_msgs: f64,
    host_bytes: f64,
    guest_msgs: f64,
    guest_bytes: f64,
    idle: Duration,
    hello: Duration,
}

fn env_num(k: &str, d: u64) -> u64 {
    std::env::var(k).ok().and_then(|v| v.trim().parse().ok()).unwrap_or(d)
}

fn cfg() -> &'static Cfg {
    static C: OnceLock<Cfg> = OnceLock::new();
    C.get_or_init(|| Cfg {
        room_max: env_num("JF_ROOM_MAX", 15).clamp(1, 65534) as usize,
        rooms: env_num("JF_ROOMS", 40) as usize,
        conns: env_num("JF_CONNS", 150) as usize,
        bin_max: env_num("JF_BIN_MAX", 64 * 1024).clamp(16, 16 << 20) as usize,
        text_max: env_num("JF_TEXT_MAX", 16 * 1024).clamp(1024, 1 << 20) as usize,
        host_msgs: env_num("JF_HOST_MSGS", 1500).max(1) as f64,
        host_bytes: env_num("JF_HOST_BYTES", 2_000_000).max(1) as f64,
        guest_msgs: env_num("JF_GUEST_MSGS", 300).max(1) as f64,
        guest_bytes: env_num("JF_GUEST_BYTES", 200_000).max(1) as f64,
        idle: Duration::from_secs(env_num("JF_IDLE_SECS", 60).max(1)),
        hello: Duration::from_secs(env_num("JF_HELLO_SECS", 30).max(1)),
    })
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

// ---------- pure parts (unit tested) ----------

/// Trim, drop control characters, at most 24 characters; empty becomes `dflt`.
pub(crate) fn clean_name(s: &str, dflt: &str) -> String {
    let s: String = s.trim().chars().filter(|c| !c.is_control()).take(24).collect();
    let s = s.trim();
    if s.is_empty() { dflt.to_string() } else { s.to_string() }
}

/// Six characters from `ALPHABET`, taken from the bits of `x`.
pub(crate) fn room_code(mut x: u64) -> String {
    let mut s = String::with_capacity(6);
    for _ in 0..6 {
        s.push(ALPHABET[(x % 32) as usize] as char);
        x /= 32;
    }
    s
}

/// Listing info: a JSON object of at most 600 bytes.
fn clean_info(v: Option<&Value>) -> Option<Value> {
    let v = v?;
    if !v.is_object() || serde_json::to_string(v).map_or(true, |s| s.len() > INFO_MAX) { return None; }
    Some(v.clone())
}

fn rand64() -> u64 {
    use std::hash::{BuildHasher, Hasher};
    static N: AtomicU64 = AtomicU64::new(0);
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u64(N.fetch_add(1, Ordering::Relaxed));
    h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos()));
    h.finish()
}

/// Token bucket for messages and bytes; it holds one second's worth.
pub(crate) struct Bucket {
    msgs: f64,
    bytes: f64,
    rate_m: f64,
    rate_b: f64,
    cap_b: f64,
    last: f64,
}

impl Bucket {
    /// `min_burst` is the biggest single message that must always fit once the bucket is full.
    pub(crate) fn new(rate_m: f64, rate_b: f64, min_burst: usize, now: f64) -> Bucket {
        let cap_b = rate_b.max(min_burst as f64);
        Bucket { msgs: rate_m, bytes: cap_b, rate_m, rate_b, cap_b, last: now }
    }
    pub(crate) fn take(&mut self, now: f64, n: usize) -> bool {
        let dt = (now - self.last).max(0.0);
        self.last = self.last.max(now);
        self.msgs = (self.msgs + dt * self.rate_m).min(self.rate_m);
        self.bytes = (self.bytes + dt * self.rate_b).min(self.cap_b);
        if self.msgs < 1.0 || self.bytes < n as f64 { return false; }
        self.msgs -= 1.0;
        self.bytes -= n as f64;
        true
    }
}

#[derive(Debug, PartialEq)]
pub(crate) enum FrameErr {
    Protocol,
    TooBig,
}

#[derive(Debug)]
pub(crate) struct Frame {
    pub fin: bool,
    pub op: u8,
    pub data: Vec<u8>,
}

/// One client frame from the front of `buf`: `Ok(None)` when more bytes are needed, else the frame and how many bytes it used.
/// Client frames must be masked. A declared length over `max` is refused as soon as the header is in, before the payload arrives.
pub(crate) fn parse_frame(buf: &[u8], max: usize) -> Result<Option<(Frame, usize)>, FrameErr> {
    let (Some(&b0), Some(&b1)) = (buf.first(), buf.get(1)) else { return Ok(None) };
    if b0 & 0x70 != 0 || b1 & 0x80 == 0 { return Err(FrameErr::Protocol); }
    let (fin, op) = (b0 & 0x80 != 0, b0 & 0x0f);
    let (len, mut pos) = match b1 & 0x7f {
        126 => match buf.get(2..4) {
            Some(b) => (u16::from_be_bytes([b[0], b[1]]) as u64, 4),
            None => return Ok(None),
        },
        127 => match buf.get(2..10) {
            Some(b) => {
                let mut a = [0u8; 8];
                a.copy_from_slice(b);
                (u64::from_be_bytes(a), 10)
            }
            None => return Ok(None),
        },
        n => (n as u64, 2),
    };
    if op >= 8 && (!fin || len > 125) { return Err(FrameErr::Protocol); }
    if len > max as u64 { return Err(FrameErr::TooBig); }
    let len = len as usize;
    let Some(key) = buf.get(pos..pos + 4) else { return Ok(None) };
    let key = [key[0], key[1], key[2], key[3]];
    pos += 4;
    let Some(body) = buf.get(pos..pos + len) else { return Ok(None) };
    let data = body.iter().enumerate().map(|(i, b)| b ^ key[i & 3]).collect();
    Ok(Some((Frame { fin, op, data }, pos + len)))
}

/// A server frame (unmasked, FIN set) whose payload is `parts` joined.
pub(crate) fn encode_frame(op: u8, parts: &[&[u8]]) -> Vec<u8> {
    let len: usize = parts.iter().map(|p| p.len()).sum();
    let mut f = Vec::with_capacity(len + 10);
    f.push(0x80 | (op & 0x0f));
    if len < 126 {
        f.push(len as u8);
    } else if len <= 0xFFFF {
        f.push(126);
        f.extend_from_slice(&(len as u16).to_be_bytes());
    } else {
        f.push(127);
        f.extend_from_slice(&(len as u64).to_be_bytes());
    }
    for p in parts { f.extend_from_slice(p); }
    f
}

// ---------- peers, rooms, hub ----------

#[derive(Clone)]
struct Peer(Arc<PeerInner>);

struct PeerInner {
    out: Mutex<TcpStream>,
    dead: AtomicBool,
}

impl Peer {
    fn dead(&self) -> bool {
        self.0.dead.load(Ordering::SeqCst)
    }
    fn send(&self, frame: &[u8]) -> bool {
        if self.dead() { return false; }
        let mut s = lock(&self.0.out);
        if s.write_all(frame).is_ok() { return true; }
        self.0.dead.store(true, Ordering::SeqCst);
        let _ = s.shutdown(Shutdown::Both);
        false
    }
    fn text(&self, s: &str) -> bool {
        self.send(&encode_frame(1, &[s.as_bytes()]))
    }
    fn error(&self, why: &str) {
        self.text(&json!({ "t": "error", "why": why }).to_string());
    }
    /// Close frame (best effort), then shut the socket. Wakes the peer's reader.
    fn close(&self, code: u16) {
        if self.0.dead.swap(true, Ordering::SeqCst) { return; }
        let mut s = lock(&self.0.out);
        let _ = s.write_all(&encode_frame(8, &[&code.to_be_bytes()]));
        let _ = s.shutdown(Shutdown::Both);
    }
}

struct Guest {
    peer: Peer,
}

struct Room {
    code: String,
    st: Mutex<RoomSt>,
}

struct RoomSt {
    name: String,
    info: Value,
    host: Peer,
    guests: BTreeMap<u16, Guest>,
    next: u32,
    closed: bool,
}

fn hub() -> MutexGuard<'static, HashMap<String, Arc<Room>>> {
    static H: OnceLock<Mutex<HashMap<String, Arc<Room>>>> = OnceLock::new();
    lock(H.get_or_init(|| Mutex::new(HashMap::new())))
}

static CONNS: AtomicUsize = AtomicUsize::new(0);

enum Role {
    None,
    Host(Arc<Room>),
    Guest(Arc<Room>),
}

struct Conn {
    id: u16,
    role: Role,
    me: Peer,
    bucket: Bucket,
    born: Instant,
}

impl Conn {
    fn secs(&self) -> f64 {
        self.born.elapsed().as_secs_f64()
    }
}

// ---------- handshake ----------

/// Hands tungstenite the request head and not one byte more, so nothing the client sends after it is left in tungstenite's buffer.
struct HeadOnly {
    s: TcpStream,
    win: u32,
    done: bool,
}

impl Read for HeadOnly {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.done || buf.is_empty() { return Ok(0); }
        let n = self.s.peek(buf)?;
        let mut take = n;
        for (i, b) in buf.iter().take(n).enumerate() {
            self.win = (self.win << 8) | *b as u32;
            if self.win == 0x0d0a_0d0a {
                take = i + 1;
                self.done = true;
                break;
            }
        }
        self.s.read_exact(&mut buf[..take])?;
        Ok(take)
    }
}

impl Write for HeadOnly {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.s.write(buf)
    }
    fn flush(&mut self) -> io::Result<()> {
        self.s.flush()
    }
}

struct Slot;
impl Drop for Slot {
    fn drop(&mut self) {
        CONNS.fetch_sub(1, Ordering::SeqCst);
    }
}

// ---------- connection ----------

pub fn serve(stream: TcpStream) {
    let c = cfg();
    if CONNS.fetch_add(1, Ordering::SeqCst) >= c.conns {
        CONNS.fetch_sub(1, Ordering::SeqCst);
        let _ = (&stream).write_all(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 4\r\nConnection: close\r\n\r\nbusy");
        return;
    }
    let _slot = Slot;
    let _ = stream.set_nodelay(true);
    let _ = stream.set_write_timeout(Some(Duration::from_secs(1)));
    let (Ok(out), Ok(mut rd)) = (stream.try_clone(), stream.try_clone()) else { return };
    match tungstenite::accept(HeadOnly { s: stream, win: 0, done: false }) {
        Ok(ws) => drop(ws),
        Err(_) => return,
    }
    let _ = rd.set_read_timeout(Some(Duration::from_secs(1)));
    let me = Peer(Arc::new(PeerInner { out: Mutex::new(out), dead: AtomicBool::new(false) }));
    let mut conn = Conn { id: 0, role: Role::None, me: me.clone(), bucket: Bucket::new(c.guest_msgs, c.guest_bytes, c.bin_max, 0.0), born: Instant::now() };
    let frame_max = c.bin_max.max(c.text_max);
    let mut buf: Vec<u8> = Vec::with_capacity(4096);
    let mut chunk = vec![0u8; 16 * 1024];
    let mut frag: Option<(u8, Vec<u8>)> = None;
    let mut last_rx = Instant::now();
    'conn: loop {
        if me.dead() { break; }
        if last_rx.elapsed() > c.idle || (matches!(conn.role, Role::None) && conn.born.elapsed() > c.hello) {
            me.close(1000);
            break;
        }
        match rd.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                buf.extend_from_slice(&chunk[..n]);
                last_rx = Instant::now();
            }
            Err(e) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut | ErrorKind::Interrupted) => continue,
            Err(_) => break,
        }
        let mut start = 0;
        loop {
            let (f, used) = match parse_frame(&buf[start..], frame_max) {
                Ok(Some(x)) => x,
                Ok(None) => break,
                Err(FrameErr::TooBig) => { me.close(1009); break 'conn; }
                Err(FrameErr::Protocol) => { me.close(1002); break 'conn; }
            };
            start += used;
            let msg = match f.op {
                0x8 => {
                    let code = match f.data.get(0..2) { Some(b) => [b[0], b[1]], None => 1000u16.to_be_bytes() };
                    me.close(u16::from_be_bytes(code)); // echo it once; the close at the end is then a no-op
                    break 'conn;
                }
                0x9 => {
                    if conn.bucket.take(conn.secs(), f.data.len()) { me.send(&encode_frame(0xA, &[&f.data])); }
                    continue;
                }
                0xA => continue,
                0x1 | 0x2 if frag.is_none() => {
                    if f.fin { (f.op, f.data) } else { frag = Some((f.op, f.data)); (0, Vec::new()) }
                }
                0x0 if frag.is_some() => {
                    let Some((op, mut acc)) = frag.take() else { break 'conn };
                    acc.extend_from_slice(&f.data);
                    if acc.len() > frame_max { me.close(1009); break 'conn; }
                    if f.fin { (op, acc) } else { frag = Some((op, acc)); (0, Vec::new()) }
                }
                _ => { me.close(1002); break 'conn; }
            };
            match msg {
                (0, _) => {
                    if frag.as_ref().is_some_and(|(op, acc)| acc.len() > if *op == 1 { c.text_max } else { c.bin_max }) {
                        me.close(1009);
                        break 'conn;
                    }
                }
                (1, data) => {
                    if data.len() > c.text_max { me.close(1009); break 'conn; }
                    let Ok(s) = std::str::from_utf8(&data) else { me.close(1007); break 'conn };
                    if conn.bucket.take(conn.secs(), data.len()) { on_text(&mut conn, s); }
                }
                (_, data) => {
                    if data.len() > c.bin_max { me.close(1009); break 'conn; }
                    if conn.bucket.take(conn.secs(), data.len()) { on_binary(&conn, &data); }
                }
            }
        }
        buf.drain(..start);
    }
    me.close(1000);
    leave(&conn);
}

fn leave(conn: &Conn) {
    match &conn.role {
        Role::None => {}
        Role::Host(room) => {
            {
                let mut h = hub();
                if h.get(&room.code).is_some_and(|r| Arc::ptr_eq(r, room)) { h.remove(&room.code); }
            }
            let guests = {
                let mut st = lock(&room.st);
                st.closed = true;
                std::mem::take(&mut st.guests)
            };
            let closed = json!({ "t": "closed" }).to_string();
            for g in guests.values() {
                g.peer.text(&closed);
                g.peer.close(1000);
            }
        }
        Role::Guest(room) => {
            let host = {
                let mut st = lock(&room.st);
                if !st.closed && st.guests.remove(&conn.id).is_some() { Some(st.host.clone()) } else { None }
            };
            if let Some(h) = host { h.text(&json!({ "t": "left", "id": conn.id }).to_string()); }
        }
    }
}

fn on_text(conn: &mut Conn, s: &str) {
    let Ok(m) = serde_json::from_str::<Value>(s) else { return };
    let str_of = |k: &str| m.get(k).and_then(Value::as_str).unwrap_or("");
    match str_of("t") {
        "ping" => { conn.me.text(r#"{"t":"pong"}"#); }
        "list" => { conn.me.text(&list()); }
        "host" => host(conn, str_of("name"), m.get("info")),
        "join" => join(conn, str_of("room"), str_of("name")),
        "info" => {
            if let Role::Host(room) = &conn.role {
                match clean_info(m.get("info")) {
                    Some(info) => lock(&room.st).info = info,
                    None => conn.me.error("bad-info"),
                }
            }
        }
        "sig" => {
            let Some(to) = m.get("to").and_then(Value::as_u64) else { return };
            let d = m.get("d").cloned().unwrap_or(Value::Null);
            if serde_json::to_string(&d).map_or(true, |s| s.len() > SIG_MAX) { return; }
            let target = match &conn.role {
                Role::Guest(room) if to == 0 => {
                    let st = lock(&room.st);
                    if st.closed { None } else { Some(st.host.clone()) }
                }
                Role::Host(room) if to > 0 && to < BROADCAST as u64 => lock(&room.st).guests.get(&(to as u16)).map(|g| g.peer.clone()),
                _ => None,
            };
            if let Some(p) = target { p.text(&json!({ "t": "sig", "from": conn.id, "d": d }).to_string()); }
        }
        "kick" => {
            let Role::Host(room) = &conn.role else { return };
            let Some(id) = m.get("id").and_then(Value::as_u64).filter(|i| *i > 0 && *i < BROADCAST as u64) else { return };
            let g = lock(&room.st).guests.remove(&(id as u16));
            if let Some(g) = g {
                g.peer.error("kicked");
                g.peer.close(1000);
                conn.me.text(&json!({ "t": "left", "id": id }).to_string());
            }
        }
        _ => {}
    }
}

fn list() -> String {
    let h = hub();
    let mut rooms: Vec<(String, Value)> = Vec::new();
    for (code, room) in h.iter() {
        let st = lock(&room.st);
        if st.closed || st.info.get("public") != Some(&Value::Bool(true)) { continue; }
        rooms.push((code.clone(), json!({ "room": code, "name": st.name, "info": st.info, "n": st.guests.len() })));
    }
    drop(h);
    rooms.sort_by(|a, b| a.0.cmp(&b.0));
    let rooms: Vec<Value> = rooms.into_iter().take(LIST_MAX).map(|r| r.1).collect();
    json!({ "t": "rooms", "rooms": rooms }).to_string()
}

fn host(conn: &mut Conn, name: &str, info: Option<&Value>) {
    if !matches!(conn.role, Role::None) { return conn.me.error("already"); }
    let c = cfg();
    let mut h = hub();
    if h.len() >= c.rooms {
        drop(h);
        return conn.me.error("busy");
    }
    let Some(code) = (0..100).map(|_| room_code(rand64())).find(|k| !h.contains_key(k)) else {
        drop(h);
        return conn.me.error("busy");
    };
    let room = Arc::new(Room {
        code: code.clone(),
        st: Mutex::new(RoomSt {
            name: clean_name(name, "room"),
            info: clean_info(info).unwrap_or_else(|| json!({})),
            host: conn.me.clone(),
            guests: BTreeMap::new(),
            next: 1,
            closed: false,
        }),
    });
    // Hold the room until "hosted" is written, so a joiner can't put a "peer" in front of it.
    let st = lock(&room.st);
    h.insert(code.clone(), room.clone());
    drop(h);
    conn.me.text(&json!({ "t": "hosted", "room": code, "id": 0 }).to_string());
    drop(st);
    conn.bucket = Bucket::new(c.host_msgs, c.host_bytes, c.bin_max, conn.secs());
    conn.role = Role::Host(room);
}

fn join(conn: &mut Conn, code: &str, name: &str) {
    if !matches!(conn.role, Role::None) { return conn.me.error("already"); }
    let code = code.trim().to_ascii_uppercase();
    let room = if code.len() == 6 { hub().get(&code).cloned() } else { None };
    let Some(room) = room else { return conn.me.error("no-room") };
    let name = clean_name(name, "player");
    let mut st = lock(&room.st);
    if st.closed { drop(st); return conn.me.error("no-room"); }
    if st.guests.len() >= cfg().room_max || st.next > 65534 { drop(st); return conn.me.error("full"); }
    let id = st.next as u16;
    st.next += 1;
    st.guests.insert(id, Guest { peer: conn.me.clone() });
    // Written under the room lock, so a broadcast that already includes this guest comes after "joined".
    conn.me.text(&json!({ "t": "joined", "room": room.code, "id": id }).to_string());
    let host = st.host.clone();
    drop(st);
    host.text(&json!({ "t": "peer", "id": id, "name": name }).to_string());
    conn.id = id;
    conn.role = Role::Guest(room);
}

fn on_binary(conn: &Conn, data: &[u8]) {
    let (Some(&hi), Some(&lo), Some(payload)) = (data.first(), data.get(1), data.get(2..)) else { return };
    let to = u16::from_be_bytes([hi, lo]);
    let targets: Vec<Peer> = match &conn.role {
        Role::None => return,
        Role::Guest(room) => {
            if to != 0 { return; }
            let st = lock(&room.st);
            if st.closed { return; }
            vec![st.host.clone()]
        }
        Role::Host(room) => {
            let st = lock(&room.st);
            if to == BROADCAST { st.guests.values().map(|g| g.peer.clone()).collect() }
            else { st.guests.get(&to).map(|g| g.peer.clone()).into_iter().collect() }
        }
    };
    if targets.is_empty() { return; }
    let frame = encode_frame(2, &[&conn.id.to_be_bytes(), payload]);
    for p in &targets { p.send(&frame); }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn client_frame(fin: bool, op: u8, payload: &[u8], key: [u8; 4]) -> Vec<u8> {
        let mut f = vec![(if fin { 0x80 } else { 0 }) | op];
        let len = payload.len();
        if len < 126 { f.push(0x80 | len as u8); }
        else if len <= 0xFFFF { f.push(0x80 | 126); f.extend_from_slice(&(len as u16).to_be_bytes()); }
        else { f.push(0x80 | 127); f.extend_from_slice(&(len as u64).to_be_bytes()); }
        f.extend_from_slice(&key);
        f.extend(payload.iter().enumerate().map(|(i, b)| b ^ key[i & 3]));
        f
    }

    #[test]
    fn names() {
        assert_eq!(clean_name("  ann  ", "player"), "ann");
        assert_eq!(clean_name("", "player"), "player");
        assert_eq!(clean_name(" \u{7}\n\t ", "room"), "room");
        assert_eq!(clean_name("a\u{0}b\u{1b}c\u{85}d", "player"), "abcd");
        let long = "é".repeat(40);
        assert_eq!(clean_name(&long, "player").chars().count(), 24);
        assert_eq!(clean_name("🚀🚀🚀", "player"), "🚀🚀🚀");
        assert_eq!(clean_name("x                         y", "p"), "x");
    }

    #[test]
    fn codes() {
        assert_eq!(ALPHABET.len(), 32);
        for x in [0u64, 1, u64::MAX, 0xdead_beef, rand64(), rand64()] {
            let c = room_code(x);
            assert_eq!(c.len(), 6);
            assert!(c.bytes().all(|b| ALPHABET.contains(&b)), "{c}");
            assert!(!c.contains('O') && !c.contains('0') && !c.contains('I') && !c.contains('1'));
        }
        assert_eq!(room_code(0), "AAAAAA");
        assert_ne!(room_code(1), room_code(32));
        let set: std::collections::HashSet<String> = (0..2000).map(|_| room_code(rand64())).collect();
        assert!(set.len() > 1990);
    }

    #[test]
    fn info_limits() {
        assert!(clean_info(Some(&json!({ "public": true }))).is_some());
        assert!(clean_info(Some(&json!([1, 2]))).is_none());
        assert!(clean_info(Some(&json!("x"))).is_none());
        assert!(clean_info(None).is_none());
        assert!(clean_info(Some(&json!({ "a": "x".repeat(600) }))).is_none());
    }

    #[test]
    fn bucket() {
        let mut b = Bucket::new(10.0, 1000.0, 100, 0.0);
        for _ in 0..10 { assert!(b.take(0.0, 10)); }
        assert!(!b.take(0.0, 10), "out of messages");
        assert!(b.take(0.1, 10), "one message back after 0.1 s");
        assert!(!b.take(0.1, 10));
        let mut b = Bucket::new(1000.0, 1000.0, 100, 0.0);
        assert!(b.take(0.0, 900));
        assert!(!b.take(0.0, 200), "out of bytes");
        assert!(b.take(0.2, 200));
        // never holds more than one second's worth, and time going backwards changes nothing
        let mut b = Bucket::new(5.0, 1e6, 0, 0.0);
        assert!(!(0..6).all(|_| b.take(100.0, 1)));
        assert!(!b.take(50.0, 1));
        // a big frame always fits a full bucket
        let mut b = Bucket::new(5.0, 100.0, 65536, 0.0);
        assert!(b.take(0.0, 65536));
    }

    #[test]
    fn frames() {
        let key = [1, 2, 3, 4];
        let f = client_frame(true, 1, b"hello", key);
        let (fr, used) = parse_frame(&f, 100).unwrap().unwrap();
        assert_eq!((fr.fin, fr.op, fr.data.as_slice(), used), (true, 1, &b"hello"[..], f.len()));
        // every prefix is incomplete, never an error
        for i in 0..f.len() { assert!(parse_frame(&f[..i], 100).unwrap().is_none()); }
        // two frames back to back
        let mut two = f.clone();
        two.extend(client_frame(false, 2, &[9, 8, 7], [0xff; 4]));
        let (_, u1) = parse_frame(&two, 100).unwrap().unwrap();
        let (fr2, _) = parse_frame(&two[u1..], 100).unwrap().unwrap();
        assert_eq!((fr2.fin, fr2.op, fr2.data), (false, 2, vec![9, 8, 7]));
        // 16-bit and 64-bit lengths
        let mid: Vec<u8> = (0..300u32).map(|i| i as u8).collect();
        let f = client_frame(true, 2, &mid, [9, 9, 9, 9]);
        assert_eq!(f[1], 0x80 | 126);
        assert_eq!(parse_frame(&f, 1000).unwrap().unwrap().0.data, mid);
        for i in 0..f.len() { assert!(parse_frame(&f[..i], 1000).unwrap().is_none()); }
        let big = vec![7u8; 70000];
        let f = client_frame(true, 2, &big, [5, 6, 7, 8]);
        assert_eq!(f[1], 0x80 | 127);
        assert_eq!(parse_frame(&f, 80000).unwrap().unwrap().0.data, big);
        assert!(parse_frame(&f[..20], 80000).unwrap().is_none());
        // oversize is refused from the header alone
        assert_eq!(parse_frame(&f[..14], 65536).unwrap_err(), FrameErr::TooBig);
        assert_eq!(parse_frame(&client_frame(true, 1, &mid, key)[..4], 200).unwrap_err(), FrameErr::TooBig);
        let mut huge = vec![0x82, 0xff];
        huge.extend_from_slice(&u64::MAX.to_be_bytes());
        assert_eq!(parse_frame(&huge, 65536).unwrap_err(), FrameErr::TooBig);
        // unmasked, reserved bits, bad control frames
        assert_eq!(parse_frame(&[0x81, 0x05, b'h'], 100).unwrap_err(), FrameErr::Protocol);
        assert_eq!(parse_frame(&[0xC1, 0x80], 100).unwrap_err(), FrameErr::Protocol);
        assert_eq!(parse_frame(&client_frame(false, 9, b"", key), 100).unwrap_err(), FrameErr::Protocol);
        assert_eq!(parse_frame(&client_frame(true, 9, &[0; 126], key), 1000).unwrap_err(), FrameErr::Protocol);
        let (p, _) = parse_frame(&client_frame(true, 9, b"hi", key), 100).unwrap().unwrap();
        assert_eq!((p.op, p.data.as_slice()), (9, &b"hi"[..]));
        // junk never panics
        let mut x = 12345u64;
        for _ in 0..20000 {
            let n = (x % 24) as usize;
            let bytes: Vec<u8> = (0..n).map(|_| { x = x.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407); (x >> 33) as u8 }).collect();
            let _ = parse_frame(&bytes, 64);
        }
    }

    #[test]
    fn encode() {
        assert_eq!(encode_frame(1, &[b"hi"]), vec![0x81, 2, b'h', b'i']);
        let f = encode_frame(2, &[&[0, 1], &[7; 200]]);
        assert_eq!(&f[..4], &[0x82, 126, 0, 202]);
        assert_eq!(f.len(), 4 + 202);
        let f = encode_frame(2, &[&vec![1; 70000]]);
        assert_eq!(f[1], 127);
        assert_eq!(u64::from_be_bytes(f[2..10].try_into().unwrap()), 70000);
    }
}
