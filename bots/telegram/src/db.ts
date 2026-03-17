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

export default db;
