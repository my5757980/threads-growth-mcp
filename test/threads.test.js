// Every tool against a fake fetch: nothing here reaches Threads, so nothing is ever posted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TOOLS, createThreads } from "../tools.js";

const TOKEN = "test-token";
const UID = "1111";

// Answers requests from a list of canned JSON bodies, in order, and records each request.
function fakeFetch(...responses) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ method: init.method || "GET", path: u.pathname.replace(/^\/v1\.0/, ""), params: Object.fromEntries(u.searchParams) });
    if (!responses.length) throw new Error(`unexpected request: ${init.method || "GET"} ${u.pathname}`);
    const r = responses.shift();
    return r instanceof Response ? r : new Response(JSON.stringify(r), { status: 200 });
  };
  fetch.calls = calls;
  return fetch;
}

// A clock that only moves when the code sleeps, so waits cost no real time.
function fakeClock(start = Date.UTC(2026, 8, 27)) {
  const clock = { t: start, sleeps: [] };
  clock.now = () => clock.t;
  clock.sleep = async ms => { clock.sleeps.push(ms); clock.t += ms; };
  return clock;
}

function threads(fetch, extra = {}) {
  const clock = extra.clock || fakeClock();
  return createThreads({ token: TOKEN, userId: UID, fetch, now: clock.now, sleep: clock.sleep, pollMs: 3000, waitMs: 45000, ...extra });
}
const textOf = result => result.content[0].text;
const FINISHED = { status: "FINISHED", id: "c1" };

test("post_to_threads creates a TEXT container, waits for FINISHED, then publishes it", async () => {
  const fetch = fakeFetch({ id: "c1" }, FINISHED, { id: "post1" });
  const result = await threads(fetch)("post_to_threads", { text: "Hello", topic_tag: "AI Agents", link: "https://github.com/x" });
  assert.equal(result.isError, undefined, textOf(result));
  assert.match(textOf(result), /Thread posted!\nID: post1/);
  const [create, status, publish] = fetch.calls;
  assert.deepEqual(create, {
    method: "POST", path: `/${UID}/threads`,
    params: { access_token: TOKEN, media_type: "TEXT", text: "Hello", topic_tag: "AI Agents", link_attachment: "https://github.com/x" }
  });
  assert.deepEqual(status, { method: "GET", path: "/c1", params: { access_token: TOKEN, fields: "status,error_message" } });
  assert.deepEqual(publish, { method: "POST", path: `/${UID}/threads_publish`, params: { access_token: TOKEN, creation_id: "c1" } });
});

test("a container still IN_PROGRESS is polled until FINISHED", async () => {
  const clock = fakeClock();
  const fetch = fakeFetch({ id: "c1" }, { status: "IN_PROGRESS" }, { status: "IN_PROGRESS" }, FINISHED, { id: "post1" });
  const result = await threads(fetch, { clock })("post_to_threads", { text: "Hi" });
  assert.match(textOf(result), /ID: post1/);
  assert.deepEqual(clock.sleeps, [3000, 3000]);
});

test("a container that ERRORs is reported with Threads' reason and never published", async () => {
  const fetch = fakeFetch({ id: "c1" }, { status: "ERROR", error_message: "FAILED_DOWNLOADING_VIDEO" });
  const result = await threads(fetch)("post_with_media", { media_urls: ["https://cdn.example.com/clip.mp4"] });
  assert.equal(result.isError, true);
  assert.match(textOf(result), /ERROR \(FAILED_DOWNLOADING_VIDEO\)/);
  assert.equal(fetch.calls.length, 2);
});

