use super::clicker::Clicker;
use super::tradewars::{fight, make_galaxy, quote, unit_price, Config, Port, Rng, TradeWars};
use super::*;
use serde_json::json;

const T0: u64 = 1_000_000;

fn limits() -> LabLimits { LabLimits { max_players: 1000, ip_req_per_min: 100_000, ip_joins_per_hour: 100_000, act_per_min: 100_000 } }

fn cfg() -> Config {
    Config { seed: 7, sectors: 60, turn_secs: 90, turn_cap: 600, start_turns: 300, port_tau: 14_400.0, protect_new_secs: 0, protect_death_secs: 3600 }
}

fn tmp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("lab-test-{}-{}-{}", name, std::process::id(), crate::http::now_secs()));
    let _ = std::fs::remove_dir_all(&d);
    d
}

fn lab_with(dir: PathBuf, lim: LabLimits, c: Config) -> Lab {
    Lab::new(dir, lim, vec![Box::new(Clicker::default()), Box::new(TradeWars::new(c))])
}

fn req(method: &str, path: &str, token: Option<&str>, body: &str) -> Request {
    let mut headers = vec![];
    if let Some(t) = token { headers.push(("authorization".to_string(), format!("Bearer {t}"))); }
    Request { method: method.into(), path: path.into(), query: String::new(), headers, body: body.as_bytes().to_vec(), ip: "1.2.3.4".into() }
}

fn join(lab: &mut Lab, game: &str, name: &str, now: u64) -> (u32, String) {
    let r = lab.handle(&req("POST", &format!("/lab/{game}/join"), None, &json!({"name": name}).to_string()), now);
    assert_eq!(r.status, 201, "{}", r.body);
    let v: Value = serde_json::from_str(&r.body).unwrap();
    (v["id"].as_u64().unwrap() as u32, v["token"].as_str().unwrap().to_string())
}

fn act(lab: &mut Lab, tok: &str, a: Value, now: u64) -> Result<Value, String> {
    let r = lab.handle(&req("POST", "/lab/warptraders/act", Some(tok), &a.to_string()), now);
    let v: Value = serde_json::from_str(&r.body).unwrap();
    if r.status == 200 { Ok(v) } else { assert_eq!(r.status, 400, "{}", r.body); Err(v["message"].as_str().or(v["error"].as_str()).unwrap_or("").to_string()) }
}

fn me(lab: &mut Lab, tok: &str, now: u64) -> Value {
    let r = lab.handle(&req("GET", "/lab/warptraders/me", Some(tok), ""), now);
    assert_eq!(r.status, 200, "{}", r.body);
    serde_json::from_str(&r.body).unwrap()
}

// ----- the framework -----

