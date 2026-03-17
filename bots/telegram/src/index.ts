import { query } from "@anthropic-ai/claude-agent-sdk";
import { storeMessage, storeBotReply, getRecentMessages, getMessagesFromUser, trackMember, getMember, updateMemberField } from "./db";

const BOT_TOKEN = process.env.TELEGRAM_BOOTCAMP_AI_BOT;

if (!BOT_TOKEN) {
  console.error("Missing TELEGRAM_BOOTCAMP_AI_BOT env var");
  process.exit(1);
}

const BOT_USERNAME = "bootcamp_ai_bot";
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const PROJECT_DIR = new URL("../../..", import.meta.url).pathname;

import { appendFileSync } from "node:fs";
const LOG_FILE = new URL("../data/bot.log", import.meta.url).pathname;

function log(tag: string, ...args: any[]) {
  const ts = new Date().toLocaleTimeString();
  const line = `[${ts}] [${tag}] ${args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}`;
  console.log(line);
  appendFileSync(LOG_FILE, line + "\n");
}

const INSTALL_PATTERNS = [
  /installed claude code/i,
  /claude code is (working|installed|running|set up)/i,
  /got claude code (working|installed|running|set up)/i,
  /claude code (is )?ready/i,
  /just installed claude/i,
  /claude --version/i,
  /claude code cli/i,
  /npm install -g @anthropic-ai\/claude-code/i,
  /brew install claude/i,
];

function detectClaudeCodeInstalled(text: string): boolean {
  return INSTALL_PATTERNS.some((p) => p.test(text));
}

function formatMemberContext(chatId: number, userId: number, userName: string): string {
  const member = getMember(chatId, userId);
  if (!member) return "";

  const parts = [`## Member profile: ${userName}`];
  parts.push(`- Claude Code installed: ${member.claude_code_installed ? "yes" : "not yet"}`);

  const meta = typeof member.meta === "string" ? JSON.parse(member.meta) : member.meta;
  for (const [k, v] of Object.entries(meta || {})) {
    if (v) parts.push(`- ${k}: ${v}`);
  }

  parts.push(`- First seen: ${member.first_seen}`);
  return parts.join("\n");
}

function formatUserHistory(chatId: number, userName: string): string {
  const messages = getMessagesFromUser(chatId, userName, 5);
  if (!messages.length) return "";

  const lines = messages.map((m: any) => {
    const time = new Date(m.date * 1000).toLocaleString();
    let line = `[${time}] ${m.text}`;
    if (m.bot_reply) {
      line += `\n  └─ bot replied: ${m.bot_reply.slice(0, 150)}${m.bot_reply.length > 150 ? "..." : ""}`;
    }
    return line;
  });

  return `## ${userName}'s recent messages\n\n${lines.join("\n")}`;
}

function formatRecentContext(chatId: number): string {
  const messages = getRecentMessages(chatId, 10);
  if (!messages.length) return "";

  const lines = messages.map((m: any) => {
    const name = m.from_username ? `${m.from_first_name} (@${m.from_username})` : m.from_first_name;
    const time = new Date(m.date * 1000).toLocaleString();
    let line = `[${time}] ${name}: ${m.text}`;
    if (m.bot_reply) {
      line += `\n  └─ bot replied: ${m.bot_reply.slice(0, 150)}${m.bot_reply.length > 150 ? "..." : ""}`;
    }
    return line;
  });

  return `## Recent channel history (chat_id=${chatId})\n\n${lines.join("\n")}`;
}

async function sendMessage(chatId: number, text: string, replyToMessageId?: number) {
  log("telegram", `Sending reply to chat ${chatId}`);
  const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_to_message_id: replyToMessageId,
      parse_mode: "Markdown",
    }),
  });
  const data = await res.json() as any;
  if (!data.ok) {
    log("telegram", `sendMessage failed:`, data.description);
  }
}

function isBotMentioned(update: any): boolean {
  const message = update.message;
  if (!message?.text) return false;

  // Check entities for @mention
  if (message.entities?.length) {
    const mentioned = message.entities.some(
      (entity: any) =>
        entity.type === "mention" &&
        message.text
          .substring(entity.offset, entity.offset + entity.length)
          .toLowerCase() === `@${BOT_USERNAME}`
    );
    if (mentioned) return true;
  }

  // Fallback: check text directly
  return message.text.toLowerCase().includes(`@${BOT_USERNAME}`);
}