test("media still processing at the deadline returns the container ID for publish_container", async () => {
  const stillGoing = Array.from({ length: 16 }, () => ({ status: "IN_PROGRESS" }));
  const fetch = fakeFetch({ id: "c9" }, ...stillGoing);
  const result = await threads(fetch)("post_with_media", { media_urls: ["https://cdn.example.com/clip.mov"], text: "Watch" });
  assert.equal(result.isError, undefined);
  assert.match(textOf(result), /still processing[\s\S]*Container ID: c9[\s\S]*publish_container/);
  assert.ok(!fetch.calls.some(c => c.path.endsWith("/threads_publish")), "nothing published");
  assert.deepEqual(fetch.calls[0].params, { access_token: TOKEN, media_type: "VIDEO", video_url: "https://cdn.example.com/clip.mov", text: "Watch" });

  const later = fakeFetch(FINISHED, { id: "post9" });
  const done = await threads(later)("publish_container", { container_id: "c9" });
  assert.match(textOf(done), /Published!\nID: post9/);
  assert.deepEqual(later.calls[1].params, { access_token: TOKEN, creation_id: "c9" });
});

test("post_with_media turns one image URL into an IMAGE post and 2-20 URLs into a carousel", async () => {
  const single = fakeFetch({ id: "c1" }, FINISHED, { id: "p1" });
  await threads(single)("post_with_media", { media_urls: ["https://cdn.example.com/a.png"], text: "Pic" });
  assert.deepEqual(single.calls[0].params, { access_token: TOKEN, media_type: "IMAGE", image_url: "https://cdn.example.com/a.png", text: "Pic" });

  const fetch = fakeFetch(
    { id: "k1" }, { id: "k2" }, { id: "k3" },
    { status: "FINISHED" }, { status: "FINISHED" }, { status: "FINISHED" },
    { id: "car" }, { status: "FINISHED" }, { id: "p2" }
  );
  const result = await threads(fetch)("post_with_media", {
    media_urls: ["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.mp4?sig=1", "https://cdn.example.com/c.png"],
    text: "Three"
  });
  assert.match(textOf(result), /Carousel of 3 published!\nID: p2/);
  assert.deepEqual(fetch.calls.slice(0, 3).map(c => c.params), [
    { access_token: TOKEN, media_type: "IMAGE", image_url: "https://cdn.example.com/a.jpg", is_carousel_item: "true" },
    { access_token: TOKEN, media_type: "VIDEO", video_url: "https://cdn.example.com/b.mp4?sig=1", is_carousel_item: "true" },
    { access_token: TOKEN, media_type: "IMAGE", image_url: "https://cdn.example.com/c.png", is_carousel_item: "true" }
  ]);
  assert.deepEqual(fetch.calls.slice(3, 6).map(c => c.path), ["/k1", "/k2", "/k3"]);
  assert.deepEqual(fetch.calls[6].params, { access_token: TOKEN, media_type: "CAROUSEL", children: "k1,k2,k3", text: "Three" });
  assert.deepEqual(fetch.calls[8].params, { access_token: TOKEN, creation_id: "car" });
});

test("post_with_media refuses local paths and more than 20 items before calling Threads", async () => {
  const fetch = fakeFetch();
  const local = await threads(fetch)("post_with_media", { media_urls: ["C:\\Users\\me\\pic.png"] });
  assert.equal(local.isError, true);
  assert.match(textOf(local), /public http\(s\) URL/);
  const many = await threads(fetch)("post_with_media", { media_urls: Array.from({ length: 21 }, (_, i) => `https://x.com/${i}.png`) });
  assert.equal(many.isError, true);
  assert.equal(fetch.calls.length, 0);
});

test("reply_to_thread and quote_thread carry reply_to_id and quote_post_id", async () => {
  const reply = fakeFetch({ id: "c1" }, FINISHED, { id: "r1" });
  assert.match(textOf(await threads(reply)("reply_to_thread", { thread_id: "555", text: "Thanks!" })), /Reply posted!\nID: r1/);
  assert.equal(reply.calls[0].params.reply_to_id, "555");

  const quote = fakeFetch({ id: "c2" }, FINISHED, { id: "q1" });
  assert.match(textOf(await threads(quote)("quote_thread", { thread_id: "777", text: "So true" })), /Quote posted!\nID: q1/);
  assert.deepEqual(quote.calls[0].params, { access_token: TOKEN, media_type: "TEXT", text: "So true", quote_post_id: "777" });
});

