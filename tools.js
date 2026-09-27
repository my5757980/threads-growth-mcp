// The Threads API calls behind each MCP tool. index.js serves them over stdio; the tests call them with a fake fetch.
const API = "https://graph.threads.net/v1.0";
const DAY = 86400;
// user insights refuse a range that starts before 13 April 2024
const INSIGHTS_START = 1712991600;
const REPLY_FIELDS = "id,text,username,permalink,timestamp,media_type,has_replies,is_reply_owned_by_me,hide_status";
const SEARCH_FIELDS = "id,text,media_type,permalink,timestamp,username,has_replies,is_quote_post,is_reply";
// what each permission unlocks, for check_token
const SCOPES = {
  threads_basic: "every tool",
  threads_content_publish: "posting, replying, quoting, reposting",
  threads_read_replies: "get_replies",
  threads_manage_replies: "hide_reply",
  threads_manage_insights: "get_my_stats, followers in get_my_profile, get_thread_insights",
  threads_keyword_search: "search_threads beyond your own posts, replying to other people's threads",
  threads_manage_mentions: "get_mentions, replying to other people's threads",
  threads_delete: "delete_thread"
};
const THREAD_ID = { type: "string", description: "The post's media ID, as get_my_threads, search_threads, get_replies and get_mentions print it" };
const LIMIT = max => ({ type: "number", description: `How many to show (default 25, max ${max})` });

export const TOOLS = [
  {
    name: "post_to_threads",
    description: "Publish a new text post on Threads",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The post text (max 500 characters; an emoji counts as its UTF-8 bytes)" },
        topic_tag: { type: "string", description: "Optional topic, 1-50 characters without periods or ampersands; helps people find the post" },
        link: { type: "string", description: "Optional URL to show as a link preview card" }
      },
      required: ["text"]
    }
  },
  {
    name: "post_with_media",
    description: "Publish a Threads post with images and/or videos. One URL makes an image or video post, 2-20 make a carousel. Threads downloads the files itself, so they must be public http(s) URLs, not paths on this computer",
    inputSchema: {
      type: "object",
      properties: {
        media_urls: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 20, description: "Public URLs of the images (JPEG/PNG, max 8 MB) and videos (MP4/MOV, max 5 minutes)" },
        text: { type: "string", description: "Optional post text" },
        media_type: { type: "string", enum: ["IMAGE", "VIDEO"], description: "Optional. By default a .mp4/.mov/.m4v URL is a video and anything else an image" }
      },
      required: ["media_urls"]
    }
  },
  {
    name: "publish_container",
    description: "Publish a post that was still processing when post_with_media returned (a video can take a few minutes)",
    inputSchema: {
      type: "object",
      properties: { container_id: { type: "string", description: "The container ID post_with_media printed" } },
      required: ["container_id"]
    }
  },
  {
    name: "reply_to_thread",
    description: "Reply to a thread or to a reply. Always works under your own threads; replying to someone else's needs the threads_keyword_search or threads_manage_mentions permission, so find those posts with search_threads or get_mentions",
    inputSchema: {
      type: "object",
      properties: {
        thread_id: THREAD_ID,
        text: { type: "string", description: "The reply text" }
      },
      required: ["thread_id", "text"]
    }
  },
  {
    name: "quote_thread",
    description: "Quote a thread: publish your own text with that post embedded under it",
    inputSchema: {
      type: "object",
      properties: {
        thread_id: THREAD_ID,
        text: { type: "string", description: "Your text above the quoted post" }
      },
      required: ["thread_id", "text"]
    }
  },
  {
    name: "repost_thread",
    description: "Repost a thread to your profile",
    inputSchema: {
      type: "object",
      properties: { thread_id: THREAD_ID },
      required: ["thread_id"]
    }
  },
  {
    name: "delete_thread",
    description: "Delete one of your own threads or replies (Threads allows 100 deletes a day)",
    inputSchema: {
      type: "object",
      properties: { thread_id: THREAD_ID },
      required: ["thread_id"]
    }
  },
  {
    name: "get_my_threads",
    description: "Show your recent Threads posts",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "How many posts (default 10)" }
      }
    }
  },
  {
    name: "get_replies",
    description: "Read the replies to a thread, newest first, with who wrote them and whether a reply is hidden",
    inputSchema: {
      type: "object",
      properties: {
        thread_id: THREAD_ID,
        all: { type: "boolean", description: "true = nested replies too (use on a top-level post); false (default) = top-level replies only" },
        limit: LIMIT(100)
      },
      required: ["thread_id"]
    }
  },
  {
    name: "hide_reply",
    description: "Hide a top-level reply to your thread, or unhide it; its nested replies follow",
    inputSchema: {
      type: "object",
      properties: {
        reply_id: { type: "string", description: "The reply's ID, from get_replies" },
        hide: { type: "boolean", description: "true (default) hides, false shows it again" }
      },
      required: ["reply_id"]
    }
  },
  {
    name: "get_mentions",
    description: "Posts in which other people @mentioned you",
    inputSchema: {
      type: "object",
      properties: { limit: LIMIT(100) }
    }
  },
  {
    name: "search_threads",
    description: "Search public Threads posts by keyword or topic tag. Until Meta approves the app for threads_keyword_search it only searches your own posts. 2,200 searches a day",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The keyword(s), or the topic when mode is TAG" },
        sort: { type: "string", enum: ["TOP", "RECENT"], description: "TOP (default) = most popular, RECENT = newest" },
        mode: { type: "string", enum: ["KEYWORD", "TAG"], description: "KEYWORD (default) or TAG (topic tag search)" },
        media_type: { type: "string", enum: ["TEXT", "IMAGE", "VIDEO"], description: "Optional: only this kind of post" },
        author_username: { type: "string", description: "Optional: only posts by this exact username" },
        limit: { type: "number", description: "How many results (default 10, max 100)" }
      },
      required: ["query"]
    }
  },
  {
    name: "get_my_profile",
    description: "Show your Threads profile: username, name, bio, verified badge and follower count",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_my_stats",
    description: "Your account's totals for the last N days: profile views, likes, replies, reposts, quotes and link clicks, plus followers now. Use it to see what is and is not growing",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "How many days back (default 7, max 365)" },
        demographics: { type: "string", enum: ["country", "city", "age", "gender"], description: "Optional follower breakdown (needs at least 100 followers)" }
      }
    }
  },
  {
    name: "get_thread_insights",
    description: "A thread's insights: views, likes, replies, reposts, quotes",
    inputSchema: {
      type: "object",
      properties: {
        thread_id: THREAD_ID
      },
      required: ["thread_id"]
    }
  },
  {
    name: "check_token",
    description: "Check the Threads access token without showing it: valid or not, when it expires, which permissions it has, and the last 24 hours' post/reply/delete quota",
    inputSchema: { type: "object", properties: {} }
  }
];

