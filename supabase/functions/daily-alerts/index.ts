// Runs every 5 minutes (pg_cron, see docs/ALERTS_SETUP.md).
// 1. Sends a phone notification to the supervisor when a task has been open for more than 30 minutes.
// 2. At 8:00 PM India time sends the day's report by email and WhatsApp to the numbers saved by the owner.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:oxygenplanterium@gmail.com",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);
const NAMES: Record<string, string> = { "1": "Chalmatti Nursery", "2": "Raynal Nursery" };
const HALF_HOUR = 30 * 60 * 1000;

const ist = () => new Date(Date.now() + 5.5 * 3600 * 1000);
const pad = (n: number) => String(n).padStart(2, "0");
const dayKey = (d: Date) => d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
const getDoc = async (p: string) => (await sb.from("docs").select("data").eq("path", p).maybeSingle()).data?.data ?? null;
const putDoc = (p: string, data: unknown) => sb.from("docs").upsert({ path: p, data, updated_at: new Date().toISOString() });
const dur = (ms: number) => { const m = Math.floor(ms / 60000); return m >= 60 ? Math.floor(m / 60) + " h " + (m % 60) + " min" : m + " min"; };

async function pushTo(subs: any[], payload: object) {
  let n = 0;
  for (const r of subs) {
    try { await webpush.sendNotification(r.data.sub, JSON.stringify(payload)); n++; }
    catch (e: any) { if (e && (e.statusCode === 404 || e.statusCode === 410)) await sb.from("docs").delete().eq("path", r.path); }
  }
  return n;
}

async function taskAlarm(today: string, hour: number, state: any) {
  if (hour < 6 || hour >= 21) return 0;
  const day = await getDoc("days/" + today);
  if (!day || !day.td) return 0;
  const settings = (await getDoc("meta/settings")) || {};
  const sup = (settings.team && settings.team.sup) || {};
  const subs = ((await sb.from("docs").select("path,data").like("path", "push/%")).data || []) as any[];
  state.td = state.td || {};
  const now = Date.now(); let sent = 0;
  for (const id of Object.keys(day.td)) {
    const x = day.td[id];
    if (!x || x.en || !x.st) continue;
    if (now - Math.max(x.st, state.td[id] || 0) < HALF_HOUR) continue;
    const nid = x.nid || "1";
    const mine = subs.filter((r) => r.data.who && r.data.who !== "owner" && sup[r.data.who] && !sup[r.data.who].x && (sup[r.data.who].nid || "1") === nid);
    state.td[id] = now;
    sent += await pushTo(mine, {
      title: "Task still in progress?",
      body: (x.title || "Task") + " has been open for " + dur(now - x.st) + ". If it is finished, close it now.",
      tag: "td-" + id, url: "./",
    });
  }
  return sent;
}

function summary(day: any) {
  const out: string[] = [];
  for (const nid of ["1", "2"]) {
    const rows = Object.values(day.rows || {}).filter((r: any) => r && !r.removed && !r.pending && (r.nid || "1") === nid) as any[];
    const tot = (k: string) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
    const bal = tot("total") + tot("purchase") - tot("sales") - tot("damages");
    const tds = Object.values(day.td || {}).filter((x: any) => x && (x.nid || "1") === nid) as any[];
    const done = tds.filter((x) => x.en).length;
    const att = Object.values(day.att || {}) as any[];
    out.push(
      NAMES[nid] + "\n" +
      "Stock items: " + rows.length + " | Opening " + tot("total") + " | Purchase " + tot("purchase") + " | Sales " + tot("sales") + " | Damages " + tot("damages") + " | Balance " + bal + "\n" +
      "Tasks and SOP: " + done + " done, " + (tds.length - done) + " still running",
    );
    if (nid === "1" && att.length) out.push("Attendance marked: " + att.length + " (Present " + att.filter((a) => a.s === "P" || !a.s).length + ", Half day " + att.filter((a) => a.s === "H").length + ", Absent " + att.filter((a) => a.s === "A").length + ")");
  }
  return out.join("\n\n");
}

async function sendReport(today: string, rep: any) {
  const day = (await getDoc("days/" + today)) || {};
  const text = "Oxygen Planterium - Daily Report " + today + "\n\n" + summary(day) + "\n\nOpen the app and use Download Full Report PDF for every detail.";
  const log: string[] = [];
  const key = Deno.env.get("RESEND_API_KEY");
  if (key && (rep.em || []).length) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ from: Deno.env.get("REPORT_FROM") ?? "Nursery Manager <onboarding@resend.dev>", to: rep.em, subject: "Daily Report " + today, text }),
    });
    log.push("email " + r.status);
  }
  const sid = Deno.env.get("TWILIO_SID"), tok = Deno.env.get("TWILIO_TOKEN"), from = Deno.env.get("TWILIO_WA_FROM");
  if (sid && tok && from) {
    for (const n of rep.wa || []) {
      const r = await fetch("https://api.twilio.com/2010-04-01/Accounts/" + sid + "/Messages.json", {
        method: "POST", headers: { Authorization: "Basic " + btoa(sid + ":" + tok), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ From: "whatsapp:" + from, To: "whatsapp:+" + String(n).replace(/\D/g, ""), Body: text.slice(0, 1500) }),
      });
      log.push("wa " + n + " " + r.status);
    }
  }
  return log.join(", ") || "nothing to send";
}

Deno.serve(async (req) => {
  try {
    const t = ist(), today = dayKey(t), hour = t.getUTCHours(), min = t.getUTCMinutes();
    const state = (await getDoc("meta/alerts")) || {};
    const res: string[] = [];
    res.push("alarms " + (await taskAlarm(today, hour, state)));
    const url = new URL(req.url);
    const force = url.searchParams.get("report") === "now";
    if ((hour === 20 && min < 15 && state.rep !== today) || force) {
      const rep = ((await getDoc("meta/accounts")) || {}).rep || {};
      if (rep.on !== false && ((rep.em || []).length || (rep.wa || []).length)) {
        res.push("report " + (await sendReport(today, rep)));
        if (!force) state.rep = today;
      }
    }
    for (const id of Object.keys(state.td || {})) if (Date.now() - state.td[id] > 2 * 86400000) delete state.td[id];
    await putDoc("meta/alerts", state);
    return new Response(res.join("; "));
  } catch (e) {
    return new Response("error " + String(e), { status: 500 });
  }
});
