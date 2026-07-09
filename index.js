#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, ".env") });

const TOKEN = process.env.THREADS_ACCESS_TOKEN;
const USER_ID = process.env.THREADS_USER_ID;
const API = "https://graph.threads.net/v1.0";

async function tapi(path, params = {}, method = "GET") {
  const url = new URL(`${API}${path}`);
  url.searchParams.set("access_token", TOKEN);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { method });
  const data = await res.json();
  if (data.error) throw new Error(`Threads API: ${data.error.message}`);
  return data;
}

async function postThread(text, replyToId = null) {
  const params = { media_type: "TEXT", text };
  if (replyToId) params.reply_to_id = replyToId;
  const container = await tapi(`/${USER_ID}/threads`, params, "POST");
  const published = await tapi(`/${USER_ID}/threads_publish`, { creation_id: container.id }, "POST");
  return published;
}

const server = new Server(
  { name: "threads-growth-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "post_to_threads",
      description: "Threads pe naya text post publish karo",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Post ka content (max 500 characters)" }
        },
        required: ["text"]
      }
    },
    {
      name: "reply_to_thread",
      description: "Kisi thread/post ka reply karo",
      inputSchema: {
        type: "object",
        properties: {
          thread_id: { type: "string", description: "Jis post ka reply karna hai uska ID" },
          text: { type: "string", description: "Reply ka content" }
        },
        required: ["thread_id", "text"]
      }
    },
    {
      name: "get_my_threads",
      description: "Apne recent Threads posts dekho",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Kitne posts (default 10)" }
        }
      }
    },
    {
      name: "get_my_profile",
      description: "Apni Threads profile info dekho (username, bio, followers)",
      inputSchema: { type: "object", properties: {} }
    },
    {
      name: "get_thread_insights",
      description: "Kisi thread ke insights dekho (views, likes, replies)",
      inputSchema: {
        type: "object",
        properties: {
          thread_id: { type: "string", description: "Thread ID jiske insights chahiye" }
        },
        required: ["thread_id"]
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    if (name === "post_to_threads") {
      const result = await postThread(args.text);
      return { content: [{ type: "text", text: `✅ Thread posted!\nID: ${result.id}` }] };
    }

    if (name === "reply_to_thread") {
      const result = await postThread(args.text, args.thread_id);
      return { content: [{ type: "text", text: `✅ Reply posted!\nID: ${result.id}` }] };
    }

    if (name === "get_my_threads") {
      const limit = args.limit || 10;
      const data = await tapi(`/${USER_ID}/threads`, {
        fields: "id,text,timestamp,permalink",
        limit
      });
      const list = data.data?.map(t => `📝 ${(t.text || "").substring(0, 80)}\n🕐 ${t.timestamp}\n🔗 ${t.permalink}\nID: ${t.id}`).join("\n---\n") || "Koi post nahi mila";
      return { content: [{ type: "text", text: list }] };
    }

    if (name === "get_my_profile") {
      const data = await tapi(`/${USER_ID}`, {
        fields: "id,username,threads_biography,threads_profile_picture_url"
      });
      return {
        content: [{
          type: "text",
          text: `👤 @${data.username}\n📝 ${data.threads_biography || ""}\nID: ${data.id}`
        }]
      };
    }

    if (name === "get_thread_insights") {
      const data = await tapi(`/${args.thread_id}/insights`, {
        metric: "views,likes,replies,reposts,quotes"
      });
      const metrics = data.data?.map(m => `${m.name}: ${m.values?.[0]?.value ?? m.total_value?.value ?? 0}`).join("\n") || "No insights";
      return { content: [{ type: "text", text: metrics }] };
    }

    return { content: [{ type: "text", text: `❌ Unknown tool: ${name}` }] };
  } catch (err) {
    return { content: [{ type: "text", text: `❌ Error: ${err.message}` }] };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
