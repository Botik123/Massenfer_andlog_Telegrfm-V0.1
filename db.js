const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'messenger.db'));

// Создаем таблицы
db.serialize(() => {
  // Таблица пользователей
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      avatar TEXT,
      online INTEGER DEFAULT 0,
      last_seen INTEGER
    )
  `);

  // Таблица сообщений
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      from_user TEXT NOT NULL,
      to_user TEXT NOT NULL,
      text TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      read INTEGER DEFAULT 0,
      FOREIGN KEY(from_user) REFERENCES users(id),
      FOREIGN KEY(to_user) REFERENCES users(id)
    )
  `);

  console.log('✅ База данных SQLite инициализирована');
});

module.exports = db;