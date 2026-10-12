//! The little bit of HTTP the JSON services share: read one request, send one JSON reply (CORS open, never cached).
use std::io::{Read, Write};
use std::net::TcpStream;

pub struct Reply {
    pub status: u16,
    pub body: String,
    pub retry_after: Option<u64>,
}

pub fn json_str(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| "\"\"".into())
}

pub fn err(status: u16, code: &str, msg: &str) -> Reply {
    Reply { status, body: format!(r#"{{"error":{},"code":{}}}"#, json_str(msg), json_str(code)), retry_after: None }
}

pub fn limited(wait: u64, what: &str) -> Reply {
    let wait = wait.max(1);
    let mut r = err(429, "rate_limited", &format!("{what}; try again in {wait} seconds"));
    r.retry_after = Some(wait);
    r
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK", 201 => "Created", 204 => "No Content", 400 => "Bad Request", 401 => "Unauthorized", 403 => "Forbidden", 404 => "Not Found",
        405 => "Method Not Allowed", 409 => "Conflict", 411 => "Length Required", 412 => "Precondition Failed", 413 => "Payload Too Large",
        429 => "Too Many Requests", 431 => "Request Header Fields Too Large", 500 => "Internal Server Error", 501 => "Not Implemented",
        507 => "Insufficient Storage",
        _ => "OK",
    }
}

pub fn respond(s: &mut TcpStream, rep: &Reply) {
    let retry = rep.retry_after.map(|n| format!("Retry-After: {n}\r\n")).unwrap_or_default();
    let ctype = if rep.status == 204 { "" } else { "Content-Type: application/json\r\n" };
    let head = format!(
        "HTTP/1.1 {} {}\r\n{ctype}Content-Length: {}\r\n{retry}Cache-Control: no-store\r\n\
         Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS\r\n\
         Access-Control-Allow-Headers: Content-Type, Authorization, If-Match, If-None-Match\r\nAccess-Control-Expose-Headers: Retry-After\r\n\
         Access-Control-Max-Age: 86400\r\nConnection: close\r\n\r\n",
        rep.status, reason(rep.status), rep.body.len()
    );
    let _ = s.write_all(head.as_bytes());
    let _ = s.write_all(rep.body.as_bytes());
}

/// One request, read in full. Header names are lowercased.
pub struct Request {
    pub method: String,
    pub path: String,
    pub query: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
    /// the caller's address: Fly's `Fly-Client-IP` when there is one, else the socket's
    pub ip: String,
}

impl Request {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(n, _)| n == name).map(|(_, v)| v.as_str())
    }
}

/// Reads the request line, headers and body (up to `max_body` bytes). `Err` is the reply to send instead (and `None` if the peer just went away).
pub fn read_request(s: &mut TcpStream, max_body: usize) -> Result<Request, Option<Reply>> {
    let peer = s.peer_addr().map(|a| a.ip().to_string()).unwrap_or_default();
    let mut buf: Vec<u8> = Vec::with_capacity(2048);
    let mut chunk = [0u8; 4096];
    let head_end = loop {
        if let Some(p) = buf.windows(4).position(|w| w == b"\r\n\r\n") { break p + 4; }
        if buf.len() > 8192 { return Err(Some(err(431, "headers_too_large", "headers too large"))); }
        match s.read(&mut chunk) {
            Ok(0) | Err(_) => return Err(None),
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
        }
    };
    let head = String::from_utf8_lossy(&buf[..head_end]).into_owned();
    let mut lines = head.split("\r\n");
    let mut first = lines.next().unwrap_or("").split_whitespace();
    let (method, target) = (first.next().unwrap_or("").to_string(), first.next().unwrap_or("").to_string());
    let (path, query) = target.split_once('?').map(|(a, b)| (a.to_string(), b.to_string())).unwrap_or((target.clone(), String::new()));
    let mut headers = Vec::new();
    let (mut clen, mut chunked) = (0usize, false);
    for l in lines {
        let Some((n, v)) = l.split_once(':') else { continue };
        let (n, v) = (n.trim().to_ascii_lowercase(), v.trim().to_string());
        match n.as_str() {
            "content-length" => clen = v.parse().unwrap_or(usize::MAX),
            "transfer-encoding" => chunked = true,
            _ => {}
        }
        headers.push((n, v));
    }
    let mut req = Request { method, path, query, headers, body: Vec::new(), ip: String::new() };
    req.ip = req.header("fly-client-ip").map(str::to_string).unwrap_or(peer);
    if req.method == "OPTIONS" { return Ok(req); } // a preflight: no body wanted
    if chunked { return Err(Some(err(411, "length_required", "send Content-Length, not chunked encoding"))); }
    if clen > max_body { return Err(Some(err(413, "too_large", &format!("body is over {max_body} bytes")))); }
    let mut body = buf[head_end..].to_vec();
    while body.len() < clen {
        match s.read(&mut chunk) {
            Ok(0) | Err(_) => return Err(None),
            Ok(n) => body.extend_from_slice(&chunk[..n]),
        }
    }
    body.truncate(clen);
    req.body = body;
    Ok(req)
}

pub fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}
