const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const cors = require('cors');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Статическая папка для загруженных файлов
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Создаем папку для загрузок, если её нет
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log('📁 Папка uploads создана');
}

// Настройка multer для загрузки файлов
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB лимит
  fileFilter: (req, file, cb) => {
    // Разрешаем любые типы файлов
    cb(null, true);
  }
});

// Хранилище активных WebSocket подключений (userId -> WebSocket)
const clients = new Map();

// ============= REST API =============

// Регистрация пользователя
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Имя пользователя и пароль обязательны' });
  }
  
  if (username.length < 3) {
    return res.status(400).json({ error: 'Имя пользователя должно быть минимум 3 символа' });
  }
  
  if (password.length < 3) {
    return res.status(400).json({ error: 'Пароль должен быть минимум 3 символа' });
  }
  
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = uuidv4();
    
    db.run(
      'INSERT INTO users (id, username, password, online, last_seen) VALUES (?, ?, ?, ?, ?)',
      [userId, username, hashedPassword, 0, Date.now()],
      (err) => {
        if (err) {
          if (err.message.includes('UNIQUE')) {
            return res.status(400).json({ error: 'Пользователь с таким именем уже существует' });
          }
          return res.status(500).json({ error: 'Ошибка базы данных' });
        }
        res.json({ id: userId, username, message: 'Регистрация успешна' });
      }
    );
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Логин пользователя
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Имя пользователя и пароль обязательны' });
  }
  
  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Ошибка базы данных' });
    }
    
    if (!user) {
      return res.status(401).json({ error: 'Неверное имя пользователя или пароль' });
    }
    
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Неверное имя пользователя или пароль' });
    }
    
    // Обновляем статус онлайн
    db.run('UPDATE users SET online = 1, last_seen = ? WHERE id = ?', [Date.now(), user.id]);
    
    res.json({
      id: user.id,
      username: user.username,
      avatar: user.avatar
    });
  });
});

// Загрузка файла
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'Файл не загружен' });
    }

    let fileUrl = `/uploads/${file.filename}`;
    let fileType = 'file';
    let thumbnail = null;

    console.log(`📁 Загружен файл: ${file.originalname} (${file.mimetype})`);

    // Определяем тип файла и создаем миниатюры
    if (file.mimetype.startsWith('image/')) {
      fileType = 'image';
      
      // Создаем миниатюру для изображений
      try {
        const thumbnailPath = path.join(uploadDir, `thumb_${file.filename}`);
        await sharp(file.path)
          .resize(200, 200, { fit: 'inside', withoutEnlargement: true })
          .toFile(thumbnailPath);
        thumbnail = `/uploads/thumb_${file.filename}`;
        console.log(`🖼️ Создана миниатюра для: ${file.originalname}`);
      } catch (thumbErr) {
        console.error('Ошибка создания миниатюры:', thumbErr);
      }
      
    } else if (file.mimetype.startsWith('video/')) {
      fileType = 'video';
      console.log(`🎬 Видео файл: ${file.originalname}`);
    } else if (file.mimetype.startsWith('audio/')) {
      fileType = 'audio';
      console.log(`🎵 Аудио файл: ${file.originalname}`);
    } else {
      console.log(`📄 Документ: ${file.originalname}`);
    }

    res.json({
      url: fileUrl,
      thumbnail: thumbnail,
      type: fileType,
      name: file.originalname,
      size: file.size,
      mimetype: file.mimetype
    });
    
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Ошибка загрузки файла' });
  }
});

// Получить список пользователей (кроме текущего)
app.get('/users/:userId', (req, res) => {
  db.all(
    'SELECT id, username, avatar, online, last_seen FROM users WHERE id != ? ORDER BY online DESC, username ASC',
    [req.params.userId],
    (err, users) => {
      if (err) {
        console.error('Error loading users:', err);
        return res.status(500).json({ error: err.message });
      }
      res.json(users || []);
    }
  );
});

// Получить историю переписки с пользователем
app.get('/messages/:userId/:otherUserId', (req, res) => {
  const { userId, otherUserId } = req.params;
  
  db.all(
    `SELECT * FROM messages 
     WHERE (from_user = ? AND to_user = ?) 
        OR (from_user = ? AND to_user = ?)
     ORDER BY timestamp ASC LIMIT 200`,
    [userId, otherUserId, otherUserId, userId],
    (err, messages) => {
      if (err) {
        console.error('Error loading messages:', err);
        return res.status(500).json({ error: err.message });
      }
      res.json(messages || []);
    }
  );
});

// Удалить сообщение (опционально)
app.delete('/messages/:messageId', (req, res) => {
  const { messageId } = req.params;
  
  db.run('DELETE FROM messages WHERE id = ?', [messageId], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ deleted: this.changes > 0 });
  });
});

// ============= WEBSOCKET =============

