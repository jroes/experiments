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
}

fn env_num<T: std::str::FromStr>(name: &str, default: T) -> T {
    std::env::var(name).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
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
}

fn size(k: &str, e: &Entry) -> usize {
    k.len() + e.raw.len()
}

impl Store {
    pub fn open(dir: PathBuf, lim: Limits) -> Store {
        let mut s = Store { dir, ns: HashMap::new(), total: 0, seq: 0, lim, ips: HashMap::new() };
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
            if !m.is_empty() { s.ns.insert(ns.to_string(), m); }
        }
        s
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

    pub fn handle(&mut self, r: &Req, now: u64) -> Reply {
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
        match (r.method, key) {
            ("GET", None) => self.list(ns, r.query),
            ("GET", Some(k)) => match self.ns.get(ns).and_then(|m| m.get(k)) {
                Some(e) => ok(format!(r#"{{"value":{},"rev":{},"t":{}}}"#, e.raw, e.rev, e.t)),
                None => err(404, "not_found", "no such key"),
            },
            ("PUT", Some(k)) => self.put(ns, k, r, now),
            ("DELETE", Some(k)) => self.delete(ns, k),
            _ => err(405, "method_not_allowed", "PUT and DELETE need a key"),
        }
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
        Limits { value_max: 100, ns_keys: 3, ns_bytes: 200, total_bytes: 400, ns_count: 3, ip_req_per_min: 1000, ip_write_per_min: 1000, ip_new_ns_per_hour: 100 }
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
        let mut s = Store::open(d.clone(), lim());
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
        let mut s = Store::open(d.clone(), lim());
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
}
