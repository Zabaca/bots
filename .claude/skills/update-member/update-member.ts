import { Database } from "bun:sqlite";

const db = new Database(Bun.env.DB_PATH!);

const args = Bun.argv.slice(2);
const parsed: Record<string, string> = {};

for (let i = 0; i < args.length; i++) {
  const eqMatch = args[i].match(/^--([\w-]+)=(.*)$/);
  if (eqMatch) {
    parsed[eqMatch[1]] = eqMatch[2];
  } else if (args[i].startsWith("--") && i + 1 < args.length) {
    parsed[args[i].slice(2)] = args[++i];
  }
}

const { "user-id": userId, field, value } = parsed;

if (!userId || !field || value === undefined) {
  console.error("Usage: update.ts --user-id=<id> --field=<field> --value=<value>");
  process.exit(1);
}

const ALLOWED_FIELDS = ["claude_code_installed"];

if (!ALLOWED_FIELDS.includes(field)) {
  console.error(`Unknown field: ${field}. Allowed: ${ALLOWED_FIELDS.join(", ")}`);
  process.exit(1);
}

if (field === "claude_code_installed") {
  db.run(
    `UPDATE members SET claude_code_installed = $val, updated_at = datetime('now') WHERE user_id = $uid`,
    { $val: value === "true" ? 1 : 0, $uid: Number(userId) }
  );
  console.log(`Updated claude_code_installed=${value} for user ${userId}`);
}
