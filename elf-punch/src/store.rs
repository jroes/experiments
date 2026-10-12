//! Generic key/value storage for the other experiments: `/kv/<namespace>/<key>` holds one JSON value.
//!
//! No accounts and no secrets: anyone who knows a namespace can read and write it, so keep nothing private here.
//! Every cap has a default and an environment variable (see `Limits`). Each namespace is one file in `KV_DIR`
//! (default `/data/kv`, the Fly volume), rewritten with tmp + rename on every write, so a crash never leaves half a file.
use std::collections::{BTreeMap, HashMap};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

pub struct Limits {
    pub value_max: usize,
    pub ns_keys: usize,
    pub ns_bytes: usize,
    pub total_bytes: usize,
    pub ns_count: usize,
    pub ip_req_per_min: u32,
    pub ip_write_per_min: u32,
    pub ip_new_ns_per_hour: u32,
    /// requests / writes per namespace per minute, from everyone together (a flood on one game never reaches the others)
    pub ns_req_per_min: u32,
    pub ns_write_per_min: u32,
    /// new namespaces per day, all addresses together: protects the volume from someone minting namespaces
    pub new_ns_per_day: u32,
    /// `GET /kv/<ns>` and `?prefix=` listing. Off by default: a namespace name is the only secret, and listing keys would leak
    /// what is inside it. Reads by exact name (`/kv/<ns>/<key>` and `?keys=a,b`) always work.
    pub allow_list: bool,
    /// Namespaces whose name starts with a prefix are deleted after that many days without a write: `(prefix, days)`.
    /// Anything that matches no prefix is kept forever. Default `sdo-:60`, which is the online games in Sector Dominion: a game
    /// that has been quiet for two months is gone, and an active one never expires.
    pub expire: Vec<(String, u64)>,
}

/// most keys one `?keys=` read may ask for
pub const MULTI_GET_MAX: usize = 60;

fn env_num<T: std::str::FromStr>(name: &str, default: T) -> T {
    std::env::var(name).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}

fn parse_expire(spec: &str) -> Vec<(String, u64)> {
    spec.split(',').filter_map(|part| {
        let (prefix, days) = part.trim().rsplit_once(':')?;
        let days = days.trim().parse::<u64>().ok().filter(|d| *d > 0)?;
        (valid_ns(prefix)).then(|| (prefix.to_string(), days))
    }).collect()
}

fn env_bool(name: &str) -> bool {
    matches!(std::env::var(name).ok().as_deref(), Some("1" | "true" | "yes"))
}

impl Limits {
    pub fn from_env() -> Limits {
        Limits {
            value_max: env_num("KV_VALUE_MAX", 65_536),
            ns_keys: env_num("KV_NS_KEYS", 2_000),
            ns_bytes: env_num("KV_NS_BYTES", 4_000_000),
            total_bytes: env_num("KV_TOTAL_BYTES", 24_000_000),
            ns_count: env_num("KV_NS_COUNT", 200),
            ip_req_per_min: env_num("KV_IP_REQ_PER_MIN", 300),
            ip_write_per_min: env_num("KV_IP_WRITE_PER_MIN", 60),
            ip_new_ns_per_hour: env_num("KV_IP_NEW_NS_PER_HOUR", 10),
            ns_req_per_min: env_num("KV_NS_REQ_PER_MIN", 240),
            ns_write_per_min: env_num("KV_NS_WRITE_PER_MIN", 90),
            new_ns_per_day: env_num("KV_NEW_NS_PER_DAY", 100),
            allow_list: env_bool("KV_ALLOW_LIST"),
            expire: parse_expire(&std::env::var("KV_EXPIRE").unwrap_or_else(|_| "sdo-:60".into())),
        }
    }
}

#[derive(Clone)]
struct Entry {
    raw: String,
    rev: u64,
    t: u64,
}

#[derive(Default)]
struct IpState {
    min_start: u64,
    reqs: u32,
    writes: u32,
    hour_start: u64,
    new_ns: u32,
}

#[derive(Default)]
struct NsRate {
    min_start: u64,
    reqs: u32,
    writes: u32,
}

pub struct Req<'a> {
    pub method: &'a str,
    pub path: &'a str,
    pub query: &'a str,
    pub body: &'a [u8],
    pub if_match: Option<&'a str>,
    pub if_none_match: Option<&'a str>,
    pub ip: &'a str,
}

pub struct Reply {
    pub status: u16,
    pub body: String,
    pub retry_after: Option<u64>,
}

fn json_str(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| "\"\"".into())
}

fn ok(body: String) -> Reply {
    Reply { status: 200, body, retry_after: None }
}