wss.on('connection', (ws, req) => {
  let currentUserId = null;
  
  console.log('🔌 Новое WebSocket подключение');
  
  ws.on('message', async (data) => {
    try {
      const parsed = JSON.parse(data);
      
      switch (parsed.type) {
        case 'auth':
          // Аутентификация WebSocket соединения
          currentUserId = parsed.userId;
          clients.set(currentUserId, ws);
          console.log(`✅ Пользователь ${currentUserId} авторизован в WebSocket`);
          
          // Оповещаем всех, что пользователь онлайн
          broadcastStatus(currentUserId, true);
          break;
          
        case 'message':
          // Отправка сообщения
          const messageId = uuidv4();
          const timestamp = Date.now();
          
          // Сохраняем сообщение в БД
          db.run(
            'INSERT INTO messages (id, from_user, to_user, text, timestamp, read) VALUES (?, ?, ?, ?, ?, ?)',
            [messageId, parsed.from, parsed.to, parsed.text, timestamp, 0],
            function(err) {
              if (err) {
                console.error('Error saving message:', err);
                return;
              }
              
              console.log(`💬 Сообщение сохранено: ${messageId}`);
            }
          );
          
          // Отправляем сообщение собеседнику, если он онлайн
          const recipientWs = clients.get(parsed.to);
          if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
            recipientWs.send(JSON.stringify({
              type: 'message',
              id: messageId,
              from: parsed.from,
              to: parsed.to,
              text: parsed.text,
              timestamp: timestamp,
              read: 0
            }));
            console.log(`📤 Сообщение отправлено пользователю ${parsed.to}`);
          } else {
            console.log(`⚠️ Пользователь ${parsed.to} не в сети, сообщение сохранено в БД`);
          }
          
          // Подтверждение отправителю
          ws.send(JSON.stringify({
            type: 'message_sent',
            id: messageId,
            timestamp: timestamp
          }));
          break;
          
        case 'read':
          // Отметка о прочтении сообщений
          db.run(
            'UPDATE messages SET read = 1 WHERE from_user = ? AND to_user = ?',
            [parsed.from, parsed.to],
            function(err) {
              if (!err) {
                console.log(`✅ Отметка о прочтении от ${parsed.to} для ${parsed.from}`);
              }
            }
          );
          
          // Уведомляем отправителя о прочтении
          const senderWs = clients.get(parsed.from);
          if (senderWs && senderWs.readyState === WebSocket.OPEN) {
            senderWs.send(JSON.stringify({
              type: 'message_read',
              from: parsed.to,
              to: parsed.from
            }));
          }
          break;
          
        case 'typing':
          // Статус "печатает"
          const targetWs = clients.get(parsed.to);
          if (targetWs && targetWs.readyState === WebSocket.OPEN) {
            targetWs.send(JSON.stringify({
              type: 'typing',
              from: parsed.from
            }));
          }
          break;
          
        case 'delete_message':
          // Удаление сообщения
          db.run('DELETE FROM messages WHERE id = ?', [parsed.messageId], function(err) {
            if (!err && this.changes > 0) {
              console.log(`🗑️ Сообщение ${parsed.messageId} удалено`);
              
              // Уведомляем собеседника
              const otherWs = clients.get(parsed.to);
              if (otherWs && otherWs.readyState === WebSocket.OPEN) {
                otherWs.send(JSON.stringify({
                  type: 'message_deleted',
                  messageId: parsed.messageId
                }));
              }
            }
          });
          break;
          
        default:
          console.log('Неизвестный тип сообщения:', parsed.type);
      }
    } catch (error) {
      console.error('WebSocket обработка ошибки:', error);
    }
  });
  
  ws.on('close', () => {
    if (currentUserId) {
      clients.delete(currentUserId);
      console.log(`🔌 Пользователь ${currentUserId} отключился`);
      
      // Обновляем статус в БД
      db.run('UPDATE users SET online = 0, last_seen = ? WHERE id = ?', [Date.now(), currentUserId]);
      broadcastStatus(currentUserId, false);
    }
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket ошибка:', error);
  });
});

// Рассылка статуса "онлайн/оффлайн" всем подключенным клиентам
function broadcastStatus(userId, isOnline) {
  const statusMessage = JSON.stringify({
    type: 'status',
    userId: userId,
    online: isOnline,
    lastSeen: Date.now()
  });
  
  let sentCount = 0;
  clients.forEach((client, clientId) => {
    if (client !== clients.get(userId) && client.readyState === WebSocket.OPEN) {
      client.send(statusMessage);
      sentCount++;
    }
  });
  
  console.log(`📡 Статус пользователя ${userId} (${isOnline ? 'онлайн' : 'оффлайн'}) отправлен ${sentCount} клиентам`);
}

// Обработка необработанных ошибок
process.on('uncaughtException', (error) => {
  console.error('Необработанная ошибка:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Необработанный rejection:', error);
});

// Запуск сервера
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║     🚀 МЕССЕНДЖЕР СЕРВЕР ЗАПУЩЕН 🚀              ║
╠══════════════════════════════════════════════════╣
║  HTTP сервер:    http://localhost:${PORT}        ║
║  WebSocket:      ws://localhost:${PORT}          ║
║  Uploads папка:  ${uploadDir}                    ║
╚══════════════════════════════════════════════════╝
  `);
});