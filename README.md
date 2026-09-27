# threads-growth-mcp

Custom **MCP (Model Context Protocol) server** for Threads (Meta). It posts, replies, quotes, reposts, searches, manages replies and reads insights through the official, free Threads API.

Published on npm: [`@mj4384963/threads-growth-mcp`](https://www.npmjs.com/package/@mj4384963/threads-growth-mcp)

## 16 Tools

| Tool | What it does | Permission |
|------|-------------|------------|
| `post_to_threads` | Publish a text thread, optionally with a topic tag or link card | `threads_content_publish` |
| `post_with_media` | Publish an image or video post, or a carousel of 2-20, from public URLs | `threads_content_publish` |
| `publish_container` | Publish a video that was still processing when `post_with_media` returned | `threads_content_publish` |
| `reply_to_thread` | Reply to a thread or reply | `threads_content_publish`; for someone else's thread also `threads_keyword_search` or `threads_manage_mentions` |
| `quote_thread` | Quote a thread with your own text | `threads_content_publish` |
| `repost_thread` | Repost a thread to your profile | `threads_content_publish` |
| `delete_thread` | Delete your own thread or reply | `threads_delete` |
| `get_my_threads` | Fetch your recent threads | `threads_basic` |
| `get_replies` | Read a thread's replies, top-level only or the whole conversation | `threads_read_replies` |
| `hide_reply` | Hide or unhide a reply to your thread | `threads_manage_replies` |
| `get_mentions` | Posts where people @mentioned you | `threads_manage_mentions` |
| `search_threads` | Keyword or topic-tag search, top or recent | `threads_keyword_search` |
| `get_my_profile` | Username, name, bio, verified badge and follower count | `threads_basic`, `threads_manage_insights` |
| `get_my_stats` | Account totals for the last N days (profile views, likes, replies, reposts, quotes, link clicks), followers now, and an optional country/city/age/gender breakdown | `threads_manage_insights` |
| `get_thread_insights` | Views, likes, replies, reposts, quotes for one thread | `threads_manage_insights` |
| `check_token` | Whether the token is valid, when it expires, which permissions it has, and the last 24 hours' post/reply/delete quota. It never prints the token | `threads_basic` |

**What the API allows**
- **Follow:** the official API has no follow or discover endpoints for people.
- **Replying to others:** under your own threads, replies always work. Replying to someone else's thread needs `threads_keyword_search` or `threads_manage_mentions`. Meta lets an app reply to, quote and repost public posts it has recently found through search, so find them with `search_threads` or `get_mentions` first.
- **Search:** until Meta approves your app for `threads_keyword_search`, it only searches your own posts.
- **Mentions:** until your app has advanced access to `threads_manage_mentions`, it shows only mentions by your app's testers.
- **Media:** Threads downloads images and videos itself, so they must be public `http(s)` URLs.
  - Images: JPEG/PNG, up to 8 MB.
  - Videos: MP4/MOV, up to 5 minutes.
  - A video can take a few minutes to process. `post_with_media` waits up to 45 seconds, then gives you a container ID for `publish_container`.
- **Limits:**
  - 250 posts a day (a carousel counts as one)
  - 1,000 replies a day
  - 100 deletes a day
  - 2,200 searches a day
  - `check_token` shows how much of the post, reply and delete quotas is used.
- **Follower breakdown:** needs at least 100 followers.

## Setup (one time)

### 1. Create a Meta Developer App
- Go to [developers.facebook.com/apps/creation](https://developers.facebook.com/apps/creation/).
- Add the use case **"Access the Threads API"**.
- Add every permission the tools use:
  - `threads_basic`
  - `threads_content_publish`
  - `threads_read_replies`
  - `threads_manage_replies`
  - `threads_manage_insights`
  - `threads_keyword_search`
  - `threads_manage_mentions`
  - `threads_delete`

### 2. Generate an access token
- In your app, open **Use cases → Access the Threads API → Settings**.
- Set a Redirect Callback URL, for example `http://localhost:8915/callback`.
- Use the **User Token Generator** at the bottom of Settings:
  1. Click "Generate Access Token" next to your Threads Tester account.
  2. Approve every permission on the consent screen.
  3. Copy the token.
- The token lasts 60 days. `check_token` shows the expiry date. After it expires, generate a new one the same way.

### 3. Connect to Claude Code
```bash
npm i -g @mj4384963/threads-growth-mcp
claude mcp add threads-growth -s user \
  -e THREADS_ACCESS_TOKEN=your_token \
  -e THREADS_USER_ID=your_threads_user_id \
  -- node "$(npm root -g)/@mj4384963/threads-growth-mcp/index.js"
```
`-- npx -y @mj4384963/threads-growth-mcp@latest` works too. The catch: npx asks npm for the latest version on every start, and on a slow network that can exceed Claude Code's MCP connect timeout. After a new release, run `npm i -g @mj4384963/threads-growth-mcp@latest` to update the installed copy.

## Tests
```bash
npm test
```
Every tool is tested against a fake `fetch`, which checks each request's path and parameters against Meta's docs. The tests also cover container polling on a fake clock, and the server over stdio. Nothing is sent to Threads.

## Stack
- Node.js 18+ (ES modules)
- `@modelcontextprotocol/sdk`, stdio transport
- Threads Graph API (`graph.threads.net/v1.0`)

---

Built by [Muhammad Yaseen](https://github.com/my5757980) · [Threads @ms5373268](https://www.threads.com/@ms5373268) · [X @MuhammadYa5968](https://x.com/MuhammadYa5968)
