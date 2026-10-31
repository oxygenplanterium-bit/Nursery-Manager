// Sends a phone notification when a new chat message is saved.
// Triggered by a database trigger on public.docs (see docs/PUSH_SETUP.md).
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:oxygenplanterium@gmail.com",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const rec = body.record, old = body.old_record;
    if (!rec || !String(rec.path || "").startsWith("chat/")) return new Response("skip");
    const conv = rec.data || {}, oldM = (old && old.data && old.data.m) || {}, m = conv.m || {};
    const fresh = Object.keys(m).filter((k) => m[k] && !oldM[k]);
    if (!fresh.length) return new Response("no new message");
    const people: string[] = ["owner", ...((conv.p as string[]) || [])];
    const subs = await sb.from("docs").select("path,data").like("path", "push/%");
    const rows = (subs.data || []) as { path: string; data: { who: string; sub: any } }[];
    let sent = 0;
    for (const k of fresh) {
      const msg = m[k];
      const payload = JSON.stringify({
        title: (conv.n ? conv.n + " - " : "") + (msg.n || "New message"),
        body: msg.t ? String(msg.t).slice(0, 140) : "Sent a photo",
        tag: "chat-" + rec.path.slice(5),
        url: "./",
      });
      for (const r of rows) {
        if (!people.includes(r.data.who) || r.data.who === msg.s) continue;
        try { await webpush.sendNotification(r.data.sub, payload); sent++; }
        catch (e: any) {
          if (e && (e.statusCode === 404 || e.statusCode === 410)) await sb.from("docs").delete().eq("path", r.path);
        }
      }
    }
    return new Response("sent " + sent);
  } catch (e) {
    return new Response("error " + String(e), { status: 500 });
  }
});
