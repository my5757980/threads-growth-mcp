# threads-growth-mcp

Custom **MCP (Model Context Protocol) server** for Threads (Meta) — post, reply, and read insights via the official free Threads API.

Published on npm: [`@mj4384963/threads-growth-mcp`](https://www.npmjs.com/package/@mj4384963/threads-growth-mcp)

## 5 Tools

| Tool | What it does |
|------|-------------|
| `post_to_threads` | Publish a new text thread |
| `reply_to_thread` | Reply to any thread by ID |
| `get_my_threads` | Fetch your recent threads |
| `get_my_profile` | Get profile info (username, bio) |
| `get_thread_insights` | Views, likes, replies, reposts, quotes for a thread |

> Note: Threads' official API does not support follow/discover endpoints — those still require browser automation. Posting, replying, and insights are fully official & free.

## Setup (one time)

### 1. Create a Meta Developer App
- Go to [developers.facebook.com/apps/creation](https://developers.facebook.com/apps/creation/)
- Add use case: **"Access the Threads API"**
- Add permissions: `threads_basic`, `threads_content_publish`, `threads_manage_replies`, `threads_manage_insights`

### 2. Generate an access token
- In your app → Use cases → Access the Threads API → Settings
- Set a Redirect Callback URL (e.g. `http://localhost:8915/callback`)
- Use the **User Token Generator** at the bottom of Settings — click "Generate Access Token" next to your Threads Tester account, approve the consent screen, copy the token

### 3. Connect to Claude Code
```bash
claude mcp add threads-growth -s user \
  -e THREADS_ACCESS_TOKEN=your_token \
  -e THREADS_USER_ID=your_threads_user_id \
  -- npx -y @mj4384963/threads-growth-mcp@latest
```

## Stack
- Node.js (ES modules) · `@modelcontextprotocol/sdk` · Threads Graph API (`graph.threads.net/v1.0`) · stdio transport

---

Built by [Muhammad Yaseen](https://github.com/my5757980) · [Threads @ms5373268](https://www.threads.com/@ms5373268) · [X @MuhammadYa5968](https://x.com/MuhammadYa5968)
