//! The smallest possible lab game, used by the tests and as a template: everyone clicks, the server counts.
//! Copy this file, rename the type, and put your rules in `act`.
use super::{Ctx, Game};
use serde_json::{json, Value};
use std::collections::BTreeMap;

#[derive(Default)]
pub struct Clicker {
    clicks: BTreeMap<u32, (String, u64)>, // player id -> (name, clicks)
}

impl Game for Clicker {
    fn id(&self) -> &'static str { "clicker" }
    fn title(&self) -> &'static str { "Clicker" }
    fn about(&self) -> &'static str { "Everyone clicks. The server counts. A template for a new game." }
    fn join(&mut self, _ctx: &Ctx, pid: u32, name: &str) -> Result<(), String> {
        self.clicks.insert(pid, (name.to_string(), 0));
        Ok(())
    }
    fn view(&mut self, _ctx: &Ctx, pid: u32) -> Value {
        json!({"you": self.clicks.get(&pid).map(|c| c.1)})
    }
    fn board(&mut self, ctx: &Ctx) -> Value {
        let mut rows: Vec<_> = self.clicks.iter().map(|(id, (n, c))| (c, n, ctx.online(*id, 60))).collect();
        rows.sort_by(|a, b| b.0.cmp(a.0).then(a.1.cmp(b.1)));
        json!({"top": rows.iter().map(|(c, n, o)| json!({"name": n, "clicks": c, "online": o})).collect::<Vec<_>>()})
    }
    // Anything in `action` is untrusted: check it before using it, and return Err (which changes nothing) if it is not right.
    fn act(&mut self, _ctx: &Ctx, pid: u32, action: &Value) -> Result<Value, String> {
        let n = action["clicks"].as_u64().filter(|n| (1..=10).contains(n)).ok_or("clicks must be a whole number from 1 to 10")?;
        let me = self.clicks.get_mut(&pid).ok_or("you are not playing")?;
        me.1 += n;
        Ok(json!({"clicks": me.1}))
    }
    fn save(&self) -> Value {
        json!(self.clicks.iter().map(|(id, (n, c))| json!({"id": id, "name": n, "clicks": c})).collect::<Vec<_>>())
    }
    fn load(&mut self, v: &Value) {
        self.clicks.clear();
        for r in v.as_array().into_iter().flatten() {
            if let (Some(id), Some(n), Some(c)) = (r["id"].as_u64(), r["name"].as_str(), r["clicks"].as_u64()) { self.clicks.insert(id as u32, (n.to_string(), c)); }
        }
    }
}
