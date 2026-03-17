import { getRecentMessages, searchMessages, getMessagesFromUser } from "../db";

function formatMessages(messages: any[]): string {
  if (!messages.length) return "No messages found.";

  return messages
    .map((m) => {
      const name = m.from_username ? `${m.from_first_name} (@${m.from_username})` : m.from_first_name;
      const time = new Date(m.date * 1000).toLocaleString();
      let line = `[${time}] ${name}: ${m.text}`;
      if (m.bot_reply) {
        line += `\n  └─ bot: ${m.bot_reply.slice(0, 200)}${m.bot_reply.length > 200 ? "..." : ""}`;
      }
      return line;
    })
    .join("\n");
}

// Manual arg parsing to handle negative chat IDs (e.g. --chat-id=-1001234567)
const args = Bun.argv.slice(2);
const parsed: Record<string, string> = {};
const positionals: string[] = [];

for (let i = 0; i < args.length; i++) {
  const eqMatch = args[i].match(/^--(\w[\w-]*)=(.*)$/);
  if (eqMatch) {
    parsed[eqMatch[1]] = eqMatch[2];
  } else if (args[i].startsWith("--") && i + 1 < args.length && !args[i + 1].startsWith("--")) {
    parsed[args[i].slice(2)] = args[++i];
  } else if (!args[i].startsWith("--")) {
    positionals.push(args[i]);
  }
}

const command = positionals[0] || "recent";
const chatId = Number(parsed["chat-id"]);
const limit = Number(parsed.limit || "20");

if (!chatId) {
  console.error("Usage: channel-history <recent|search|user> --chat-id <id> [--keyword <text>] [--username <name>] [--limit <n>]");
  process.exit(1);
}

switch (command) {
  case "recent":
    console.log(formatMessages(getRecentMessages(chatId, limit)));
    break;
  case "search":
    if (!parsed.keyword) {
      console.error("--keyword required for search");
      process.exit(1);
    }
    console.log(formatMessages(searchMessages(chatId, parsed.keyword, limit)));
    break;
  case "user":
    if (!parsed.username) {
      console.error("--username required for user");
      process.exit(1);
    }
    console.log(formatMessages(getMessagesFromUser(chatId, parsed.username, limit)));
    break;
  default:
    console.error(`Unknown command: ${command}`);
    process.exit(1);
}
