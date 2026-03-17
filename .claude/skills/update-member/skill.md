---
name: update-member
description: "Update a bootcamp member's profile when they self-report progress."
---

When a member tells you they've done something (installed Claude Code, connected a tool, etc.), believe them and update their profile immediately. Don't ask for confirmation — just do it.

## Updating a member field

Use the update script via Bash. The user's Telegram user_id is available in the Member profile section of the prompt.

```bash
bun run .claude/skills/update-member/update.ts --user-id=<user_id> --field=<field> --value=<value>
```

## Supported fields

- `claude_code_installed` — set to `true` when they confirm installation

## Examples

User says "I have installed Claude Code":
```bash
bun run .claude/skills/update-member/update.ts --user-id=12345 --field=claude_code_installed --value=true
```

After running, acknowledge it and move on. Don't dwell on it.