fn err(status: u16, code: &str, msg: &str) -> Reply {
    Reply { status, body: format!(r#"{{"error":{},"code":{}}}"#, json_str(msg), json_str(code)), retry_after: None }
}

fn limited(wait: u64, what: &str) -> Reply {
    let wait = wait.max(1);
    let mut r = err(429, "rate_limited", &format!("{what}; try again in {wait} seconds"));
    r.retry_after = Some(wait);
    r
}

fn valid_ns(s: &str) -> bool {
    !s.is_empty() && s.len() <= 40 && s.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_' || c == b'-')
}

fn valid_key(s: &str) -> bool {
    !s.is_empty() && s.len() <= 100 && s.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-' | b'.' | b':'))
}

pub struct Store {
    dir: PathBuf,
    ns: HashMap<String, BTreeMap<String, Entry>>,
    total: usize,
    seq: u64,
    lim: Limits,
    ips: HashMap<String, IpState>,
    nss: HashMap<String, NsRate>,
    day: u64,
    day_new_ns: u32,
    last_sweep: u64,
}

fn size(k: &str, e: &Entry) -> usize {
    k.len() + e.raw.len()
}

impl Store {
    pub fn open(dir: PathBuf, lim: Limits) -> Store {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        Store::open_at(dir, lim, now)
    }

    /// `now` is only used to rebuild today's count of new namespaces from the saved data, so the daily cap survives a restart
    /// (Fly stops an idle machine, and an in-memory counter would reset every time).
    pub fn open_at(dir: PathBuf, lim: Limits, now: u64) -> Store {
        let mut s = Store { dir, ns: HashMap::new(), total: 0, seq: 0, lim, ips: HashMap::new(), nss: HashMap::new(), day: now / 86_400, day_new_ns: 0, last_sweep: now };
        let _ = std::fs::create_dir_all(&s.dir);
        let Ok(rd) = std::fs::read_dir(&s.dir) else { return s };
        for f in rd.flatten() {
            let name = f.file_name().to_string_lossy().into_owned();
            let Some(ns) = name.strip_suffix(".json") else { continue };
            if !valid_ns(ns) { continue; }
            let Ok(text) = std::fs::read_to_string(f.path()) else { continue };
            let Ok(doc) = serde_json::from_str::<serde_json::Value>(&text) else { continue };
            let Some(obj) = doc.as_object() else { continue };
            let mut m = BTreeMap::new();
            for (k, v) in obj {
                let (Some(raw), Some(rev), Some(t)) = (v["raw"].as_str(), v["rev"].as_u64(), v["t"].as_u64()) else { continue };
                let e = Entry { raw: raw.to_string(), rev, t };
                s.total += size(k, &e);
                s.seq = s.seq.max(rev);
                m.insert(k.clone(), e);
            }
            if m.values().map(|e| e.t).min().is_some_and(|first| first / 86_400 == now / 86_400) { s.day_new_ns += 1; }
            if !m.is_empty() { s.ns.insert(ns.to_string(), m); }
        }
        s.sweep(now);
        s
    }

    /// Deletes namespaces that have outlived their prefix's expiry. Runs at start and then at most once an hour.
    fn sweep(&mut self, now: u64) {
        self.last_sweep = now;
        let dead: Vec<String> = self.ns.iter().filter_map(|(name, m)| {
            let days = self.lim.expire.iter().find(|(p, _)| name.starts_with(p.as_str()))?.1;
            let newest = m.values().map(|e| e.t).max()?;
            (now.saturating_sub(newest) > days.saturating_mul(86_400)).then(|| name.clone())
        }).collect();
        for name in dead {
            if let Some(m) = self.ns.remove(&name) {
                self.total -= m.iter().map(|(k, e)| size(k, e)).sum::<usize>();
                let _ = self.persist(&name, &BTreeMap::new());
            }
        }
    }

    fn persist(&self, ns: &str, m: &BTreeMap<String, Entry>) -> bool {
        let path = self.dir.join(format!("{ns}.json"));
        if m.is_empty() { return std::fs::remove_file(&path).is_ok() || !path.exists(); }
        let mut doc = serde_json::Map::new();
        for (k, e) in m {
            doc.insert(k.clone(), serde_json::json!({"raw": e.raw, "rev": e.rev, "t": e.t}));
        }
        let tmp = self.dir.join(format!("{ns}.json.tmp"));
        std::fs::write(&tmp, serde_json::Value::Object(doc).to_string()).is_ok() && std::fs::rename(&tmp, &path).is_ok()
    }

    fn rate(&mut self, ip: &str, now: u64, write: bool) -> Option<Reply> {
        if self.ips.len() > 5_000 {
            self.ips.retain(|_, s| now.saturating_sub(s.hour_start) < 3_600);
        }
        let (rq, wr) = (self.lim.ip_req_per_min, self.lim.ip_write_per_min);
        let st = self.ips.entry(ip.to_string()).or_default();
        if now.saturating_sub(st.min_start) >= 60 { st.min_start = now; st.reqs = 0; st.writes = 0; }
        if st.hour_start == 0 || now.saturating_sub(st.hour_start) >= 3_600 { st.hour_start = now; st.new_ns = 0; }
        let wait = 60 - now.saturating_sub(st.min_start).min(59);
        st.reqs += 1;
        if st.reqs > rq { return Some(limited(wait, "too many requests")); }
        if write {
            st.writes += 1;
            if st.writes > wr { return Some(limited(wait, "too many writes")); }
        }
        None
    }

    /// Per-namespace rate limit, counted for everyone together. Exact, in memory, and checked before any data is touched.
    fn rate_ns(&mut self, ns: &str, now: u64, write: bool) -> Option<Reply> {
        if self.nss.len() > 5_000 {
            self.nss.retain(|_, s| now.saturating_sub(s.min_start) < 60);
            if self.nss.len() > 50_000 { self.nss.clear(); } // under a huge flood of made-up names, forget instead of growing
        }
        let (rq, wr) = (self.lim.ns_req_per_min, self.lim.ns_write_per_min);
        let st = self.nss.entry(ns.to_string()).or_default();
        if now.saturating_sub(st.min_start) >= 60 { st.min_start = now; st.reqs = 0; st.writes = 0; }
        let wait = 60 - now.saturating_sub(st.min_start).min(59);
        st.reqs += 1;
        if st.reqs > rq { return Some(limited(wait, "too many requests for this namespace")); }
        if write {
            st.writes += 1;
            if st.writes > wr { return Some(limited(wait, "too many writes to this namespace")); }
        }
        None
    }

    pub fn handle(&mut self, r: &Req, now: u64) -> Reply {
        if now.saturating_sub(self.last_sweep) >= 3_600 { self.sweep(now); }
        let Some(rest) = r.path.strip_prefix("/kv/") else { return err(404, "not_found", "not found") };
        let rest = rest.trim_end_matches('/');
        let (ns, key) = match rest.split_once('/') { Some((n, k)) => (n, Some(k)), None => (rest, None) };
        if !valid_ns(ns) { return err(400, "bad_namespace", "namespace is 1-40 chars of a-z 0-9 _ -"); }
        if let Some(k) = key {
            if !valid_key(k) { return err(400, "bad_key", "key is 1-100 chars of A-Z a-z 0-9 _ - . :"); }
        }
        let write = matches!(r.method, "PUT" | "DELETE");
        if !write && r.method != "GET" { return err(405, "method_not_allowed", "use GET, PUT or DELETE"); }
        if let Some(rl) = self.rate(r.ip, now, write) { return rl; }
        if let Some(rl) = self.rate_ns(ns, now, write) { return rl; }
        match (r.method, key) {
            ("GET", None) => {
                if let Some(keys) = r.query.split('&').find_map(|p| p.strip_prefix("keys=")) { self.multi_get(ns, keys, now) }
                else if self.lim.allow_list { self.list(ns, r.query) }
                else { err(404, "no_listing", "listing is turned off; read keys by name: /kv/<ns>/<key> or /kv/<ns>?keys=a,b") }
            }
            ("GET", Some(k)) => match self.ns.get(ns).and_then(|m| m.get(k)) {
                Some(e) => ok(format!(r#"{{"value":{},"rev":{},"t":{}}}"#, e.raw, e.rev, e.t)),
                None => err(404, "not_found", "no such key"),
            },
            ("PUT", Some(k)) => self.put(ns, k, r, now),
            ("DELETE", Some(k)) => self.delete(ns, k),
            _ => err(405, "method_not_allowed", "PUT and DELETE need a key"),
        }
    }

    /// `GET /kv/<ns>?keys=a,b,c`: several keys by exact name in one request. Missing keys are left out. This is not a way to
    /// discover keys: you have to already know their names.
    /// The reply also carries `now`, the server's clock, so a client can tell how long ago a key was written (`t`) without
    /// trusting its own clock: the games use it to show who is online.
    fn multi_get(&self, ns: &str, keys: &str, now: u64) -> Reply {
        let names: Vec<&str> = keys.split(',').collect();
        if names.len() > MULTI_GET_MAX {
            return err(400, "too_many_keys", &format!("ask for at most {MULTI_GET_MAX} keys at a time"));
        }
        if let Some(bad) = names.iter().find(|k| !valid_key(k)) {
            return err(400, "bad_key", &format!("key {} is not 1-100 chars of A-Z a-z 0-9 _ - . :", json_str(bad)));
        }
        let m = self.ns.get(ns);
        let mut out = format!(r#"{{"now":{now},"values":{{"#);
        let mut n = 0;
        let mut seen = std::collections::HashSet::new();
        for k in names {
            if !seen.insert(k) { continue; }
            let Some(e) = m.and_then(|m| m.get(k)) else { continue };
            if n > 0 { out.push(','); }
            out.push_str(&format!(r#"{}:{{"value":{},"rev":{},"t":{}}}"#, json_str(k), e.raw, e.rev, e.t));
            n += 1;
        }
        out.push_str("}}");
        ok(out)
    }

    fn list(&self, ns: &str, query: &str) -> Reply {
        let prefix = query.split('&').find_map(|p| p.strip_prefix("prefix=")).unwrap_or("");
        let mut out = String::from(r#"{"keys":["#);
        let mut n = 0;
        if let Some(m) = self.ns.get(ns) {
            for (k, e) in m.range(prefix.to_string()..) {
                if !k.starts_with(prefix) || n >= 1_000 { break; }
                if n > 0 { out.push(','); }
                out.push_str(&format!(r#"{{"key":{},"rev":{},"bytes":{},"t":{}}}"#, json_str(k), e.rev, e.raw.len(), e.t));
                n += 1;
            }
        }
        out.push_str("]}");
        ok(out)
    }

    fn put(&mut self, ns: &str, key: &str, r: &Req, now: u64) -> Reply {
        if r.body.len() > self.lim.value_max {
            return err(413, "too_large", &format!("value is over {} bytes", self.lim.value_max));
        }
        let Ok(v) = serde_json::from_slice::<serde_json::Value>(r.body) else {
            return err(400, "bad_json", "body must be one JSON value");
        };
        let raw = v.to_string();
        let cur = self.ns.get(ns).and_then(|m| m.get(key));
        if let Some(im) = r.if_match {
            let want = im.trim().trim_matches('"');
            if cur.map(|e| e.rev.to_string()).as_deref() != Some(want) {
                return err(412, "rev_mismatch", "If-Match does not match the current rev");
            }
        }
        if r.if_none_match.map(|s| s.trim()) == Some("*") && cur.is_some() {
            return err(412, "exists", "key already exists");
        }
        let old_size = cur.map_or(0, |e| size(key, e));
        let new_size = key.len() + raw.len();
        let is_new_ns = !self.ns.contains_key(ns);
        let ns_bytes: usize = self.ns.get(ns).map_or(0, |m| m.iter().map(|(k, e)| size(k, e)).sum());
        let ns_keys = self.ns.get(ns).map_or(0, |m| m.len());
        if is_new_ns {
            if self.ns.len() >= self.lim.ns_count { return err(507, "store_full", "too many namespaces on this server"); }
            let cap = self.lim.ip_new_ns_per_hour;
            let st = self.ips.entry(r.ip.to_string()).or_default();
            if st.new_ns >= cap { return limited(3_600 - now.saturating_sub(st.hour_start).min(3_599), "too many new namespaces"); }
            if now / 86_400 != self.day { self.day = now / 86_400; self.day_new_ns = 0; }
            if self.day_new_ns >= self.lim.new_ns_per_day { return limited(86_400 - now % 86_400, "too many new namespaces today"); }
        }
        if cur.is_none() && ns_keys >= self.lim.ns_keys { return err(413, "namespace_full", "namespace has too many keys"); }
        if ns_bytes - old_size + new_size > self.lim.ns_bytes { return err(413, "namespace_full", "namespace is over its byte quota"); }
        if self.total - old_size + new_size > self.lim.total_bytes { return err(507, "store_full", "server storage is full"); }
        self.seq += 1;
        let (created, rev) = (cur.is_none(), self.seq);
        let mut next = self.ns.get(ns).cloned().unwrap_or_default();
        next.insert(key.to_string(), Entry { raw, rev, t: now });
        if !self.persist(ns, &next) { return err(500, "write_failed", "could not save"); }
        self.total = self.total - old_size + new_size;
        self.ns.insert(ns.to_string(), next);
        if is_new_ns {
            if let Some(st) = self.ips.get_mut(r.ip) { st.new_ns += 1; }
            self.day_new_ns += 1;
        }
        let mut rep = ok(format!(r#"{{"rev":{rev},"created":{created}}}"#));
        if created { rep.status = 201; }
        rep
    }

    fn delete(&mut self, ns: &str, key: &str) -> Reply {
        let Some(m) = self.ns.get(ns) else { return ok(r#"{"deleted":false}"#.into()) };
        let Some(old) = m.get(key) else { return ok(r#"{"deleted":false}"#.into()) };
        let old_size = size(key, old);
        let mut next = m.clone();
        next.remove(key);
        if !self.persist(ns, &next) { return err(500, "write_failed", "could not save"); }
        self.total -= old_size;
        if next.is_empty() { self.ns.remove(ns); } else { self.ns.insert(ns.to_string(), next); }
        ok(r#"{"deleted":true}"#.into())
    }
}

static STORE: OnceLock<Mutex<Store>> = OnceLock::new();

pub fn init() {
    let dir = PathBuf::from(std::env::var("KV_DIR").unwrap_or_else(|_| "/data/kv".into()));
    let _ = STORE.set(Mutex::new(Store::open(dir, Limits::from_env())));
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK", 201 => "Created", 204 => "No Content", 400 => "Bad Request", 404 => "Not Found", 405 => "Method Not Allowed",
        411 => "Length Required", 412 => "Precondition Failed", 413 => "Payload Too Large", 429 => "Too Many Requests",
        431 => "Request Header Fields Too Large", 500 => "Internal Server Error", 501 => "Not Implemented", 507 => "Insufficient Storage",
        _ => "OK",
    }
}

fn respond(s: &mut TcpStream, rep: &Reply) {
    let retry = rep.retry_after.map(|n| format!("Retry-After: {n}\r\n")).unwrap_or_default();
    let ctype = if rep.status == 204 { "" } else { "Content-Type: application/json\r\n" };
    let head = format!(
        "HTTP/1.1 {} {}\r\n{ctype}Content-Length: {}\r\n{retry}Cache-Control: no-store\r\n\
         Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, PUT, DELETE, OPTIONS\r\n\
         Access-Control-Allow-Headers: Content-Type, If-Match, If-None-Match\r\nAccess-Control-Expose-Headers: Retry-After\r\n\
         Access-Control-Max-Age: 86400\r\nConnection: close\r\n\r\n",
        rep.status, reason(rep.status), rep.body.len()
    );
    let _ = s.write_all(head.as_bytes());
    let _ = s.write_all(rep.body.as_bytes());
}

fn quick(status: u16, code: &str, msg: &str) -> Reply {
    err(status, code, msg)
}

/// Serve one `/kv/...` HTTP request on `s` (the connection thread already peeked at the request line).
pub fn serve(mut s: TcpStream) {
    let Some(store) = STORE.get() else { return };
    let value_max = store.lock().unwrap().lim.value_max;
    let peer = s.peer_addr().map(|a| a.ip().to_string()).unwrap_or_default();
    let mut buf: Vec<u8> = Vec::with_capacity(2048);
    let mut chunk = [0u8; 4096];
    let head_end = loop {
        if let Some(p) = buf.windows(4).position(|w| w == b"\r\n\r\n") { break p + 4; }
        if buf.len() > 8192 { return respond(&mut s, &quick(431, "headers_too_large", "headers too large")); }
        match s.read(&mut chunk) {
            Ok(0) | Err(_) => return,
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
        }
    };
    let head = String::from_utf8_lossy(&buf[..head_end]).into_owned();
    let mut lines = head.split("\r\n");
    let mut first = lines.next().unwrap_or("").split_whitespace();
    let (method, target) = (first.next().unwrap_or(""), first.next().unwrap_or(""));
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    let (mut clen, mut if_match, mut if_none_match, mut fly_ip, mut chunked) = (0usize, None, None, None, false);
    for l in lines {
        let Some((n, v)) = l.split_once(':') else { continue };
        let v = v.trim();
        match n.trim().to_ascii_lowercase().as_str() {
            "content-length" => clen = v.parse().unwrap_or(usize::MAX),
            "if-match" => if_match = Some(v.to_string()),
            "if-none-match" => if_none_match = Some(v.to_string()),
            "fly-client-ip" => fly_ip = Some(v.to_string()),
            "transfer-encoding" => chunked = true,
            _ => {}
        }
    }
    if method == "OPTIONS" {
        return respond(&mut s, &Reply { status: 204, body: String::new(), retry_after: None });
    }
    if chunked { return respond(&mut s, &quick(411, "length_required", "send Content-Length, not chunked encoding")); }
    if clen > value_max { return respond(&mut s, &quick(413, "too_large", &format!("value is over {value_max} bytes"))); }
    let mut body = buf[head_end..].to_vec();
    while body.len() < clen {
        match s.read(&mut chunk) {
            Ok(0) | Err(_) => return,
            Ok(n) => body.extend_from_slice(&chunk[..n]),
        }
    }
    body.truncate(clen);
    let ip = fly_ip.unwrap_or(peer);
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let req = Req { method, path, query, body: &body, if_match: if_match.as_deref(), if_none_match: if_none_match.as_deref(), ip: &ip };
    let rep = store.lock().unwrap().handle(&req, now);
    respond(&mut s, &rep);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("elf-kv-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }
    fn lim() -> Limits {
        Limits {
            value_max: 100, ns_keys: 3, ns_bytes: 200, total_bytes: 400, ns_count: 3, ip_req_per_min: 1000, ip_write_per_min: 1000,
            ip_new_ns_per_hour: 100, ns_req_per_min: 100_000, ns_write_per_min: 100_000, new_ns_per_day: 100_000, allow_list: false,
            expire: vec![],
        }
    }
    fn call(s: &mut Store, method: &str, path: &str, body: &str, now: u64) -> (u16, String) {
        call_h(s, method, path, body, None, None, "1.1.1.1", now)
    }
    #[allow(clippy::too_many_arguments)]
    fn call_h(s: &mut Store, method: &str, path: &str, body: &str, im: Option<&str>, inm: Option<&str>, ip: &str, now: u64) -> (u16, String) {
        let (p, q) = path.split_once('?').unwrap_or((path, ""));
        let r = s.handle(&Req { method, path: p, query: q, body: body.as_bytes(), if_match: im, if_none_match: inm, ip }, now);
        (r.status, r.body)
    }

    #[test]
    fn roundtrip_list_delete_and_reload() {
        let d = tmp("rt");
        let mut s = Store::open(d.clone(), Limits { allow_list: true, ..lim() });
        assert_eq!(call(&mut s, "GET", "/kv/game/a", "", 1).0, 404);
        assert_eq!(call(&mut s, "PUT", "/kv/game/a", r#"{"hi": [1, 2]}"#, 5).0, 201);
        let (st, body) = call(&mut s, "GET", "/kv/game/a", "", 6);
        assert_eq!(st, 200);
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(v["value"]["hi"][1], 2);
        assert_eq!(v["t"], 5);
        assert_eq!(call(&mut s, "PUT", "/kv/game/b", "true", 7).0, 201);
        assert_eq!(call(&mut s, "PUT", "/kv/game/a", "1", 8).0, 200);
        let (_, l) = call(&mut s, "GET", "/kv/game?prefix=a", "", 9);
        assert_eq!(serde_json::from_str::<serde_json::Value>(&l).unwrap()["keys"].as_array().unwrap().len(), 1);
        drop(s);
        let mut s = Store::open(d.clone(), Limits { allow_list: true, ..lim() });
        assert_eq!(serde_json::from_str::<serde_json::Value>(&call(&mut s, "GET", "/kv/game/a", "", 10).1).unwrap()["value"], 1);
        let (_, r) = call(&mut s, "PUT", "/kv/game/c", "2", 11);
        let rev = serde_json::from_str::<serde_json::Value>(&r).unwrap()["rev"].as_u64().unwrap();
        assert!(rev > 3, "revs keep increasing after a restart, got {rev}");
        assert_eq!(call(&mut s, "DELETE", "/kv/game/a", "", 12).1, r#"{"deleted":true}"#);
        assert_eq!(call(&mut s, "DELETE", "/kv/game/a", "", 12).1, r#"{"deleted":false}"#);
        assert_eq!(call(&mut s, "GET", "/kv/game/a", "", 13).0, 404);
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn preconditions() {
        let d = tmp("cas");
        let mut s = Store::open(d.clone(), lim());
        assert_eq!(call_h(&mut s, "PUT", "/kv/n/k", "1", None, Some("*"), "i", 1).0, 201);
        assert_eq!(call_h(&mut s, "PUT", "/kv/n/k", "2", None, Some("*"), "i", 1).0, 412);
        let (_, r) = call(&mut s, "GET", "/kv/n/k", "", 1);
        let rev = serde_json::from_str::<serde_json::Value>(&r).unwrap()["rev"].as_u64().unwrap().to_string();
        assert_eq!(call_h(&mut s, "PUT", "/kv/n/k", "3", Some("999"), None, "i", 1).0, 412);
        assert_eq!(call_h(&mut s, "PUT", "/kv/n/k", "3", Some(&format!("\"{rev}\"")), None, "i", 1).0, 200);
        assert_eq!(call_h(&mut s, "PUT", "/kv/n/missing", "3", Some("1"), None, "i", 1).0, 412);
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn validation_and_limits() {
        let d = tmp("lim");
        let mut s = Store::open(d.clone(), lim());
        assert_eq!(call(&mut s, "PUT", "/kv/Bad/k", "1", 1).0, 400);
        assert_eq!(call(&mut s, "PUT", "/kv/ok/a%20b", "1", 1).0, 400);
        assert_eq!(call(&mut s, "PUT", "/kv/ok/k", "{nope", 1).0, 400);
        assert_eq!(call(&mut s, "PUT", "/kv/ok/k", &format!("\"{}\"", "x".repeat(120)), 1).0, 413);
        assert_eq!(call(&mut s, "POST", "/kv/ok/k", "1", 1).0, 405);
        assert_eq!(call(&mut s, "GET", "/other", "", 1).0, 404);
        for k in ["a", "b", "c"] { assert_eq!(call(&mut s, "PUT", &format!("/kv/ok/{k}"), "1", 1).0, 201); }
        assert_eq!(call(&mut s, "PUT", "/kv/ok/d", "1", 1).0, 413, "key cap");
        assert_eq!(call(&mut s, "PUT", "/kv/ok/a", "2", 1).0, 200, "overwrite is fine at the cap");
        let big = format!("\"{}\"", "y".repeat(90));
        assert_eq!(call(&mut s, "PUT", "/kv/two/a", &big, 1).0, 201);
        assert_eq!(call(&mut s, "PUT", "/kv/two/b", &big, 1).0, 201);
        assert_eq!(call(&mut s, "PUT", "/kv/two/c", &big, 1).0, 413, "namespace byte quota");
        assert_eq!(call(&mut s, "PUT", "/kv/three/a", &big, 1).0, 201);
        assert_eq!(call(&mut s, "PUT", "/kv/four/a", "1", 1).0, 507, "namespace count");
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn rate_limits_are_per_address_and_expire() {
        let d = tmp("rate");
        let l = Limits { ip_req_per_min: 5, ip_write_per_min: 2, ip_new_ns_per_hour: 2, ..lim() };
        let mut s = Store::open(d.clone(), l);
        assert_eq!(call_h(&mut s, "PUT", "/kv/a/k", "1", None, None, "A", 100).0, 201);
        assert_eq!(call_h(&mut s, "PUT", "/kv/a/k2", "1", None, None, "A", 100).0, 201);
        let r = s.handle(&Req { method: "PUT", path: "/kv/a/k3", query: "", body: b"1", if_match: None, if_none_match: None, ip: "A" }, 101);
        assert_eq!(r.status, 429);
        assert!(r.retry_after.unwrap() >= 1);
        assert_eq!(call_h(&mut s, "PUT", "/kv/a/k3", "1", None, None, "B", 101).0, 201, "another address is unaffected");
        assert_eq!(call_h(&mut s, "PUT", "/kv/a/k3", "1", None, None, "A", 161).0, 200, "window passed");
        let mut s2 = Store::open(tmp("rate2"), Limits { ip_new_ns_per_hour: 2, ..lim() });
        assert_eq!(call_h(&mut s2, "PUT", "/kv/n1/k", "1", None, None, "A", 1).0, 201);
        assert_eq!(call_h(&mut s2, "PUT", "/kv/n2/k", "1", None, None, "A", 1).0, 201);
        assert_eq!(call_h(&mut s2, "PUT", "/kv/n3/k", "1", None, None, "A", 1).0, 429, "new namespaces per address");
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn listing_is_off_by_default_and_keys_are_read_by_name() {
        let d = tmp("nolist");
        let mut s = Store::open(d.clone(), lim());
        for (k, v) in [("o-1-1", "10"), ("o-1-2", "20"), ("h:1", "{\"a\":1}")] {
            assert_eq!(call(&mut s, "PUT", &format!("/kv/sdo-secret/{k}"), v, 1).0, 201);
        }
        // no way to see what is in a namespace
        for path in ["/kv/sdo-secret", "/kv/sdo-secret?prefix=o-", "/kv/sdo-secret?prefix=", "/kv/sdo-secret/"] {
            let (st, body) = call(&mut s, "GET", path, "", 2);
            assert_eq!(st, 404, "{path}");
            assert!(body.contains("no_listing"), "{body}");
            assert!(!body.contains("o-1-1"), "listing must not leak key names");
        }
        // reading by exact name works, missing names are simply absent, repeats are collapsed
        let (st, body) = call(&mut s, "GET", "/kv/sdo-secret?keys=o-1-1,nope,h:1,o-1-1", "", 3);
        assert_eq!(st, 200);
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(v["now"], 3, "the reply carries the server clock");
        let values = v["values"].as_object().unwrap();
        assert_eq!(values.len(), 2);
        assert_eq!(values["o-1-1"]["t"], 1, "and each key says when it was written");
        assert_eq!(values["o-1-1"]["value"], 10);
        assert_eq!(values["h:1"]["value"]["a"], 1);
        assert!(values["o-1-1"]["rev"].as_u64().unwrap() > 0);
        // a namespace that does not exist looks the same as one with none of those keys
        let (st, body) = call(&mut s, "GET", "/kv/never-made?keys=a,b", "", 3);
        assert_eq!((st, body.as_str()), (200, r#"{"now":3,"values":{}}"#));
        // junk and over-long asks are refused
        assert_eq!(call(&mut s, "GET", "/kv/sdo-secret?keys=", "", 4).0, 400);
        assert_eq!(call(&mut s, "GET", "/kv/sdo-secret?keys=a,,b", "", 4).0, 400);
        assert_eq!(call(&mut s, "GET", "/kv/sdo-secret?keys=a%20b", "", 4).0, 400);
        let many: Vec<String> = (0..=MULTI_GET_MAX).map(|i| format!("k{i}")).collect();
        assert_eq!(call(&mut s, "GET", &format!("/kv/sdo-secret?keys={}", many.join(",")), "", 4).0, 400);
        let ok_many: Vec<String> = (0..MULTI_GET_MAX).map(|i| format!("k{i}")).collect();
        assert_eq!(call(&mut s, "GET", &format!("/kv/sdo-secret?keys={}", ok_many.join(",")), "", 4).0, 200);
        drop(s);
        // an operator can turn listing back on
        let mut s = Store::open(d.clone(), Limits { allow_list: true, ..lim() });
        let (st, body) = call(&mut s, "GET", "/kv/sdo-secret?prefix=o-", "", 5);
        assert_eq!(st, 200);
        assert_eq!(serde_json::from_str::<serde_json::Value>(&body).unwrap()["keys"].as_array().unwrap().len(), 2);
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn a_namespace_has_its_own_rate_limit_shared_by_everyone() {
        let d = tmp("nsrate");
        let l = Limits { ns_req_per_min: 5, ns_write_per_min: 3, ..lim() };
        let mut s = Store::open(d.clone(), l);
        // five requests from five different addresses all count against the same namespace
        for (i, ip) in ["a", "b", "c", "d", "e"].iter().enumerate() {
            assert_eq!(call_h(&mut s, "GET", "/kv/busy/k", "", None, None, ip, 100 + i as u64).0, 404, "request {i}");
        }
        let r = s.handle(&Req { method: "GET", path: "/kv/busy/k", query: "", body: b"", if_match: None, if_none_match: None, ip: "f" }, 106);
        assert_eq!(r.status, 429);
        assert!(r.body.contains("rate_limited") && r.body.contains("namespace"));
        let wait = r.retry_after.unwrap();
        assert!((1..=60).contains(&wait), "retry-after {wait}");
        // another namespace is untouched
        assert_eq!(call_h(&mut s, "GET", "/kv/quiet/k", "", None, None, "f", 106).0, 404);
        // the window passes
        assert_eq!(call_h(&mut s, "GET", "/kv/busy/k", "", None, None, "f", 161).0, 404);
        // writes have a lower limit of their own, reads are not blocked by it
        let mut s = Store::open(tmp("nsrate2"), Limits { ns_req_per_min: 100, ns_write_per_min: 3, ..lim() });
        for i in 0..3 { assert_eq!(call_h(&mut s, "PUT", &format!("/kv/w/k{i}"), "1", None, None, "x", 10).0, 201); }
        let blocked = s.handle(&Req { method: "PUT", path: "/kv/w/k9", query: "", body: b"1", if_match: None, if_none_match: None, ip: "y" }, 11);
        assert_eq!(blocked.status, 429);
        assert!(blocked.body.contains("writes"));
        assert_eq!(call_h(&mut s, "GET", "/kv/w/k0", "", None, None, "y", 11).0, 200);
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn new_namespaces_per_day_are_capped_for_everyone() {
        let d = tmp("day");
        let mut s = Store::open(d.clone(), Limits { new_ns_per_day: 2, ..lim() });
        let day = 86_400 * 100;
        assert_eq!(call_h(&mut s, "PUT", "/kv/n1/k", "1", None, None, "A", day + 10).0, 201);
        assert_eq!(call_h(&mut s, "PUT", "/kv/n2/k", "1", None, None, "B", day + 20).0, 201);
        let r = s.handle(&Req { method: "PUT", path: "/kv/n3/k", query: "", body: b"1", if_match: None, if_none_match: None, ip: "C" }, day + 30);
        assert_eq!(r.status, 429, "a third address still hits the day cap");
        assert!(r.body.contains("today"));
        // day + 30 is 30 seconds into the day, so almost the whole day is left
        assert_eq!(r.retry_after.unwrap(), 86_400 - 30, "told when the day ends, not in a minute");
        // writing into existing namespaces is not a new namespace
        assert_eq!(call_h(&mut s, "PUT", "/kv/n1/k2", "1", None, None, "C", day + 40).0, 201);
        assert_eq!(call_h(&mut s, "PUT", "/kv/n2/k", "2", None, None, "C", day + 41).0, 200);
        // a refused creation does not use up the allowance
        assert_eq!(call_h(&mut s, "PUT", "/kv/n3/k", "1", None, None, "D", day + 50).0, 429);
        // next day starts fresh
        assert_eq!(call_h(&mut s, "PUT", "/kv/n3/k", "1", None, None, "D", day + 86_400 + 5).0, 201);
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn made_up_namespace_names_do_not_grow_memory_without_bound() {
        let mut s = Store::open(tmp("prune"), lim());
        // many addresses, so the per-address limit does not stop the probing before it gets big
        for i in 0..6_000u64 { call_h(&mut s, "GET", &format!("/kv/probe-{i}/k"), "", None, None, &format!("ip{i}"), 1_000_000); }
        assert!(s.nss.len() > 5_000);
        // a minute later the stale ones are dropped the next time it matters
        call_h(&mut s, "GET", "/kv/probe-fresh/k", "", None, None, "x", 1_000_200);
        assert!(s.nss.len() <= 2, "stale per-namespace counters were not pruned: {}", s.nss.len());
    }

    #[test]
    fn the_daily_namespace_cap_survives_a_restart() {
        let d = tmp("dayrestart");
        let day = 86_400 * 200;
        let l = || Limits { new_ns_per_day: 2, ..lim() };
        let mut s = Store::open_at(d.clone(), l(), day + 100);
        assert_eq!(call_h(&mut s, "PUT", "/kv/a/k", "1", None, None, "x", day + 100).0, 201);
        assert_eq!(call_h(&mut s, "PUT", "/kv/b/k", "1", None, None, "y", day + 200).0, 201);
        drop(s);
        // the machine stopped and started again later the same day: the count must come back from disk
        let mut s = Store::open_at(d.clone(), l(), day + 5_000);
        assert_eq!(call_h(&mut s, "PUT", "/kv/c/k", "1", None, None, "z", day + 5_000).0, 429, "cap forgotten after restart");
        assert_eq!(call_h(&mut s, "PUT", "/kv/a/k2", "1", None, None, "z", day + 5_001).0, 201, "existing namespaces still work");
        drop(s);
        // the next day the old namespaces no longer count
        let mut s = Store::open_at(d.clone(), l(), day + 86_400 + 10);
        assert_eq!(call_h(&mut s, "PUT", "/kv/c/k", "1", None, None, "z", day + 86_400 + 10).0, 201);
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn quiet_game_namespaces_expire_and_everything_else_stays() {
        let d = tmp("expire");
        let day = 86_400u64;
        let t0 = 1_000 * day;
        let l = || Limits { expire: vec![("sdo-".to_string(), 10)], ..lim() };
        let mut s = Store::open_at(d.clone(), l(), t0);
        assert_eq!(call(&mut s, "PUT", "/kv/sdo-old/o-1-1", "1", t0).0, 201);
        assert_eq!(call(&mut s, "PUT", "/kv/sdo-live/o-1-1", "1", t0).0, 201);
        assert_eq!(call(&mut s, "PUT", "/kv/scores/best", "1", t0).0, 201);
        // sdo-live is written again on day 8; sdo-old never is
        assert_eq!(call(&mut s, "PUT", "/kv/sdo-live/o-2-1", "1", t0 + 8 * day).0, 201);
        assert_eq!(call(&mut s, "GET", "/kv/sdo-old/o-1-1", "", t0 + 9 * day).0, 200, "not expired yet");
        // day 11: old is 11 days quiet, live is 3 days quiet
        assert_eq!(call(&mut s, "GET", "/kv/sdo-old/o-1-1", "", t0 + 11 * day).0, 404, "quiet game was kept past its expiry");
        assert_eq!(call(&mut s, "GET", "/kv/sdo-live/o-1-1", "", t0 + 11 * day).0, 200, "an active game must not expire");
        assert_eq!(call(&mut s, "GET", "/kv/scores/best", "", t0 + 11 * day).0, 200);
        assert!(!d.join("sdo-old.json").exists(), "the file is removed too");
        // far in the future everything with a rule is gone, a namespace without a rule is still there
        assert_eq!(call(&mut s, "GET", "/kv/scores/best", "", t0 + 900 * day).0, 200);
        assert_eq!(call(&mut s, "GET", "/kv/sdo-live/o-1-1", "", t0 + 900 * day).0, 404);
        // its space is given back
        drop(s);
        let s = Store::open_at(d.clone(), l(), t0 + 901 * day);
        assert_eq!(s.ns.len(), 1);
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn expiry_also_runs_when_the_server_starts_and_the_spec_is_forgiving() {
        let d = tmp("expire2");
        let t0 = 5_000 * 86_400u64;
        let mut s = Store::open_at(d.clone(), Limits { expire: vec![], ..lim() }, t0);
        assert_eq!(call(&mut s, "PUT", "/kv/sdo-a/k", "1", t0).0, 201);
        assert_eq!(call(&mut s, "PUT", "/kv/other/k", "1", t0).0, 201);
        drop(s);
        let s = Store::open_at(d.clone(), Limits { expire: vec![("sdo-".to_string(), 5)], ..lim() }, t0 + 6 * 86_400);
        assert!(!s.ns.contains_key("sdo-a"), "expired while the machine was stopped");
        assert!(s.ns.contains_key("other"));
        // spec parsing: junk entries are ignored, good ones kept
        assert_eq!(parse_expire("sdo-:60, tmp-:7 ,bad,:5,x:0,UP:3,y:abc"), vec![("sdo-".to_string(), 60), ("tmp-".to_string(), 7)]);
        assert!(parse_expire("").is_empty());
        let _ = std::fs::remove_dir_all(d);
    }
}