test("repost_thread and delete_thread call their endpoints", async () => {
  const repost = fakeFetch({ id: "rp1" });
  assert.match(textOf(await threads(repost)("repost_thread", { thread_id: "777" })), /Repost ID: rp1/);
  assert.deepEqual(repost.calls[0], { method: "POST", path: "/777/repost", params: { access_token: TOKEN } });

  const del = fakeFetch({ success: true, deleted_id: "777" });
  assert.match(textOf(await threads(del)("delete_thread", { thread_id: "777" })), /Deleted 777/);
  assert.deepEqual(del.calls[0], { method: "DELETE", path: "/777", params: { access_token: TOKEN } });

  const refused = await threads(fakeFetch({ success: false }))("delete_thread", { thread_id: "777" });
  assert.equal(refused.isError, true);
});

test("get_replies reads top-level replies, or the whole conversation, and marks hidden and own replies", async () => {
  const fetch = fakeFetch({ data: [
    { id: "r1", username: "ali", text: "Great", timestamp: "2026-09-26T10:00:00+0000", hide_status: "NOT_HUSHED", has_replies: true },
    { id: "r2", username: "spam", text: "Buy now", timestamp: "2026-09-26T11:00:00+0000", hide_status: "HIDDEN" },
    { id: "r3", username: "me", text: "Thanks", timestamp: "2026-09-26T12:00:00+0000", is_reply_owned_by_me: true }
  ] });
  const text = textOf(await threads(fetch)("get_replies", { thread_id: "555" }));
  assert.match(text, /@ali: Great[\s\S]*\(has replies\)/);
  assert.match(text, /@spam: Buy now[\s\S]*\(hidden\)/);
  assert.match(text, /@me: Thanks[\s\S]*\(you\)/);
  assert.equal(fetch.calls[0].path, "/555/replies");
  assert.equal(fetch.calls[0].params.fields, "id,text,username,permalink,timestamp,media_type,has_replies,is_reply_owned_by_me,hide_status");
  assert.equal(fetch.calls[0].params.limit, "25");

  const all = fakeFetch({ data: [] });
  assert.match(textOf(await threads(all)("get_replies", { thread_id: "555", all: true, limit: 500 })), /No replies yet/);
  assert.equal(all.calls[0].path, "/555/conversation");
  assert.equal(all.calls[0].params.limit, "100");
});

test("hide_reply hides by default and can unhide", async () => {
  const hide = fakeFetch({ success: true });
  assert.match(textOf(await threads(hide)("hide_reply", { reply_id: "r2" })), /hidden/);
  assert.deepEqual(hide.calls[0], { method: "POST", path: "/r2/manage_reply", params: { access_token: TOKEN, hide: "true" } });
  const show = fakeFetch({ success: true });
  assert.match(textOf(await threads(show)("hide_reply", { reply_id: "r2", hide: false })), /visible again/);
  assert.equal(show.calls[0].params.hide, "false");
});

test("get_mentions lists who mentioned you", async () => {
  const fetch = fakeFetch({ data: [{ id: "m1", username: "sara", text: "cc @you", timestamp: "t", permalink: "https://www.threads.com/@sara/post/x" }] });
  assert.match(textOf(await threads(fetch)("get_mentions", {})), /@sara: cc @you[\s\S]*ID: m1/);
  assert.equal(fetch.calls[0].path, `/${UID}/mentions`);
});

test("search_threads maps its options onto keyword_search", async () => {
  const fetch = fakeFetch({ data: [{ id: "s1", username: "dev", text: "MCP servers rock", timestamp: "t", permalink: "https://www.threads.com/@dev/post/y" }] });
  const text = textOf(await threads(fetch)("search_threads", { query: "mcp", sort: "RECENT", mode: "TAG", media_type: "TEXT", author_username: "@dev", limit: 1000 }));
  assert.match(text, /@dev: MCP servers rock/);
  assert.deepEqual(fetch.calls[0], {
    method: "GET", path: "/keyword_search",
    params: {
      access_token: TOKEN, q: "mcp", search_type: "RECENT", search_mode: "TAG", media_type: "TEXT", author_username: "dev", limit: "100",
      fields: "id,text,media_type,permalink,timestamp,username,has_replies,is_quote_post,is_reply"
    }
  });
});