const ok = text => ({ content: [{ type: "text", text }] });
const clamp = (n, lo, hi, fallback) => Math.min(hi, Math.max(lo, Math.round(Number(n)) || fallback));
const isVideo = url => /\.(mp4|mov|m4v)([?#]|$)/i.test(url);

// A metric's number: total_value for a total, the sum of the days for a time series (views), the sum over links for clicks.
function metricValue(m) {
  if (!m) return null;
  if (typeof m.total_value?.value === "number") return m.total_value.value;
  const list = m.values || m.link_total_values;
  return Array.isArray(list) ? list.reduce((sum, v) => sum + (v.value || 0), 0) : null;
}

function breakdown(m) {
  const results = m?.total_value?.breakdowns?.[0]?.results;
  if (!Array.isArray(results)) return JSON.stringify(m?.total_value ?? {});
  return [...results].sort((a, b) => b.value - a.value).slice(0, 10)
    .map(r => `${(r.dimension_values || []).join("/")}: ${r.value}`).join(", ") || "none yet";
}

const reason = settled => settled.reason?.message || String(settled.reason);

export function createThreads({
  token,
  userId,
  fetch = globalThis.fetch,
  sleep = ms => new Promise(done => setTimeout(done, ms)),
  now = () => Date.now(),
  pollMs = 3000,
  waitMs = 45000
} = {}) {
  async function tapi(path, params = {}, method = "GET") {
    if (!token || !userId) throw new Error("THREADS_ACCESS_TOKEN and THREADS_USER_ID must both be set in the MCP config");
    const url = new URL(`${API}${path}`);
    url.searchParams.set("access_token", token);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
    }
    const res = await fetch(url, { method });
    const body = await res.text();
    let data = null;
    try { data = body ? JSON.parse(body) : {}; } catch { /* not JSON */ }
    if (data?.error) {
      const expired = data.error.code === 190 ? " (the access token has expired or is invalid: generate a new one, see the README)" : "";
      throw new Error(`Threads API: ${data.error.message}${expired}`);
    }
    if (!res.ok || data === null) throw new Error(`Threads API ${res.status}: ${body.substring(0, 300)}`);
    return data;
  }

  // Threads has to fetch and process a container's media before it can be published (status FINISHED).
  // Returns false when it is still IN_PROGRESS at the deadline.
  async function ready(id, deadline) {
    for (;;) {
      const { status, error_message } = await tapi(`/${id}`, { fields: "status,error_message" });
      if (status === "ERROR" || status === "EXPIRED") {
        throw new Error(`Threads could not process container ${id}: ${status}${error_message ? ` (${error_message})` : ""}`);
      }
      if (status === "PUBLISHED") throw new Error(`container ${id} is already published`);
      if (status !== "IN_PROGRESS") return true;
      if (now() + pollMs > deadline) return false;
      await sleep(pollMs);
    }
  }

  // { id } of the published post, or { pending } with the container ID when the media is still processing.
  // The wait stays well under an MCP client's request timeout; publish_container finishes the job later.
  async function publish(containerId, deadline = now() + waitMs) {
    if (!(await ready(containerId, deadline))) return { pending: containerId };
    const published = await tapi(`/${userId}/threads_publish`, { creation_id: containerId }, "POST");
    return { id: published.id };
  }

  async function postThread(params) {
    const container = await tapi(`/${userId}/threads`, params, "POST");
    return publish(container.id);
  }

  function posted({ id, pending }, what) {
    if (pending) {
      return ok(`⏳ Threads is still processing the media, so it is not published yet.\nContainer ID: ${pending}\nRun publish_container with this ID in a minute or two.`);
    }
    return ok(`✅ ${what}!\nID: ${id}`);
  }

  const listPosts = (data, empty) => (data.data || []).map(t =>
    `📝 ${t.username ? `@${t.username}: ` : ""}${(t.text || "").substring(0, 200)}\n🕐 ${t.timestamp}${t.permalink ? `\n🔗 ${t.permalink}` : ""}\nID: ${t.id}`
  ).join("\n---\n") || empty;

  return async function callTool(name, args = {}) {
    try {
      if (name === "post_to_threads") {
        return posted(await postThread({ media_type: "TEXT", text: args.text, topic_tag: args.topic_tag, link_attachment: args.link }), "Thread posted");
      }

      if (name === "reply_to_thread") {
        return posted(await postThread({ media_type: "TEXT", text: args.text, reply_to_id: args.thread_id }), "Reply posted");
      }

      if (name === "quote_thread") {
        return posted(await postThread({ media_type: "TEXT", text: args.text, quote_post_id: args.thread_id }), "Quote posted");
      }

      if (name === "post_with_media") {
        const urls = Array.isArray(args.media_urls) ? args.media_urls : [args.media_urls].filter(Boolean);
        if (urls.length < 1 || urls.length > 20) throw new Error("media_urls needs 1 to 20 public URLs");
        const local = urls.find(u => !/^https?:\/\//i.test(String(u)));
        if (local) throw new Error(`Threads downloads the media itself, so it needs a public http(s) URL; "${local}" is not one`);
        const media = url => ((args.media_type || (isVideo(url) ? "VIDEO" : "IMAGE")) === "VIDEO"
          ? { media_type: "VIDEO", video_url: url }
          : { media_type: "IMAGE", image_url: url });
        const deadline = now() + waitMs;
        if (urls.length === 1) {
          const container = await tapi(`/${userId}/threads`, { ...media(urls[0]), text: args.text }, "POST");
          return posted(await publish(container.id, deadline), "Media post published");
        }
        const children = [];
        for (const url of urls) {
          children.push((await tapi(`/${userId}/threads`, { ...media(url), is_carousel_item: true }, "POST")).id);
        }
        // a child that fails stops here; one still processing at the deadline is left to the carousel container
        for (const child of children) await ready(child, deadline);
        const carousel = await tapi(`/${userId}/threads`, { media_type: "CAROUSEL", children: children.join(","), text: args.text }, "POST");
        return posted(await publish(carousel.id, deadline), `Carousel of ${children.length} published`);
      }

      if (name === "publish_container") {
        return posted(await publish(args.container_id), "Published");
      }

      if (name === "repost_thread") {
        const repost = await tapi(`/${args.thread_id}/repost`, {}, "POST");
        return ok(`🔁 Reposted!\nRepost ID: ${repost.id}`);
      }

      if (name === "delete_thread") {
        const result = await tapi(`/${args.thread_id}`, {}, "DELETE");
        if (!result.success) throw new Error(`Threads did not confirm the delete: ${JSON.stringify(result)}`);
        return ok(`🗑️ Deleted ${result.deleted_id || args.thread_id}`);
      }

      if (name === "get_my_threads") {
        const limit = args.limit || 10;
        const data = await tapi(`/${userId}/threads`, {
          fields: "id,text,timestamp,permalink",
          limit
        });
        const list = data.data?.map(t => `📝 ${(t.text || "").substring(0, 80)}\n🕐 ${t.timestamp}\n🔗 ${t.permalink}\nID: ${t.id}`).join("\n---\n") || "No posts found";
        return ok(list);
      }

      if (name === "get_replies") {
        const edge = args.all ? "conversation" : "replies";
        const data = await tapi(`/${args.thread_id}/${edge}`, { fields: REPLY_FIELDS, limit: clamp(args.limit, 1, 100, 25) });
        const list = (data.data || []).map(r => {
          const flags = [
            r.is_reply_owned_by_me ? "you" : null,
            ["HIDDEN", "COVERED", "BLOCKED", "RESTRICTED"].includes(r.hide_status) ? r.hide_status.toLowerCase() : null,
            r.has_replies ? "has replies" : null
          ].filter(Boolean);
          return `💬 @${r.username || "?"}: ${(r.text || "").substring(0, 200)}\n🕐 ${r.timestamp}${flags.length ? `  (${flags.join(", ")})` : ""}\nID: ${r.id}`;
        }).join("\n---\n");
        return ok(list || "No replies yet");
      }

      if (name === "hide_reply") {
        const hide = args.hide !== false;
        const result = await tapi(`/${args.reply_id}/manage_reply`, { hide }, "POST");
        if (!result.success) throw new Error(`Threads did not confirm: ${JSON.stringify(result)}`);
        return ok(hide ? `🙈 Reply ${args.reply_id} hidden` : `👀 Reply ${args.reply_id} is visible again`);
      }

      if (name === "get_mentions") {
        const data = await tapi(`/${userId}/mentions`, { fields: "id,text,username,permalink,timestamp", limit: clamp(args.limit, 1, 100, 25) });
        return ok(listPosts(data, "No mentions found"));
      }

      if (name === "search_threads") {
        const data = await tapi("/keyword_search", {
          q: args.query,
          search_type: args.sort,
          search_mode: args.mode,
          media_type: args.media_type,
          author_username: args.author_username?.replace(/^@/, ""),
          limit: clamp(args.limit, 1, 100, 10),
          fields: SEARCH_FIELDS
        });
        return ok(listPosts(data, "Nothing found (Threads only searches your own posts until the app is approved for threads_keyword_search)"));
      }

      if (name === "get_my_profile") {
        const [profile, followers] = await Promise.allSettled([
          tapi(`/${userId}`, { fields: "id,username,name,threads_biography,is_verified" }),
          tapi(`/${userId}/threads_insights`, { metric: "followers_count" })
        ]);
        if (profile.status === "rejected") throw profile.reason;
        const data = profile.value;
        const count = followers.status === "fulfilled" ? metricValue(followers.value.data?.[0]) ?? 0 : `n/a (${reason(followers)})`;
        return ok(`👤 @${data.username}${data.name ? ` (${data.name})` : ""}${data.is_verified ? " ✔️ verified" : ""}\n📝 ${data.threads_biography || ""}\n👥 Followers: ${count}\nID: ${data.id}`);
      }

      if (name === "get_my_stats") {
        const days = clamp(args.days, 1, 365, 7);
        const until = Math.floor(now() / 1000);
        const since = Math.max(until - days * DAY, INSIGHTS_START);
        const insights = params => tapi(`/${userId}/threads_insights`, params);
        const [main, clicks, followers, demographics] = await Promise.allSettled([
          insights({ metric: "views,likes,replies,reposts,quotes", since, until }),
          insights({ metric: "clicks", since, until }),
          // follower metrics take no date range
          insights({ metric: "followers_count" }),
          args.demographics ? insights({ metric: "follower_demographics", breakdown: args.demographics }) : null
        ]);
        if (main.status === "rejected") throw main.reason;
        const total = Object.fromEntries((main.value.data || []).map(m => [m.name, metricValue(m)]));
        let clickLine = `n/a (${reason(clicks)})`;
        if (clicks.status === "fulfilled") {
          const m = clicks.value.data?.[0];
          const top = (m?.link_total_values || []).filter(l => l.link_url).sort((a, b) => b.value - a.value).slice(0, 3);
          clickLine = `${metricValue(m) ?? 0}${top.length ? ` (${top.map(l => `${l.link_url}: ${l.value}`).join(", ")})` : ""}`;
        }
        const lines = [
          `📊 Last ${days} day${days === 1 ? "" : "s"}`,
          `👀 Profile views: ${total.views ?? 0}`,
          `❤️ Likes: ${total.likes ?? 0}`,
          `💬 Replies: ${total.replies ?? 0}`,
          `🔁 Reposts: ${total.reposts ?? 0}`,
          `🗨️ Quotes: ${total.quotes ?? 0}`,
          `🔗 Link clicks: ${clickLine}`,
          `👥 Followers now: ${followers.status === "fulfilled" ? metricValue(followers.value.data?.[0]) ?? 0 : `n/a (${reason(followers)})`}`
        ];
        if (args.demographics) {
          lines.push(`🌍 Followers by ${args.demographics}: ${demographics.status === "fulfilled" ? breakdown(demographics.value.data?.[0]) : `n/a (${reason(demographics)})`}`);
        }
        return ok(lines.join("\n"));
      }

      if (name === "get_thread_insights") {
        const data = await tapi(`/${args.thread_id}/insights`, {
          metric: "views,likes,replies,reposts,quotes"
        });
        const metrics = data.data?.map(m => `${m.name}: ${m.values?.[0]?.value ?? m.total_value?.value ?? 0}`).join("\n") || "No insights";
        return ok(metrics);
      }

      if (name === "check_token") {
        const [info, quota] = await Promise.allSettled([
          tapi("/debug_token", { input_token: token }),
          tapi(`/${userId}/threads_publishing_limit`, { fields: "quota_usage,config,reply_quota_usage,reply_config,delete_quota_usage,delete_config" })
        ]);
        if (info.status === "rejected") throw info.reason;
        const d = info.value.data || {};
        const scopes = d.scopes || [];
        const missing = Object.keys(SCOPES).filter(s => !scopes.includes(s));
        let expiry = "never";
        if (d.expires_at) {
          const left = Math.ceil((d.expires_at * 1000 - now()) / (DAY * 1000));
          expiry = `${new Date(d.expires_at * 1000).toISOString().slice(0, 10)} (${left > 0 ? `in ${left} day${left === 1 ? "" : "s"}` : "expired"})`;
        }
        const lines = [
          d.is_valid ? "✅ Token is valid" : "❌ Token is NOT valid",
          `⏳ Expires: ${expiry}`,
          `🔑 Permissions: ${scopes.join(", ") || "none"}`,
          missing.length
            ? `⚠️ Missing: ${missing.map(s => `${s} (${SCOPES[s]})`).join("; ")}`
            : "✅ Every permission these tools use is granted"
        ];
        if (quota.status === "fulfilled") {
          const q = quota.value.data?.[0] || {};
          lines.push(`📮 Last 24 h: posts ${q.quota_usage ?? "?"}/${q.config?.quota_total ?? "?"}, replies ${q.reply_quota_usage ?? "?"}/${q.reply_config?.quota_total ?? "?"}, deletes ${q.delete_quota_usage ?? "?"}/${q.delete_config?.quota_total ?? "?"}`);
        } else {
          lines.push(`📮 Quota: n/a (${reason(quota)})`);
        }
        return ok(lines.join("\n"));
      }

      return { content: [{ type: "text", text: `❌ Unknown tool: ${name}` }], isError: true };
    } catch (err) {
      return { content: [{ type: "text", text: `❌ Error: ${err.message}` }], isError: true };
    }
  };
}
