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
  threads_delete: "delete_thread",
  threads_location_tagging: "search_locations, location_id on posts",
  threads_profile_discovery: "lookup_profile",
  threads_share_to_instagram: "share_to_instagram on posts"
};
const THREAD_ID = { type: "string", description: "The post's media ID, as get_my_threads, search_threads, get_replies and get_mentions print it" };
const LIMIT = max => ({ type: "number", description: `How many to show (default 25, max ${max})` });
const REPLY_CONTROLS = ["everyone", "accounts_you_follow", "mentioned_only", "parent_post_author_only", "followers_only"];
const POLL_FIELDS = "id,text,poll_attachment{option_a,option_b,option_c,option_d,option_a_votes_percentage,option_b_votes_percentage,option_c_votes_percentage,option_d_votes_percentage,total_votes,expiration_timestamp}";
// options every new post can take
const POST_OPTIONS = {
  reply_control: { type: "string", enum: REPLY_CONTROLS, description: "Optional: who may reply (default everyone)" },
  reply_approvals: { type: "boolean", description: "true = replies wait for your approval before anyone else sees them" },
  location_id: { type: "string", description: "Optional place ID from search_locations (needs the threads_location_tagging permission)" },
  countries: { type: "array", items: { type: "string" }, description: "Optional: show the post only in these countries (2-letter codes such as PK, US, GB)" },
  share_to_instagram: { type: "boolean", description: "true = also share the post to your linked Instagram (needs the threads_share_to_instagram permission)" }
};