test("get_my_profile shows the follower count, or why it could not", async () => {
  const fetch = fakeFetch(
    { id: UID, username: "ms5373268", name: "Muhammad", threads_biography: "Agentic AI", is_verified: false },
    { data: [{ name: "followers_count", period: "day", total_value: { value: 321 } }] }
  );
  const text = textOf(await threads(fetch)("get_my_profile", {}));
  assert.match(text, /@ms5373268 \(Muhammad\)\n📝 Agentic AI\n👥 Followers: 321/);
  assert.equal(fetch.calls[0].params.fields, "id,username,name,threads_biography,is_verified");
  assert.deepEqual(fetch.calls[1].params, { access_token: TOKEN, metric: "followers_count" });

  const noInsights = fakeFetch(
    { id: UID, username: "ms5373268" },
    { error: { message: "Application does not have permission for this action", code: 10 } }
  );
  const partial = await threads(noInsights)("get_my_profile", {});
  assert.equal(partial.isError, undefined);
  assert.match(textOf(partial), /Followers: n\/a \(Threads API: Application does not have permission/);
});

test("get_my_stats totals the range, sums daily views and link clicks, and asks for followers without dates", async () => {
  const clock = fakeClock(Date.UTC(2026, 8, 27, 12));
  const until = Math.floor(clock.t / 1000);
  const fetch = fakeFetch(
    { data: [
      { name: "views", period: "day", values: [{ value: 10 }, { value: 20 }, { value: 5 }] },
      { name: "likes", period: "day", total_value: { value: 40 } },
      { name: "replies", period: "day", total_value: { value: 7 } },
      { name: "reposts", period: "day", total_value: { value: 2 } },
      { name: "quotes", period: "day", total_value: { value: 1 } }
    ] },
    { data: [{ name: "clicks", link_total_values: [{ value: 3, link_url: "https://a.dev" }, { value: 9, link_url: "https://b.dev" }] }] },
    { data: [{ name: "followers_count", total_value: { value: 150 } }] },
    { data: [{ name: "follower_demographics", total_value: { breakdowns: [{ dimension_keys: ["country"], results: [
      { dimension_values: ["US"], value: 20 }, { dimension_values: ["PK"], value: 90 }
    ] }] } }] }
  );
  const text = textOf(await threads(fetch, { clock })("get_my_stats", { days: 30, demographics: "country" }));
  assert.equal(text, [
    "📊 Last 30 days",
    "👀 Profile views: 35",
    "❤️ Likes: 40",
    "💬 Replies: 7",
    "🔁 Reposts: 2",
    "🗨️ Quotes: 1",
    "🔗 Link clicks: 12 (https://b.dev: 9, https://a.dev: 3)",
    "👥 Followers now: 150",
    "🌍 Followers by country: PK: 90, US: 20"
  ].join("\n"));
  assert.deepEqual(fetch.calls[0].params, { access_token: TOKEN, metric: "views,likes,replies,reposts,quotes", since: String(until - 30 * 86400), until: String(until) });
  assert.deepEqual(fetch.calls[2].params, { access_token: TOKEN, metric: "followers_count" });
  assert.deepEqual(fetch.calls[3].params, { access_token: TOKEN, metric: "follower_demographics", breakdown: "country" });
});

test("get_my_stats never asks for a range before 13 April 2024", async () => {
  const clock = fakeClock(Date.UTC(2024, 4, 1));
  const fetch = fakeFetch({ data: [] }, { data: [] }, { data: [] });
  await threads(fetch, { clock })("get_my_stats", { days: 365 });
  assert.equal(fetch.calls[0].params.since, "1712991600");
});

test("check_token shows validity, expiry, permissions and quota, never the token", async () => {
  const clock = fakeClock(Date.UTC(2026, 8, 27));
  const fetch = fakeFetch(
    { data: { is_valid: true, expires_at: Math.floor(Date.UTC(2026, 10, 20) / 1000), scopes: ["threads_basic", "threads_content_publish", "threads_manage_insights"] } },
    { data: [{ quota_usage: 4, config: { quota_total: 250 }, reply_quota_usage: 1, reply_config: { quota_total: 1000 }, delete_quota_usage: 0, delete_config: { quota_total: 100 } }] }
  );
  const text = textOf(await threads(fetch, { clock })("check_token", {}));
  assert.match(text, /✅ Token is valid\n⏳ Expires: 2026-11-20 \(in 54 days\)/);
  assert.match(text, /Missing: threads_read_replies \(get_replies\); threads_manage_replies \(hide_reply\)/);
  assert.match(text, /posts 4\/250, replies 1\/1000, deletes 0\/100/);
  assert.ok(!text.includes(TOKEN), "the token is never printed");
  assert.deepEqual(fetch.calls[0], { method: "GET", path: "/debug_token", params: { access_token: TOKEN, input_token: TOKEN } });
});

test("an expired token says how to renew it; a missing token or user ID never calls Threads", async () => {
  const fetch = fakeFetch({ error: { message: "Error validating access token: Session has expired", type: "OAuthException", code: 190 } });
  const expired = await threads(fetch)("get_my_threads", {});
  assert.equal(expired.isError, true);
  assert.match(textOf(expired), /Session has expired \(the access token has expired or is invalid: generate a new one, see the README\)/);

  const none = fakeFetch();
  const missing = await createThreads({ token: TOKEN, userId: undefined, fetch: none })("post_to_threads", { text: "x" });
  assert.equal(missing.isError, true);
  assert.match(textOf(missing), /THREADS_USER_ID/);
  assert.equal(none.calls.length, 0);
});

test("a non-JSON failure is reported by status and does not leak the token", async () => {
  const fetch = fakeFetch(new Response("<html>Bad Gateway</html>", { status: 502 }));
  const result = await threads(fetch)("get_my_threads", {});
  assert.equal(result.isError, true);
  assert.match(textOf(result), /Threads API 502: <html>Bad Gateway/);
  assert.ok(!textOf(result).includes(TOKEN));
});

test("get_thread_insights still reads a post's lifetime metrics", async () => {
  const fetch = fakeFetch({ data: [{ name: "views", values: [{ value: 99 }] }, { name: "likes", values: [{ value: 5 }] }] });
  assert.equal(textOf(await threads(fetch)("get_thread_insights", { thread_id: "555" })), "views: 99\nlikes: 5");
  assert.deepEqual(fetch.calls[0].params, { access_token: TOKEN, metric: "views,likes,replies,reposts,quotes" });
});

test("an unknown tool is an error", async () => {
  assert.equal((await threads(fakeFetch())("follow_everyone", {})).isError, true);
});

test("the stdio server lists every tool, reports the package version and flags errors", async () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const server = spawn(process.execPath, [fileURLToPath(new URL("../index.js", import.meta.url))], {
    env: { ...process.env, THREADS_ACCESS_TOKEN: TOKEN, THREADS_USER_ID: UID },
    stdio: ["pipe", "pipe", "inherit"]
  });
  const waiting = new Map();
  let buffer = "";
  server.stdout.on("data", chunk => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (line) { const msg = JSON.parse(line); waiting.get(msg.id)?.(msg); }
    }
  });
  const send = msg => server.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");
  const rpc = (id, method, params) => new Promise(done => { waiting.set(id, done); send({ id, method, params }); });
  try {
    const init = await rpc(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
    assert.equal(init.result.serverInfo.version, pkg.version);
    send({ method: "notifications/initialized" });
    const list = await rpc(2, "tools/list", {});
    assert.deepEqual(list.result.tools.map(t => t.name), TOOLS.map(t => t.name));
    // refused before any request leaves the machine
    const bad = await rpc(3, "tools/call", { name: "post_with_media", arguments: { media_urls: ["C:\\pic.png"] } });
    assert.equal(bad.result.isError, true);
  } finally {
    server.kill();
  }
});