function extractPrompt(text: string): string {
  return text.replace(new RegExp(`@${BOT_USERNAME}`, "gi"), "").trim();
}

async function handleMention(update: any) {
  const message = update.message;
  const chatId = message.chat.id;
  const messageId = message.message_id;
  const updateId = update.update_id;
  const userPrompt = extractPrompt(message.text);
  const userName = message.from?.first_name || "someone";

  if (!userPrompt) {
    await sendMessage(chatId, "Hey! Ask me anything about building with Claude Code.", messageId);
    return;
  }

  log("agent", `Prompt from ${userName}: "${userPrompt}"`);
  log("agent", "Starting agent query...");

  try {
    let resultText = "";

    const recentContext = formatRecentContext(chatId);
    const memberContext = formatMemberContext(chatId, message.from?.id, userName);
    const userHistory = formatUserHistory(chatId, message.from?.username || userName);
    const fullPrompt = [
      recentContext,
      memberContext,
      userHistory,
      `A bootcamp member named ${userName} asks: ${userPrompt}`,
    ].filter(Boolean).join("\n\n");

    log("agent", `Context: ${recentContext ? recentContext.split("\n").length - 2 + " messages preloaded" : "no history"}`);

    for await (const msg of query({
      prompt: fullPrompt,
      options: {
        agent: "bootcamp-ai",
        cwd: PROJECT_DIR,
        settingSources: ["project"],
        maxTurns: 10,
        permissionMode: "dontAsk",
        allowedTools: ['Bash']
      },
    })) {
      if (msg.type === "system" && (msg as any).subtype === "init") {
        const init = msg as any;
        log("agent", `Init — model=${init.model} tools=${JSON.stringify(init.tools)} skills=${JSON.stringify(init.skills)}`);
      }

      if (msg.type === "assistant" && msg.message?.content) {
        for (const block of msg.message.content) {
          if ("text" in block) {
            resultText += block.text;
          } else if ("name" in block) {
            log("agent", `Tool: ${(block as any).name}(${JSON.stringify((block as any).input || {}).slice(0, 200)})`);
          }
        }
      }

      if (msg.type === "result") {
        log("agent", `Done — cost=$${msg.total_cost_usd} turns=${msg.num_turns} status=${msg.subtype}`);
        if (msg.is_error) {
          log("agent", `Error: ${msg.result}`);
        }
        storeBotReply(updateId, resultText, msg.total_cost_usd);
      }
    }

    if (resultText) {
      log("agent", `Reply (${resultText.length} chars):\n${resultText}`);
      const reply = resultText.length > 4000 ? resultText.slice(0, 4000) + "..." : resultText;
      await sendMessage(chatId, reply, messageId);
    } else {
      log("agent", "No text in agent response");
    }
  } catch (err: any) {
    log("agent", "Error:", err?.message || err?.stack || JSON.stringify(err, Object.getOwnPropertyNames(err)));
    await sendMessage(chatId, "Sorry, I hit an error processing that. Try again?", messageId);
  }
}

const server = Bun.serve({
  port: Number(process.env.PORT) || 3000,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "POST" && url.pathname === "/webhook") {
      const update = await req.json();
      const message = update.message;

      if (!message) {
        log("webhook", "Non-message update:", JSON.stringify(update).slice(0, 200));
        return new Response("ok");
      }

      const from = message.from?.first_name || "unknown";
      const text = message.text || "(no text)";
      const mentioned = isBotMentioned(update);

      log("webhook", `${from}: "${text}" | mentioned=${mentioned} | entities=${JSON.stringify(message.entities || [])}`);

      storeMessage(update, mentioned);
      trackMember(message.chat.id, message.from);

      if (text && message.from && detectClaudeCodeInstalled(text)) {
        updateMemberField(message.chat.id, message.from.id, "claude_code_installed", true);
        log("member", `${from} detected as having Claude Code installed`);
      }

      if (mentioned) {
        handleMention(update).catch((err) =>
          log("agent", "Unhandled error:", err)
        );
      }

      return new Response("ok");
    }

    return new Response("not found", { status: 404 });
  },
});

log("server", `Listening on http://localhost:${server.port}/webhook`);