export const TOOLS = [
  {
    name: "post_to_threads",
    description: "Publish a new text post on Threads. Optionally add a poll, a GIF, a long text attachment, spoilers, reply limits, a location or a country limit, or make it a ghost post that Threads archives after 24 hours",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The post text (max 500 characters; an emoji counts as its UTF-8 bytes)" },
        topic_tag: { type: "string", description: "Optional topic, 1-50 characters without periods or ampersands; helps people find the post" },
        link: { type: "string", description: "Optional URL to show as a link preview card" },
        poll_options: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4, description: "Optional poll: 2 to 4 answers, each 1-25 characters" },
        gif_id: { type: "string", description: "Optional GIPHY GIF ID to attach (GIPHY is the only GIF provider Threads accepts)" },
        long_text: { type: "string", description: "Optional text attachment of up to 10,000 characters shown with the post; not allowed on a poll" },
        long_text_link: { type: "string", description: "Optional link inside the long text attachment; not together with link" },
        spoiler_phrases: { type: "array", items: { type: "string" }, maxItems: 10, description: "Optional: up to 10 exact phrases from the text to hide as spoilers" },
        ghost: { type: "boolean", description: "true = ghost post: Threads archives it after 24 hours, and it can carry only text and text spoilers" },
        ...POST_OPTIONS
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
        media_type: { type: "string", enum: ["IMAGE", "VIDEO"], description: "Optional. By default a .mp4/.mov/.m4v URL is a video and anything else an image" },
        alt_texts: { type: "array", items: { type: "string" }, description: "Optional alt text for each image or video, in the same order (max 1,000 characters each)" },
        spoiler: { type: "boolean", description: "true = blur the media as a spoiler until tapped" },
        ...POST_OPTIONS
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
    name: "get_my_replies",
    description: "The replies you have written on Threads, newest first",
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
    name: "lookup_profile",
    description: "Look up another public Threads profile by its exact username: bio, followers, and its views, likes, quotes and reposts over the past 7 days. Needs the threads_profile_discovery permission; until Meta grants advanced access it only finds @meta, @threads, @instagram and @facebook. Only profiles with 100+ followers; 1,000 lookups a day",
    inputSchema: {
      type: "object",
      properties: { username: { type: "string", description: "The exact username, with or without @" } },
      required: ["username"]
    }
  },
  {
    name: "search_locations",
    description: "Find a place to tag in a post: pass its ID as location_id. Needs the threads_location_tagging permission; until Meta approves it, every search returns results for Menlo Park only. 500 searches a day",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The place name, e.g. 'Lahore' or 'Packages Mall'" },
        latitude: { type: "number", description: "Optional latitude, to search near a point (give longitude too)" },
        longitude: { type: "number", description: "Optional longitude, to search near a point (give latitude too)" }
      }
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
    description: "A thread's insights: views, likes, replies, reposts, quotes and shares",
    inputSchema: {
      type: "object",
      properties: {
        thread_id: THREAD_ID
      },
      required: ["thread_id"]
    }
  },
  {
    name: "get_poll_results",
    description: "The votes on one of your Threads polls: each answer's share, total votes and when voting closes",
    inputSchema: {
      type: "object",
      properties: { thread_id: THREAD_ID },
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

// The POST_OPTIONS a caller set, as container parameters. Throws before anything is sent.
function postOptions(args) {
  const out = {};
  if (args.reply_control !== undefined) {
    const control = String(args.reply_control).toLowerCase();
    if (!REPLY_CONTROLS.includes(control)) throw new Error(`reply_control must be one of ${REPLY_CONTROLS.join(", ")}`);
    out.reply_control = control;
  }
  if (args.reply_approvals) out.enable_reply_approvals = true;
  if (args.location_id) out.location_id = String(args.location_id);
  if (args.countries !== undefined) {
    const codes = (Array.isArray(args.countries) ? args.countries : String(args.countries).split(","))
      .map(c => String(c ?? "").trim().toUpperCase()).filter(Boolean);
    const bad = codes.find(c => !/^[A-Z]{2}$/.test(c));
    if (!codes.length || bad !== undefined) throw new Error(`countries must be 2-letter codes such as PK or US${bad !== undefined ? `, not "${bad}"` : ""}`);
    out.allowlisted_country_codes = codes.join(",");
  }
  if (args.share_to_instagram) out.crossreshare_to_ig = true;
  return out;
}

// A text post's poll, GIF, text attachment, spoilers and ghost flag, checked against Threads' rules.
function textExtras(args) {
  const out = {};
  if (args.poll_options !== undefined) {
    const options = (Array.isArray(args.poll_options) ? args.poll_options : []).map(o => String(o ?? "").trim());
    if (options.length < 2 || options.length > 4) throw new Error(`a poll takes 2 to 4 options, not ${options.length}`);
    const bad = options.find(o => !o || o.length > 25);
    if (bad !== undefined) throw new Error(`each poll option must be 1 to 25 characters: "${bad}"`);
    out.poll_attachment = JSON.stringify(Object.fromEntries(options.map((o, i) => [`option_${"abcd"[i]}`, o])));
  }
  if (args.gif_id) out.gif_attachment = JSON.stringify({ gif_id: String(args.gif_id), provider: "GIPHY" });
  if (args.long_text !== undefined) {
    const plaintext = String(args.long_text);
    if (!plaintext.trim() || plaintext.length > 10000) throw new Error("long_text must be 1 to 10,000 characters");
    if (out.poll_attachment) throw new Error("Threads does not allow a long text attachment on a post with a poll");
    if (args.long_text_link && args.link) throw new Error("use link or long_text_link, not both: Threads allows one link attachment per post");
    out.text_attachment = JSON.stringify({ plaintext, ...(args.long_text_link ? { link_attachment_url: String(args.long_text_link) } : {}) });
  }
  const phrases = Array.isArray(args.spoiler_phrases) ? args.spoiler_phrases : [];
  if (phrases.length > 10) throw new Error("Threads allows at most 10 spoilers per post");
  if (phrases.length) {
    const text = String(args.text ?? "");
    out.text_entities = JSON.stringify(phrases.map(p => {
      const phrase = String(p ?? "");
      const offset = phrase ? text.indexOf(phrase) : -1;
      if (offset < 0) throw new Error(`spoiler "${phrase}" is not in the post text`);
      return { entity_type: "SPOILER", offset, length: phrase.length };
    }));
  }
  if (args.ghost) {
    if (out.poll_attachment || out.gif_attachment || out.text_attachment || args.link) {
      throw new Error("a ghost post can carry only text and text spoilers: no poll, GIF, link or long text");
    }
    out.is_ghost_post = true;
  }
  return out;
}

const percent = v => (typeof v === "number" ? `${Math.round(v <= 1 ? v * 100 : v)}%` : "?");

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
        const params = { media_type: "TEXT", text: args.text, topic_tag: args.topic_tag, link_attachment: args.link, ...textExtras(args), ...postOptions(args) };
        return posted(await postThread(params), args.ghost ? "Ghost post published (Threads archives it after 24 hours)" : "Thread posted");
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
        const alts = Array.isArray(args.alt_texts) ? args.alt_texts.map(a => String(a ?? "")) : [];
        if (alts.some(a => a.length > 1000)) throw new Error("each alt text can be at most 1,000 characters");
        // checked before the first container is made
        const extras = { ...(args.spoiler ? { is_spoiler_media: true } : {}), ...postOptions(args) };
        const media = (url, i) => ({
          ...((args.media_type || (isVideo(url) ? "VIDEO" : "IMAGE")) === "VIDEO"
            ? { media_type: "VIDEO", video_url: url }
            : { media_type: "IMAGE", image_url: url }),
          ...(alts[i] ? { alt_text: alts[i] } : {})
        });
        const deadline = now() + waitMs;
        if (urls.length === 1) {
          const container = await tapi(`/${userId}/threads`, { ...media(urls[0], 0), text: args.text, ...extras }, "POST");
          return posted(await publish(container.id, deadline), "Media post published");
        }
        const children = [];
        for (const [i, url] of urls.entries()) {
          children.push((await tapi(`/${userId}/threads`, { ...media(url, i), is_carousel_item: true }, "POST")).id);
        }
        // a child that fails stops here; one still processing at the deadline is left to the carousel container
        for (const child of children) await ready(child, deadline);
        const carousel = await tapi(`/${userId}/threads`, { media_type: "CAROUSEL", children: children.join(","), text: args.text, ...extras }, "POST");
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

      if (name === "get_my_replies") {
        const data = await tapi(`/${userId}/replies`, { fields: "id,text,permalink,timestamp", limit: clamp(args.limit, 1, 100, 25) });
        return ok(listPosts(data, "You have not replied to anything yet"));
      }

      if (name === "lookup_profile") {
        const username = String(args.username ?? "").trim().replace(/^@/, "");
        if (!username) throw new Error("username is required");
        const p = await tapi("/profile_lookup", { username });
        return ok([
          `👤 @${p.username || username}${p.name ? ` (${p.name})` : ""}${p.is_verified ? " ✔️ verified" : ""}`,
          `📝 ${p.biography || ""}`,
          `👥 Followers: ${p.follower_count ?? "?"}`,
          `📈 Past 7 days: views ${p.views_count ?? "?"}, likes ${p.likes_count ?? "?"}, quotes ${p.quotes_count ?? "?"}, reposts ${p.reposts_count ?? "?"}`
        ].join("\n"));
      }

      if (name === "search_locations") {
        const near = args.latitude !== undefined && args.longitude !== undefined
          && Number.isFinite(Number(args.latitude)) && Number.isFinite(Number(args.longitude));
        if (!args.query && !near) throw new Error("give a query, or both latitude and longitude");
        const data = await tapi("/location_search", {
          q: args.query,
          ...(near ? { latitude: Number(args.latitude), longitude: Number(args.longitude) } : {}),
          fields: "id,name,address,city,country"
        });
        const list = (data.data || []).map(l => {
          const where = [l.address, l.city, l.country].filter(Boolean).join(", ");
          return `📍 ${l.name}${where ? ` (${where})` : ""}\nID: ${l.id}`;
        }).join("\n---\n");
        return ok(list || "No places found");
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
          metric: "views,likes,replies,reposts,quotes,shares"
        });
        const metrics = data.data?.map(m => `${m.name}: ${m.values?.[0]?.value ?? m.total_value?.value ?? 0}`).join("\n") || "No insights";
        return ok(metrics);
      }

      if (name === "get_poll_results") {
        const data = await tapi(`/${args.thread_id}`, { fields: POLL_FIELDS });
        const poll = data.poll_attachment;
        if (!poll) return ok(`${args.thread_id} has no poll`);
        const answers = ["a", "b", "c", "d"].filter(k => poll[`option_${k}`])
          .map(k => `• ${poll[`option_${k}`]}: ${percent(poll[`option_${k}_votes_percentage`])}`);
        return ok([
          `📊 ${data.text ? data.text.substring(0, 100) : "Poll"}`,
          ...answers,
          `🗳️ Total votes: ${poll.total_votes ?? 0}`,
          `⏰ Voting closes: ${poll.expiration_timestamp || "?"}`
        ].join("\n"));
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
