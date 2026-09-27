#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { TOOLS, createThreads } from "./tools.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, ".env") });
const { version } = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8"));

const callTool = createThreads({
  token: process.env.THREADS_ACCESS_TOKEN,
  userId: process.env.THREADS_USER_ID
});

const server = new Server(
  { name: "threads-growth-mcp", version },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => callTool(req.params.name, req.params.arguments || {}));

const transport = new StdioServerTransport();
await server.connect(transport);
