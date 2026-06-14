import React, { useState, useEffect, useRef } from 'react';
import './App.css';

function App() {
  const [user, setUser] = useState(null);
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [ws, setWs] = useState(null);
  const [typing, setTyping] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);
  
  useEffect(() => {
    if (user) {
      const socket = new WebSocket('ws://localhost:3001');
      
      socket.onopen = () => {
        socket.send(JSON.stringify({
          type: 'auth',
          userId: user.id
        }));
      };
      
      socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        switch (data.type) {
          case 'message':
            if (selectedUser && data.from === selectedUser.id) {
              const newMessage = {
                id: data.id,
                from_user: data.from,
                to_user: data.to,
                text: data.text,
                timestamp: data.timestamp,
                read: data.read
              };
              setMessages(prev => [...prev, newMessage]);
              socket.send(JSON.stringify({
                type: 'read',
                from: data.from,
                to: user.id
              }));
            }
            break;
            
          case 'message_sent':
            setMessages(prev => prev.map(msg => 
              msg.id === null ? { ...msg, id: data.id, timestamp: data.timestamp } : msg
            ));
            break;
            
          case 'message_read':
            setMessages(prev => prev.map(msg => 
              msg.from_user === user.id && msg.to_user === data.from 
                ? { ...msg, read: 1 } 
                : msg
            ));
            break;
            
          case 'message_deleted':
            setMessages(prev => prev.filter(msg => msg.id !== data.messageId));
            break;
            
          case 'typing':
            if (selectedUser && data.from === selectedUser.id) {
              setTyping(true);
              setTimeout(() => setTyping(false), 2000);
            }
            break;
            
          case 'status':
            setUsers(prev => prev.map(u => 
              u.id === data.userId 
                ? { ...u, online: data.online, last_seen: data.lastSeen }
                : u
            ));
            break;
            
          default:
            break;
        }
      };
      
      setWs(socket);
      return () => socket.close();
    }
  }, [user, selectedUser]);
  
  const loadUsers = async () => {
    if (user) {
      const response = await fetch(`http://localhost:3001/users/${user.id}`);
      const data = await response.json();
      setUsers(data);
    }
  };
  
  useEffect(() => {
    loadUsers();
  }, [user]);
  
  useEffect(() => {
    if (user && selectedUser) {
      fetch(`http://localhost:3001/messages/${user.id}/${selectedUser.id}`)
        .then(res => res.json())
        .then(data => setMessages(data))
        .catch(err => console.error('Error loading messages:', err));
    }
  }, [user, selectedUser]);
  
  const handleLogin = async () => {
    try {
      const response = await fetch(`http://localhost:3001/${isLogin ? 'login' : 'register'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: loginUsername,
          password: loginPassword
        })
      });
      
      if (response.ok) {
        const userData = await response.json();
        setUser(userData);
      } else {
        const error = await response.json();
        alert(error.error || 'Ошибка! Проверьте данные');
      }
    } catch (error) {
      alert('Ошибка подключения к серверу');
    }
  };
  
  const sendMessage = () => {
    if (!inputText.trim() || !selectedUser || !ws) return;
    
    const tempId = Date.now();
    const messageText = inputText;
    
    setMessages(prev => [...prev, {
      id: tempId,
      from_user: user.id,
      to_user: selectedUser.id,
      text: messageText,
      timestamp: Date.now(),
      read: 0
    }]);
    
    ws.send(JSON.stringify({
      type: 'message',
      from: user.id,
      to: selectedUser.id,
      text: messageText
    }));
    
    setInputText('');
  };
  
  const sendFile = async (event) => {
    const file = event.target.files[0];
    if (!file || !selectedUser || !ws) return;
    
    setUploading(true);
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await fetch('http://localhost:3001/upload', {
        method: 'POST',
        body: formData
      });
      
      if (response.ok) {
        const fileData = await response.json();
        
        // Создаем объект файла
        const fileObj = {
          type: fileData.type,
          url: fileData.url,
          thumbnail: fileData.thumbnail,
          name: fileData.name,
          size: fileData.size,
          mimetype: fileData.mimetype
        };
        
        // Отправляем как специальное сообщение с префиксом [FILE]
        const messageData = `[FILE]${JSON.stringify(fileObj)}`;
        
        const tempId = Date.now();
        setMessages(prev => [...prev, {
          id: tempId,
          from_user: user.id,
          to_user: selectedUser.id,
          text: messageData,
          timestamp: Date.now(),
          read: 0
        }]);
        
        ws.send(JSON.stringify({
          type: 'message',
          from: user.id,
          to: selectedUser.id,
          text: messageData
        }));
      }
    } catch (error) {
      console.error('File upload error:', error);
      alert('Ошибка загрузки файла');
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };
  
  // Функция для проверки, является ли сообщение файлом
  const isFileMessage = (text) => {
    return text && typeof text === 'string' && text.startsWith('[FILE]');
  };
  
  // Функция для парсинга файлового сообщения
  const parseFileMessage = (text) => {
    try {
      const jsonStr = text.substring(6); // Убираем префикс [FILE]
      return JSON.parse(jsonStr);
    } catch (e) {
      return null;
    }
  };
  
  // Функция для рендера файлового сообщения
  const renderFileMessage = (fileData) => {
    const baseUrl = 'http://localhost:3001';
    
    switch (fileData.type) {
      case 'image':
        return (
          <div className="file-message image-message">
            <img 
              src={`${baseUrl}${fileData.url}`} 
              alt={fileData.name}
              onClick={() => window.open(`${baseUrl}${fileData.url}`)}
              style={{ maxWidth: '300px', maxHeight: '300px', borderRadius: '10px', cursor: 'pointer' }}
            />
            <div className="file-name">{fileData.name}</div>
          </div>
        );
        
      case 'video':
        return (
          <div className="file-message video-message">
            <video controls style={{ maxWidth: '300px', maxHeight: '300px', borderRadius: '10px' }}>
              <source src={`${baseUrl}${fileData.url}`} type={fileData.mimetype} />
            </video>
            <div className="file-name">{fileData.name}</div>
          </div>
        );
        
      case 'audio':
        return (
          <div className="file-message audio-message">
            <audio controls style={{ width: '250px' }}>
              <source src={`${baseUrl}${fileData.url}`} type={fileData.mimetype} />
            </audio>
            <div className="file-name">{fileData.name}</div>
          </div>
        );
        
      default:
        const fileIcon = getFileIcon(fileData.name);
        const fileSize = formatFileSize(fileData.size);
        return (
          <div className="file-message document-message">
            <div className="document-info">
              <span className="file-icon">{fileIcon}</span>
              <div className="file-details">
                <div className="file-name">{fileData.name}</div>
                <div className="file-size">{fileSize}</div>
              </div>
              <a href={`${baseUrl}${fileData.url}`} download className="download-link">📥</a>
            </div>
          </div>
        );
    }
  };
  
  // Функция для рендера сообщения
  const renderMessageContent = (msg) => {
    // Проверяем, является ли сообщение файлом
    if (isFileMessage(msg.text)) {
      const fileData = parseFileMessage(msg.text);
      if (fileData) {
        return renderFileMessage(fileData);
      }
    }
    
    // Обычное текстовое сообщение
    return <div className="message-text">{msg.text}</div>;
  };
  
  const getFileIcon = (filename) => {
    const ext = filename.split('.').pop().toLowerCase();
    const icons = {
      pdf: '📄',
      doc: '📝', docx: '📝',
      xls: '📊', xlsx: '📊',
      ppt: '📽️', pptx: '📽️',
      zip: '📦', rar: '📦',
      txt: '📃',
      mp3: '🎵',
      wav: '🎵',
      mp4: '🎬',
      mov: '🎬'
    };
    return icons[ext] || '📎';
  };
  
  const formatFileSize = (bytes) => {
    if (!bytes) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };
  
  const handleTyping = () => {
    if (!ws || !selectedUser) return;
    
    ws.send(JSON.stringify({
      type: 'typing',
      from: user.id,
      to: selectedUser.id
    }));
  };
  
  const deleteMessage = (messageId, toUserId) => {
    if (window.confirm('Удалить сообщение?')) {
      ws.send(JSON.stringify({
        type: 'delete_message',
        messageId: messageId,
        to: toUserId
      }));
      setMessages(prev => prev.filter(msg => msg.id !== messageId));
    }
  };
  
  if (!user) {
    return (
      <div className="auth-container">
        <div className="auth-box">
          <h2>{isLogin ? 'Вход' : 'Регистрация'}</h2>
          <input
            type="text"
            placeholder="Имя пользователя"
            value={loginUsername}
            onChange={(e) => setLoginUsername(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
          />
          <input
            type="password"
            placeholder="Пароль"
            value={loginPassword}
            onChange={(e) => setLoginPassword(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
          />
          <button onClick={handleLogin}>{isLogin ? 'Войти' : 'Зарегистрироваться'}</button>
          <p onClick={() => setIsLogin(!isLogin)}>
            {isLogin ? 'Нет аккаунта? Зарегистрируйтесь' : 'Уже есть аккаунт? Войдите'}
          </p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="messenger">
      <div className="sidebar">
        <div className="user-info">
          <div className="avatar">{user.username[0].toUpperCase()}</div>
          <div className="username">{user.username}</div>
        </div>
        
        <div className="users-list">
          <h3>Контакты</h3>
          {users.map(u => (
            <div
              key={u.id}
              className={`user-item ${selectedUser?.id === u.id ? 'active' : ''}`}
              onClick={() => setSelectedUser(u)}
            >
              <div className="avatar small">{u.username[0].toUpperCase()}</div>
              <div className="user-details">
                <div className="username">{u.username}</div>
                <div className="status">
                  {u.online ? '🟢 Онлайн' : `Был(а) ${new Date(u.last_seen).toLocaleTimeString()}`}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      
      <div className="chat-area">
        {selectedUser ? (
          <>
            <div className="chat-header">
              <div className="avatar">{selectedUser.username[0].toUpperCase()}</div>
              <div>
                <div className="username">{selectedUser.username}</div>
                <div className="status">
                  {typing ? '✍️ Печатает...' : (selectedUser.online ? '🟢 Онлайн' : 'Не в сети')}
                </div>
              </div>
            </div>
            
            <div className="messages-container">
              {messages.map(msg => (
                <div
                  key={msg.id}
                  className={`message ${msg.from_user === user.id ? 'sent' : 'received'}`}
                >
                  <div className="message-content">
                    {renderMessageContent(msg)}
                    <div className="message-time">
                      {new Date(msg.timestamp).toLocaleTimeString()}
                      {msg.from_user === user.id && (
                        <>
                          <span className="read-status">
                            {msg.read ? '✓✓' : '✓'}
                          </span>
                          <button 
                            className="delete-btn"
                            onClick={() => deleteMessage(msg.id, msg.to_user)}
                            title="Удалить"
                          >
                            🗑️
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
            
            <div className="input-area">
              <input
                type="text"
                placeholder="Введите сообщение..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                onKeyUp={handleTyping}
              />
              <label className="file-button">
                📎
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={sendFile}
                  style={{ display: 'none' }}
                  disabled={uploading}
                  accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt"
                />
              </label>
              <button onClick={sendMessage} disabled={uploading}>
                {uploading ? '⏳' : '📤'}
              </button>
            </div>
          </>
        ) : (
          <div className="no-chat">
            <div>💬</div>
            <div>Выберите контакт для начала диалога</div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;