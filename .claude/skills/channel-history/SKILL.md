---
name: channel-history
description: "Query and navigate Telegram channel conversation history to understand context before responding."
---

You have access to the full conversation history from the Telegram channel stored in a SQLite database.

## Available context

Before each message you receive, the last 10 messages from the channel are included as `## Recent channel history`. Use this to understand the flow of conversation and respond in context.

## Querying deeper history

When the recent messages aren't enough, use the `channel-history` CLI tool via Bash to search further. The CLI is located at `bots/telegram/src/cli/channel-history.ts` relative to the project root.

**IMPORTANT:** The `--chat-id` is required. Extract it from the recent channel history context provided in the prompt — it's the chat the message came from. Use the `=` syntax for negative IDs (e.g. `--chat-id=-1001234567`).

### Commands

```bash
# Get recent messages
bun run bots/telegram/src/cli/channel-history.ts recent --chat-id=-CHATID --limit 20

# Search messages by keyword
bun run bots/telegram/src/cli/channel-history.ts search --chat-id=-CHATID --keyword "MCP"

# Get messages from a specific user
bun run bots/telegram/src/cli/channel-history.ts user --chat-id=-CHATID --username "alex_dev"
```

## When to use history

- When someone references an earlier conversation ("like I said before", "what we discussed", "the thing about...")
- When a question only makes sense with prior context
- When you want to avoid repeating advice already given in the channel
- When understanding what a member has been working on or struggling with
