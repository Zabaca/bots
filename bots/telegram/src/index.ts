import { query } from "@anthropic-ai/claude-agent-sdk";
import { storeMessage, storeBotReply } from "./db";

const BOT_TOKEN = process.env.TELEGRAM_BOOTCAMP_AI_BOT;

if (!BOT_TOKEN) {
  console.error("Missing TELEGRAM_BOOTCAMP_AI_BOT env var");
  process.exit(1);
}

const BOT_USERNAME = "ai_bootcamp";
const AGENT_PATH = new URL("../../../.claude/agents/bootcamp_ai.md", import.meta.url).pathname;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

function log(tag: string, ...args: any[]) {
  const ts = new Date().toLocaleTimeString();
  console.log(`[${ts}] [${tag}]`, ...args);
}

async function loadAgentDefinition() {
  const raw = await Bun.file(AGENT_PATH).text();
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) throw new Error("Invalid agent definition — missing frontmatter");

  const frontmatter = fmMatch[1];
  const prompt = fmMatch[2].trim();

  const get = (key: string) => {
    const m = frontmatter.match(new RegExp(`^${key}:\\s*"?(.+?)"?$`, "m"));
    return m ? m[1].trim() : undefined;
  };

  return {
    name: get("name") || "bootcamp-ai",
    description: get("description") || "",
    model: get("model") as "sonnet" | "opus" | "haiku" | undefined,
    tools: get("tools")?.split(",").map((t) => t.trim()),
    prompt,
  };
}

const agentDef = await loadAgentDefinition();
log("agent", `Loaded agent "${agentDef.name}" (model=${agentDef.model}, tools=${agentDef.tools?.join(", ")})`);

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

    for await (const msg of query({
      prompt: `A bootcamp member named ${userName} asks: ${userPrompt}`,
      options: {
        agent: agentDef.name,
        agents: {
          [agentDef.name]: {
            description: agentDef.description,
            prompt: agentDef.prompt,
            model: agentDef.model,
            tools: agentDef.tools,
            maxTurns: 3,
          },
        },
        permissionMode: "plan",
      },
    })) {
      if (msg.type === "assistant" && msg.message?.content) {
        for (const block of msg.message.content) {
          if ("text" in block) {
            resultText += block.text;
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
      // TODO: re-enable when ready to go live
      // const reply = resultText.length > 4000 ? resultText.slice(0, 4000) + "..." : resultText;
      // await sendMessage(chatId, reply, messageId);
    } else {
      log("agent", "No text in agent response");
    }
  } catch (err) {
    log("agent", "Error:", err);
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
