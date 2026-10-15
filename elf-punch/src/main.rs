//! A small server for game experiments, in one static binary: std threads, no async runtime.
//!
//!  - `/kv/...`   a shared JSON key/value store for browser games that need no server logic (`store.rs`)
//!  - `/lab/...`  authoritative games: the server owns the rules and the state, players join with a name and get a secret token
//!                (`lab/`). Add a game by implementing one trait.
//!  - `/jetfall` a WebSocket room relay for the Jetfall FPS: a browser hosts, the server matches rooms and passes signaling and packets (`relay.rs`)
//!  - `/ws`, `/` the original Elf Castle Wood Puncher toy (`elf.rs`)
//!
//! One machine only: the lab games and the store live in this process's memory and on its volume.
mod elf;
mod http;
mod lab;
mod relay;
mod store;

use std::net::TcpListener;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

fn main() {
    let port = std::env::var("PORT").unwrap_or_else(|_| "8080".into());
    let listener = TcpListener::bind(format!("0.0.0.0:{port}")).expect("bind");
    let shared = elf::start();
    store::init();
    lab::init();
    println!("elf-punch on {port}");
    let live = Arc::new(AtomicUsize::new(0));
    for stream in listener.incoming().flatten() {
        if live.fetch_add(1, Ordering::SeqCst) >= 220 { live.fetch_sub(1, Ordering::SeqCst); continue; }
        let (shared, live) = (shared.clone(), live.clone());
        thread::Builder::new().stack_size(128 * 1024).spawn(move || {
            let mut peek = [0u8; 512];
            let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
            let n = stream.peek(&mut peek).unwrap_or(0);
            let head = String::from_utf8_lossy(&peek[..n]).to_ascii_lowercase();
            let path = head.split_whitespace().nth(1).unwrap_or("");
            let under = |p: &str| path == p || path.starts_with(&format!("{p}/")) || path.starts_with(&format!("{p}?"));
            if under("/kv") { store::serve(stream); }
            else if under("/lab") { lab::serve(stream); }
            else if under("/jetfall") { relay::serve(stream); }
            else if head.starts_with("get /ws ") || head.starts_with("get /ws?") { let _ = stream.set_read_timeout(None); elf::ws_conn(stream, shared); }
            else { elf::http(stream, shared); }
            live.fetch_sub(1, Ordering::SeqCst);
        }).ok();
    }
}