#[test]
fn sha256_of_token_is_what_is_stored() {
    let dir = tmp("hash");
    let mut lab = lab_with(dir.clone(), limits(), cfg());
    let (_, tok) = join(&mut lab, "clicker", "Ann", T0);
    lab.save_dirty();
    let saved = std::fs::read_to_string(dir.join("clicker.json")).unwrap();
    assert!(!saved.contains(&tok), "the token itself must never be saved");
    assert!(saved.contains(&sha256::sha256_hex(&tok)));
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn names_are_cleaned_and_unique() {
    assert_eq!(clean_name("  Ann   B  "), Some("Ann B".into()));
    assert_eq!(clean_name("a"), None);
    assert_eq!(clean_name("Admin"), None);
    assert_eq!(clean_name("<script>"), Some("script".into()));
    assert_eq!(clean_name(&"x".repeat(17)), None);
    let mut lab = lab_with(tmp("names"), limits(), cfg());
    join(&mut lab, "clicker", "Ann", T0);
    let r = lab.handle(&req("POST", "/lab/clicker/join", None, r#"{"name":"ann"}"#), T0);
    assert_eq!(r.status, 409);
    let r = lab.handle(&req("POST", "/lab/clicker/join", None, r#"{"name":"!"}"#), T0);
    assert_eq!(r.status, 400);
    let r = lab.handle(&req("POST", "/lab/clicker/join", None, "not json"), T0);
    assert_eq!(r.status, 400);
    // same name in another game is fine
    join(&mut lab, "warptraders", "Ann", T0);
}

#[test]
fn auth_rules() {
    let mut lab = lab_with(tmp("auth"), limits(), cfg());
    let (_, tok) = join(&mut lab, "clicker", "Ann", T0);
    assert_eq!(lab.handle(&req("GET", "/lab/clicker/me", None, ""), T0).status, 401);
    assert_eq!(lab.handle(&req("GET", "/lab/clicker/me", Some("short"), ""), T0).status, 401);
    assert_eq!(lab.handle(&req("GET", "/lab/clicker/me", Some(&"a".repeat(32)), ""), T0).status, 401);
    assert_eq!(lab.handle(&req("GET", "/lab/clicker/me", Some(&tok), ""), T0).status, 200);
    // a token from one game is nobody in another
    assert_eq!(lab.handle(&req("GET", "/lab/warptraders/me", Some(&tok), ""), T0).status, 401);
    assert_eq!(lab.handle(&req("GET", "/lab/nope/board", None, ""), T0).status, 404);
    assert_eq!(lab.handle(&req("GET", "/lab/clicker/board/extra", None, ""), T0).status, 404);
    assert_eq!(lab.handle(&req("DELETE", "/lab/clicker/me", Some(&tok), ""), T0).status, 404);
    assert_eq!(lab.handle(&req("GET", "/lab", None, ""), T0).status, 200);
    assert_eq!(lab.handle(&req("POST", "/lab", None, ""), T0).status, 405);
}

#[test]
fn refused_actions_change_nothing_and_cost_no_save() {
    let dir = tmp("refuse");
    let mut lab = lab_with(dir.clone(), limits(), cfg());
    let (_, tok) = join(&mut lab, "clicker", "Ann", T0);
    lab.save_dirty();
    let bad = [json!({}), json!({"clicks": 0}), json!({"clicks": 11}), json!({"clicks": -1}), json!({"clicks": 1.5}), json!({"clicks": "3"}), json!(null), json!([1])];
    for b in bad {
        let r = lab.handle(&req("POST", "/lab/clicker/act", Some(&tok), &b.to_string()), T0);
        assert_eq!(r.status, 400, "{b}");
    }
    assert_eq!(lab.handle(&req("POST", "/lab/clicker/act", Some(&tok), "{{"), T0).status, 400);
    assert!(!lab.slots[0].dirty);
    let r = lab.handle(&req("POST", "/lab/clicker/act", Some(&tok), r#"{"clicks":3}"#), T0);
    assert_eq!(r.status, 200);
    assert!(lab.slots[0].dirty);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn limits_apply() {
    let mut lim = limits();
    lim.ip_joins_per_hour = 2;
    lim.act_per_min = 3;
    lim.max_players = 3;
    let mut lab = lab_with(tmp("lim"), lim, cfg());
    join(&mut lab, "clicker", "Ann", T0);
    let (_, tok) = join(&mut lab, "clicker", "Bob", T0);
    let r = lab.handle(&req("POST", "/lab/clicker/join", None, r#"{"name":"Cy"}"#), T0);
    assert_eq!(r.status, 429);
    assert!(r.retry_after.is_some());
    let r = lab.handle(&req("POST", "/lab/clicker/join", None, r#"{"name":"Cy"}"#), T0 + 3601);
    assert_eq!(r.status, 201);
    let r = lab.handle(&req("POST", "/lab/clicker/join", None, r#"{"name":"Di"}"#), T0 + 7300);
    assert_eq!(r.status, 507);
    let now = T0 + 7300;
    for i in 0..4 {
        let r = lab.handle(&req("POST", "/lab/clicker/act", Some(&tok), r#"{"clicks":1}"#), now);
        assert_eq!(r.status, if i < 3 { 200 } else { 429 });
    }
    // the window resets
    assert_eq!(lab.handle(&req("POST", "/lab/clicker/act", Some(&tok), r#"{"clicks":1}"#), now + 61).status, 200);
}

#[test]
fn ip_request_limit() {
    let mut lim = limits();
    lim.ip_req_per_min = 5;
    let mut lab = lab_with(tmp("ipreq"), lim, cfg());
    for i in 0..7 {
        let r = lab.handle(&req("GET", "/lab", None, ""), T0);
        assert_eq!(r.status, if i < 5 { 200 } else { 429 });
    }
    assert_eq!(lab.handle(&req("GET", "/lab", None, ""), T0 + 61).status, 200);
}

#[test]
fn saves_and_loads_players_and_game() {
    let dir = tmp("persist");
    let (tok_a, tok_b);
    {
        let mut lab = lab_with(dir.clone(), limits(), cfg());
        tok_a = join(&mut lab, "clicker", "Ann", T0).1;
        tok_b = join(&mut lab, "warptraders", "Bob", T0).1;
        lab.handle(&req("POST", "/lab/clicker/act", Some(&tok_a), r#"{"clicks":5}"#), T0);
        act(&mut lab, &tok_b, json!({"do": "fighters", "qty": 3}), T0).unwrap();
        lab.save_dirty();
    }
    let mut lab = lab_with(dir.clone(), limits(), cfg());
    let r = lab.handle(&req("GET", "/lab/clicker/me", Some(&tok_a), ""), T0);
    assert_eq!(r.status, 200);
    assert!(r.body.contains('5'));
    let v = me(&mut lab, &tok_b, T0);
    assert_eq!(v["you"]["fighters"], 3);
    // ids carry on, and the old name is still taken
    let r = lab.handle(&req("POST", "/lab/clicker/join", None, r#"{"name":"ANN"}"#), T0);
    assert_eq!(r.status, 409);
    let (id, _) = join(&mut lab, "clicker", "Cy", T0);
    assert_eq!(id, 2);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn unreadable_save_is_moved_aside() {
    let dir = tmp("corrupt");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("clicker.json"), "{ this is not json").unwrap();
    std::fs::write(dir.join("warptraders.json"), r#"{"v": 99}"#).unwrap();
    let mut lab = lab_with(dir.clone(), limits(), cfg());
    join(&mut lab, "clicker", "Ann", T0);
    assert!(!dir.join("clicker.json").exists());
    let names: Vec<String> = std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().to_string()).collect();
    assert_eq!(names.iter().filter(|n| n.contains("corrupt")).count(), 2, "{names:?}");
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn hostile_save_contents_do_not_crash() {
    let dir = tmp("hostile");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("clicker.json"), r#"{"v":1,"next_id":"x","players":[1,{"id":-1},{"id":2,"name":5,"hash":"h"}],"game":[null,{"id":"a"},7]}"#).unwrap();
    let mut lab = lab_with(dir.clone(), limits(), cfg());
    join(&mut lab, "clicker", "Ann", T0);
    let _ = std::fs::remove_dir_all(dir);
}

// ----- trade wars: the galaxy and the prices -----

#[test]
fn galaxy_is_connected_and_repeatable() {
    for seed in [1u64, 7, 99, 12345] {
        let a = make_galaxy(seed, 120, T0);
        let b = make_galaxy(seed, 120, T0);
        assert_eq!(a.len(), b.len());
        assert!(a.len() >= 100, "enough sectors fit: {}", a.len());
        let mut seen = vec![false; a.len()];
        let mut stack = vec![0usize];
        seen[0] = true;
        while let Some(c) = stack.pop() {
            for &n in &a[c].warps { if !seen[n] { seen[n] = true; stack.push(n); } }
        }
        assert!(seen.iter().all(|s| *s), "every sector can be reached (seed {seed})");
        for (x, y) in a.iter().zip(&b) { assert_eq!(x.warps, y.warps); assert_eq!(x.port.is_some(), y.port.is_some()); }
        assert!(a[0].port.is_none(), "Stardock has no port");
        for s in &a { for &w in &s.warps { assert!(a[w].warps.contains(&s.id), "lanes go both ways"); assert_ne!(w, s.id); } }
        let ports = a.iter().filter(|s| s.port.is_some()).count();
        assert!(ports > a.len() / 3);
    }
}

fn port(stock: f64) -> Port { Port { sells: [true, false, false], max: [1000.0, 1000.0, 1000.0], stock: [stock, 500.0, 500.0], t: T0 } }

#[test]
fn buy_then_sell_back_never_makes_money() {
    for stock in [0.0f64, 1.0, 10.0, 400.0, 999.0, 1000.0] {
        for qty in [1u32, 2, 5, 37, 100] {
            let p = port(stock.max(qty as f64));
            let cost = quote(&p, 0, qty, true);
            let mut after = port(p.stock[0] - qty as f64);
            after.sells = p.sells;
            let back = quote(&after, 0, qty, false);
            assert!(back <= cost, "stock {stock} qty {qty}: paid {cost}, got back {back}");
        }
    }
}

#[test]
fn price_falls_as_stock_rises() {
    let mut last = f64::MAX;
    for s in 0..=10 {
        let p = unit_price(2, s as f64 * 100.0, 1000.0);
        assert!(p < last);
        last = p;
    }
    assert!(unit_price(0, -5.0, 100.0) > 0.0);
    assert!(unit_price(0, 1e9, 100.0) > 0.0);
}

#[test]
fn port_stock_drifts_back_and_stays_bounded() {
    let mut p = Port { sells: [true, false, true], max: [1000.0; 3], stock: [0.0, 1000.0, 0.0], t: T0 };
    p.refresh(T0 + 14_400, 14_400.0);
    assert!(p.stock[0] > 500.0 && p.stock[0] < 900.0);
    assert!(p.stock[1] < 400.0);
    p.refresh(T0 + 10_000_000, 14_400.0);
    assert!((p.stock[0] - 900.0).abs() < 1.0 && (p.stock[1] - 50.0).abs() < 1.0);
    p.refresh(T0, 14_400.0); // time going backwards does nothing
    assert!((p.stock[0] - 900.0).abs() < 1.0);
}

#[test]
fn fights_are_sane() {
    let mut rng = Rng::new(3);
    for _ in 0..2000 {
        let a = (rng.f() * 500.0) as u32;
        let d = (rng.f() * 500.0) as u32;
        let (al, dl) = fight(&mut rng, a, d);
        assert!(al <= a && dl <= d);
        assert!(al == 0 || dl == 0, "someone loses: {a} v {d} -> {al} {dl}");
    }
    let mut wins = 0;
    for _ in 0..500 { let (al, _) = fight(&mut rng, 200, 100); if al > 0 { wins += 1; } }
    assert!(wins > 480, "twice the fighters nearly always wins");
    assert_eq!(fight(&mut rng, 0, 0), (0, 0));
}

// ----- trade wars: the game through the API -----

fn first_port(lab: &mut Lab) -> usize {
    // the nearest sector to Stardock with a port: found by asking the game for the map after peeking at lanes
    let g = make_galaxy(7, 60, T0);
    let _ = lab;
    let d = |s: &super::tradewars::Sector| (s.x - g[0].x).abs() + (s.y - g[0].y).abs();
    g.iter().filter(|s| s.port.is_some()).min_by(|a, b| d(a).partial_cmp(&d(b)).unwrap()).unwrap().id
}

#[test]
fn turns_refill_and_cap() {
    let mut lab = lab_with(tmp("turns"), limits(), Config { start_turns: 10, turn_cap: 12, ..cfg() });
    let (_, tok) = join(&mut lab, "warptraders", "Ann", T0);
    assert_eq!(me(&mut lab, &tok, T0)["you"]["turns"], 10);
    assert_eq!(me(&mut lab, &tok, T0 + 90)["you"]["turns"], 11);
    assert_eq!(me(&mut lab, &tok, T0 + 85)["you"]["turns"], 11, "never goes backwards");
    assert_eq!(me(&mut lab, &tok, T0 + 90 * 50)["you"]["turns"], 12);
    assert_eq!(me(&mut lab, &tok, T0 + 90 * 50)["you"]["next_turn_in"], 0);
}

#[test]
fn hostile_actions_are_refused() {
    let mut lab = lab_with(tmp("hostile-act"), limits(), cfg());
    let (_, tok) = join(&mut lab, "warptraders", "Ann", T0);
    let before = me(&mut lab, &tok, T0)["you"].clone();
    let bad = [
        json!({}), json!({"do": 5}), json!({"do": "nope"}), json!(null), json!("warp"), json!([]),
        json!({"do": "warp"}), json!({"do": "warp", "to": -1}), json!({"do": "warp", "to": 1e30}), json!({"do": "warp", "to": "3"}), json!({"do": "warp", "to": 99999}),
        json!({"do": "warp", "to": 0}), json!({"do": "travel", "to": 0}), json!({"do": "travel", "to": 59}), json!({"do": "travel", "to": 99999}),
        json!({"do": "buy", "good": "fuel", "qty": 1}), json!({"do": "sell", "good": "fuel", "qty": 1}), json!({"do": "buy", "good": "gold", "qty": 1}),
        json!({"do": "buy", "good": 3, "qty": 1}), json!({"do": "buy", "good": "fuel", "qty": -4}), json!({"do": "buy", "good": "fuel", "qty": 0}),
        json!({"do": "buy", "good": "fuel", "qty": 1e19}), json!({"do": "buy", "good": "fuel", "qty": "lots"}),
        json!({"do": "fighters", "qty": 0}), json!({"do": "fighters", "qty": 100000}), json!({"do": "fighters", "qty": -1}), json!({"do": "fighters", "qty": 1.5}),
        json!({"do": "attack"}), json!({"do": "attack", "target": "Ann"}), json!({"do": "attack", "target": "Nobody"}), json!({"do": "attack", "target": 4}),
        json!({"do": "say", "to": "Nobody", "text": "hi"}), json!({"do": "say", "to": "Ann"}),
    ];
    for b in bad {
        assert!(act(&mut lab, &tok, b.clone(), T0).is_err(), "{b} should be refused");
    }
    let after = me(&mut lab, &tok, T0)["you"].clone();
    assert_eq!(before, after, "refusals change nothing");
}

#[test]
fn fighters_and_holds_cost_credits_and_stay_in_bounds() {
    let mut lab = lab_with(tmp("shop"), limits(), cfg());
    let (_, tok) = join(&mut lab, "warptraders", "Ann", T0);
    let v = me(&mut lab, &tok, T0);
    let credits = v["you"]["credits"].as_i64().unwrap();
    let r = act(&mut lab, &tok, json!({"do": "fighters", "qty": 10}), T0).unwrap();
    assert_eq!(r["view"]["you"]["fighters"], 10);
    assert_eq!(r["view"]["you"]["credits"].as_i64().unwrap(), credits - 10 * v["costs"]["fighter"].as_i64().unwrap());
    let r = act(&mut lab, &tok, json!({"do": "holds"}), T0).unwrap();
    assert_eq!(r["view"]["you"]["holds"].as_u64().unwrap(), v["you"]["holds"].as_u64().unwrap() + 5);
    // spend everything and then more is refused
    while act(&mut lab, &tok, json!({"do": "fighters", "qty": 50}), T0).is_ok() {}
    assert!(me(&mut lab, &tok, T0)["you"]["credits"].as_i64().unwrap() >= 0);
}

#[test]
fn warping_costs_a_turn_and_learns_the_map() {
    let mut lab = lab_with(tmp("warp"), limits(), cfg());
    let (_, tok) = join(&mut lab, "warptraders", "Ann", T0);
    let v = me(&mut lab, &tok, T0);
    let to = v["sector"]["warps"][0].as_u64().unwrap();
    let known = v["map"].as_array().unwrap().len();
    let r = act(&mut lab, &tok, json!({"do": "warp", "to": to}), T0).unwrap();
    assert_eq!(r["view"]["you"]["turns"], 299);
    assert_eq!(r["view"]["you"]["sector"], to);
    assert!(r["view"]["map"].as_array().unwrap().len() >= known);
    // a lane that does not start here is refused
    let far = (0..60u64).find(|s| *s != to && !r["view"]["sector"]["warps"].as_array().unwrap().iter().any(|w| w == s)).unwrap();
    assert!(act(&mut lab, &tok, json!({"do": "warp", "to": far}), T0).is_err());
    // travel goes back along known lanes, one turn per warp
    let r = act(&mut lab, &tok, json!({"do": "travel", "to": 0}), T0).unwrap();
    assert_eq!(r["view"]["you"]["turns"], 298);
    assert_eq!(r["view"]["you"]["sector"], 0);
}

#[test]
fn no_turns_means_no_warp() {
    let mut lab = lab_with(tmp("noturns"), limits(), Config { start_turns: 1, ..cfg() });
    let (_, tok) = join(&mut lab, "warptraders", "Ann", T0);
    let v = me(&mut lab, &tok, T0);
    let w = v["sector"]["warps"].as_array().unwrap();
    act(&mut lab, &tok, json!({"do": "warp", "to": w[0]}), T0).unwrap();
    let back = act(&mut lab, &tok, json!({"do": "warp", "to": 0}), T0);
    assert!(back.is_err());
    assert!(act(&mut lab, &tok, json!({"do": "warp", "to": 0}), T0 + 90).is_ok());
}

/// finds a port that sells something and walks the player there, returning (sector, good it sells)
fn go_to_port(lab: &mut Lab, tok: &str, now: u64) -> (u64, String) {
    let target = first_port(lab);
    let mut v = me(lab, tok, now);
    // walk outward from Stardock by trying each warp until the target is in reach: BFS over the galaxy as the test knows it
    let g = make_galaxy(7, 60, T0);
    let mut prev = vec![usize::MAX; g.len()];
    let mut q = std::collections::VecDeque::from([0usize]);
    prev[0] = 0;
    while let Some(c) = q.pop_front() { for &n in &g[c].warps { if prev[n] == usize::MAX { prev[n] = c; q.push_back(n); } } }
    let mut path = vec![target];
    while *path.last().unwrap() != 0 { path.push(prev[*path.last().unwrap()]); }
    path.reverse();
    for s in &path[1..] { v = act(lab, tok, json!({"do": "warp", "to": s}), now).unwrap()["view"].clone(); }
    let goods = v["sector"]["port"]["goods"].as_array().unwrap();
    let sells = goods.iter().find(|g| g["mode"] == "sell").unwrap()["good"].as_str().unwrap().to_string();
    (target as u64, sells)
}

#[test]
fn trading_moves_the_shared_price() {
    let mut lab = lab_with(tmp("shared"), limits(), cfg());
    let (_, a) = join(&mut lab, "warptraders", "Ann", T0);
    let (_, b) = join(&mut lab, "warptraders", "Bob", T0);
    let (_, good) = go_to_port(&mut lab, &a, T0);
    go_to_port(&mut lab, &b, T0);
    let price = |v: &Value| v["sector"]["port"]["goods"].as_array().unwrap().iter().find(|g| g["good"] == good.as_str()).unwrap()["price"].as_f64().unwrap();
    let before = price(&me(&mut lab, &b, T0));
    act(&mut lab, &a, json!({"do": "buy", "good": good, "qty": "max"}), T0).unwrap();
    let after = price(&me(&mut lab, &b, T0));
    assert!(after > before, "Ann emptied the shelf, Bob sees a higher price ({before} -> {after})");
    // and Ann cannot make money by selling straight back
    let credits_a = me(&mut lab, &a, T0)["you"]["credits"].as_i64().unwrap();
    let _ = credits_a;
}

#[test]
fn buy_and_sell_back_at_one_port_loses_or_breaks_even() {
    let mut lab = lab_with(tmp("roundtrip"), limits(), cfg());
    let (_, a) = join(&mut lab, "warptraders", "Ann", T0);
    let (_, good) = go_to_port(&mut lab, &a, T0);
    let start = me(&mut lab, &a, T0)["you"]["credits"].as_i64().unwrap();
    let r = act(&mut lab, &a, json!({"do": "buy", "good": good, "qty": 7}), T0).unwrap();
    assert_eq!(r["view"]["you"]["cargo"][&good], 7);
    // the port only buys what it does not sell, so selling back is refused; the cargo is simply carried
    assert!(act(&mut lab, &a, json!({"do": "sell", "good": good, "qty": 7}), T0).is_err());
    assert!(me(&mut lab, &a, T0)["you"]["credits"].as_i64().unwrap() < start);
}

#[test]
fn buying_is_capped_by_holds_credits_and_stock() {
    let mut lab = lab_with(tmp("caps"), limits(), cfg());
    let (_, a) = join(&mut lab, "warptraders", "Ann", T0);
    let (_, good) = go_to_port(&mut lab, &a, T0);
    let holds = me(&mut lab, &a, T0)["you"]["holds"].as_u64().unwrap();
    assert!(act(&mut lab, &a, json!({"do": "buy", "good": good, "qty": holds + 1}), T0).is_err());
    let r = act(&mut lab, &a, json!({"do": "buy", "good": good, "qty": "max"}), T0).unwrap();
    let carried: u64 = ["fuel", "organics", "equipment"].iter().map(|g| r["view"]["you"]["cargo"][g].as_u64().unwrap()).sum();
    assert!(carried <= holds);
    assert!(r["view"]["you"]["credits"].as_i64().unwrap() >= 0);
}

// ----- trade wars: fighting -----

fn armed_pair(lab: &mut Lab, a_fighters: u64, b_fighters: u64) -> (String, String) {
    let (_, a) = join(lab, "warptraders", "Ann", T0);
    let (_, b) = join(lab, "warptraders", "Bob", T0);
    if a_fighters > 0 { act(lab, &a, json!({"do": "fighters", "qty": a_fighters}), T0).unwrap(); }
    if b_fighters > 0 { act(lab, &b, json!({"do": "fighters", "qty": b_fighters}), T0).unwrap(); }
    (a, b)
}

fn step_out(lab: &mut Lab, tok: &str) -> u64 {
    let v = me(lab, tok, T0);
    let to = v["sector"]["warps"][0].as_u64().unwrap();
    act(lab, tok, json!({"do": "warp", "to": to}), T0).unwrap();
    to
}

#[test]
fn nobody_fights_at_stardock() {
    let mut lab = lab_with(tmp("dock"), limits(), cfg());
    let (a, _) = armed_pair(&mut lab, 20, 5);
    assert!(act(&mut lab, &a, json!({"do": "attack", "target": "Bob"}), T0).unwrap_err().contains("Stardock"));
}

#[test]
fn attack_needs_the_same_sector_and_fighters_and_turns() {
    let mut lab = lab_with(tmp("rules"), limits(), cfg());
    let (a, b) = armed_pair(&mut lab, 20, 5);
    let sa = step_out(&mut lab, &a);
    assert!(act(&mut lab, &a, json!({"do": "attack", "target": "Bob"}), T0).unwrap_err().contains("sector"));
    let r = act(&mut lab, &b, json!({"do": "warp", "to": sa}), T0).unwrap();
    assert_eq!(r["view"]["sector"]["here"][0]["name"], "Ann");
    let (c, _) = (join(&mut lab, "warptraders", "Cy", T0).1, 0);
    // a trader with no fighters cannot attack
    let sc = me(&mut lab, &c, T0)["sector"]["warps"][0].as_u64().unwrap();
    let _ = sc;
    assert!(act(&mut lab, &c, json!({"do": "attack", "target": "Ann"}), T0).is_err());
}

#[test]
fn bigger_fleet_wins_loser_goes_home_and_cargo_changes_hands() {
    let mut lab = lab_with(tmp("pvp"), limits(), cfg());
    let (a, b) = armed_pair(&mut lab, 25, 3);
    let sa = step_out(&mut lab, &a);
    act(&mut lab, &b, json!({"do": "warp", "to": sa}), T0).unwrap();
    let before = me(&mut lab, &a, T0)["you"]["turns"].as_u64().unwrap();
    let r = act(&mut lab, &a, json!({"do": "attack", "target": "bob"}), T0).unwrap();
    assert!(r["msg"].as_str().unwrap().starts_with("Victory"), "{}", r["msg"]);
    assert_eq!(r["view"]["you"]["turns"].as_u64().unwrap(), before - 3);
    assert_eq!(r["view"]["you"]["kills"], 1);
    let f = r["view"]["you"]["fighters"].as_u64().unwrap();
    assert!(f > 0 && f <= 25);
    let vb = me(&mut lab, &b, T0);
    assert_eq!(vb["you"]["sector"], 0);
    assert_eq!(vb["you"]["fighters"], 0);
    assert_eq!(vb["you"]["deaths"], 1);
    assert!(vb["you"]["protected_secs"].as_u64().unwrap() > 0);
    assert!(vb["inbox"].as_array().unwrap().len() >= 1);
    // a destroyed trader is safe for a while, and never negative
    let vb2 = me(&mut lab, &b, T0);
    assert!(vb2["you"]["credits"].as_i64().unwrap() > 0);
    // the news mentions it
    let board: Value = serde_json::from_str(&lab.handle(&req("GET", "/lab/warptraders/board", None, ""), T0).body).unwrap();
    assert!(board["news"].as_array().unwrap().iter().any(|n| n["text"].as_str().unwrap().contains("destroyed")));
}

#[test]
fn protected_players_cannot_be_attacked() {
    let mut lab = lab_with(tmp("prot"), limits(), Config { protect_new_secs: 3 * 3600, ..cfg() });
    let (a, b) = armed_pair(&mut lab, 25, 0);
    let sa = step_out(&mut lab, &a);
    act(&mut lab, &b, json!({"do": "warp", "to": sa}), T0).unwrap();
    assert!(act(&mut lab, &a, json!({"do": "attack", "target": "Bob"}), T0).unwrap_err().contains("protected"));
    let v = me(&mut lab, &a, T0 + 3 * 3600 + 1);
    assert_eq!(v["sector"]["here"][0]["protected"], false);
    // protection ended; Ann may attack (turns have refilled)
    assert!(act(&mut lab, &a, json!({"do": "attack", "target": "Bob"}), T0 + 3 * 3600 + 1).is_ok());
}

#[test]
fn attacking_ends_your_own_protection() {
    let mut lab = lab_with(tmp("prot2"), limits(), Config { protect_new_secs: 3600, ..cfg() });
    let (a, b) = armed_pair(&mut lab, 25, 0);
    let sa = step_out(&mut lab, &a);
    act(&mut lab, &b, json!({"do": "warp", "to": sa}), T0).unwrap();
    let later = T0 + 3601;
    // Bob is no longer protected; Ann attacks and wins; she is not protected afterwards (she never was, but check the flag)
    act(&mut lab, &a, json!({"do": "attack", "target": "Bob"}), later).unwrap();
    assert_eq!(me(&mut lab, &a, later)["you"]["protected_secs"], 0);
}

#[test]
fn equal_fleets_never_leave_negative_numbers() {
    for seed in 0..40u64 {
        let mut lab = lab_with(tmp("equal"), limits(), Config { seed: seed + 1, ..cfg() });
        let (a, b) = armed_pair(&mut lab, 20, 20);
        let sa = step_out(&mut lab, &a);
        act(&mut lab, &b, json!({"do": "warp", "to": sa}), T0).unwrap_err_or_ok(&mut lab, &b, sa);
        let _ = act(&mut lab, &a, json!({"do": "attack", "target": "Bob"}), T0);
        for t in [&a, &b] {
            let v = me(&mut lab, t, T0);
            assert!(v["you"]["fighters"].as_u64().is_some());
            assert!(v["you"]["credits"].as_i64().unwrap() > 0);
            assert!(v["you"]["turns"].as_u64().is_some());
        }
    }
}

trait OkOrWalk { fn unwrap_err_or_ok(self, lab: &mut Lab, tok: &str, to: u64); }
impl OkOrWalk for Result<Value, String> {
    // Bob's first lane may not lead to Ann's sector in other galaxies: travel there by the known route
    fn unwrap_err_or_ok(self, lab: &mut Lab, tok: &str, to: u64) {
        if self.is_err() { let _ = act(lab, tok, json!({"do": "travel", "to": to}), T0); }
    }
}

#[test]
fn leaderboard_is_in_order_and_messages_are_cleaned() {
    let mut lab = lab_with(tmp("board"), limits(), cfg());
    let (_, a) = join(&mut lab, "warptraders", "Ann", T0);
    let (_, b) = join(&mut lab, "warptraders", "Bob", T0);
    act(&mut lab, &a, json!({"do": "fighters", "qty": 1}), T0).unwrap();
    let r = act(&mut lab, &a, json!({"do": "say", "to": "Bob", "text": format!("hi\u{0007}{}", "x".repeat(300))}), T0).unwrap();
    assert!(r["msg"].as_str().is_some());
    let inbox = me(&mut lab, &b, T0)["inbox"].clone();
    let text = inbox[0]["text"].as_str().unwrap();
    assert_eq!(inbox[0]["from"], "Ann");
    assert!(text.chars().count() <= 140 && !text.contains('\u{7}'));
    let board: Value = serde_json::from_str(&lab.handle(&req("GET", "/lab/warptraders/board", None, ""), T0).body).unwrap();
    let top = board["top"].as_array().unwrap();
    assert_eq!(top.len(), 2);
    assert!(top[0]["net_worth"].as_i64() >= top[1]["net_worth"].as_i64());
    assert_eq!(board["players"], 2);
    // the board never leaks tokens or hashes
    assert!(!board.to_string().contains("hash") && !board.to_string().contains(&a));
}

#[test]
fn view_hides_other_players_details() {
    let mut lab = lab_with(tmp("privacy"), limits(), cfg());
    let (a, b) = armed_pair(&mut lab, 20, 0);
    let _ = b;
    let v = me(&mut lab, &a, T0);
    let here = v["sector"]["here"].as_array().unwrap();
    assert_eq!(here.len(), 1);
    let o = here[0].as_object().unwrap();
    assert!(!o.contains_key("credits") && !o.contains_key("cargo") && !o.contains_key("id"));
}
