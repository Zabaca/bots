import { Database } from "bun:sqlite";
import { resolve } from "path";

const DB_PATH = resolve(import.meta.dir, "../data/messages.db");
const db = new Database(DB_PATH, { create: true });

db.run("PRAGMA journal_mode = WAL");
db.run("PRAGMA busy_timeout = 5000");

db.run(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    update_id INTEGER UNIQUE,
    message_id INTEGER,
    chat_id INTEGER,
    chat_type TEXT,
    chat_title TEXT,
    from_id INTEGER,
    from_username TEXT,
    from_first_name TEXT,
    text TEXT,
    date INTEGER,
    entities TEXT,
    bot_mentioned INTEGER DEFAULT 0,
    bot_reply TEXT,
    bot_cost REAL,
    raw JSON,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    username TEXT,
    first_name TEXT,
    claude_code_installed INTEGER DEFAULT 0,
    meta JSON DEFAULT '{}',
    first_seen TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(chat_id, user_id)
  )
`);

const insertStmt = db.prepare(`
  INSERT OR IGNORE INTO messages
    (update_id, message_id, chat_id, chat_type, chat_title, from_id, from_username, from_first_name, text, date, entities, bot_mentioned, raw)
  VALUES
    ($update_id, $message_id, $chat_id, $chat_type, $chat_title, $from_id, $from_username, $from_first_name, $text, $date, $entities, $bot_mentioned, $raw)
`);

export function storeMessage(update: any, botMentioned: boolean) {
  const msg = update.message;
  if (!msg) return;

  insertStmt.run({
    $update_id: update.update_id,
    $message_id: msg.message_id,
    $chat_id: msg.chat?.id,
    $chat_type: msg.chat?.type,
    $chat_title: msg.chat?.title || null,
    $from_id: msg.from?.id,
    $from_username: msg.from?.username || null,
    $from_first_name: msg.from?.first_name || null,
    $text: msg.text || null,
    $date: msg.date,
    $entities: msg.entities ? JSON.stringify(msg.entities) : null,
    $bot_mentioned: botMentioned ? 1 : 0,
    $raw: JSON.stringify(update),
  });
}

const updateReplyStmt = db.prepare(`
  UPDATE messages SET bot_reply = $reply, bot_cost = $cost WHERE update_id = $update_id
`);

export function storeBotReply(updateId: number, reply: string, cost: number) {
  updateReplyStmt.run({ $update_id: updateId, $reply: reply, $cost: cost });
}

export function getRecentMessages(chatId: number, limit = 10): any[] {
  return db
    .prepare(
      `SELECT from_first_name, from_username, text, bot_mentioned, bot_reply, date
       FROM messages
       WHERE chat_id = $cid AND text IS NOT NULL
       ORDER BY date DESC
       LIMIT $lim`
    )
    .all({ $cid: chatId, $lim: limit })
    .reverse();
}

export function searchMessages(chatId: number, keyword: string, limit = 20): any[] {
  return db
    .prepare(
      `SELECT from_first_name, from_username, text, bot_mentioned, bot_reply, date
       FROM messages
       WHERE chat_id = $cid AND text LIKE '%' || $q || '%'
       ORDER BY date DESC
       LIMIT $lim`
    )
    .all({ $cid: chatId, $q: keyword, $lim: limit })
    .reverse();
}

export function getMessagesFromUser(chatId: number, username: string, limit = 20): any[] {
  return db
    .prepare(
      `SELECT from_first_name, from_username, text, bot_mentioned, bot_reply, date
       FROM messages
       WHERE chat_id = $cid AND (from_username = $u OR from_first_name = $u)
       ORDER BY date DESC
       LIMIT $lim`
    )
    .all({ $cid: chatId, $u: username, $lim: limit })
    .reverse();
}

// --- Members ---

const upsertMemberStmt = db.prepare(`
  INSERT INTO members (chat_id, user_id, username, first_name)
  VALUES ($cid, $uid, $username, $first_name)
  ON CONFLICT(chat_id, user_id) DO UPDATE SET
    username = COALESCE($username, username),
    first_name = COALESCE($first_name, first_name),
    updated_at = datetime('now')
`);

export function trackMember(chatId: number, user: any) {
  if (!user || user.is_bot) return;
  upsertMemberStmt.run({
    $cid: chatId,
    $uid: user.id,
    $username: user.username || null,
    $first_name: user.first_name || null,
  });
}

export function updateMemberField(chatId: number, userId: number, field: string, value: any) {
  if (field === "claude_code_installed") {
    db.prepare(`UPDATE members SET claude_code_installed = $val, updated_at = datetime('now') WHERE chat_id = $cid AND user_id = $uid`)
      .run({ $cid: chatId, $uid: userId, $val: value ? 1 : 0 });
  } else {
    db.prepare(`UPDATE members SET meta = json_set(meta, '$.' || $field, $val), updated_at = datetime('now') WHERE chat_id = $cid AND user_id = $uid`)
      .run({ $cid: chatId, $uid: userId, $field: field, $val: value });
  }
}

export function getMember(chatId: number, userId: number): any {
  return db.prepare(`SELECT * FROM members WHERE chat_id = $cid AND user_id = $uid`)
    .get({ $cid: chatId, $uid: userId });
}

export function getMembers(chatId: number): any[] {
  return db.prepare(`SELECT * FROM members WHERE chat_id = $cid ORDER BY first_seen`)
    .all({ $cid: chatId });
}

export default db;
