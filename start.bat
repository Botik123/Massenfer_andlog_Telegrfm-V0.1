@echo off
title Мессенджер
echo Запуск мессенджера...

echo [1/2] Запуск сервера...
start "Мессенджер - Сервер" cmd /k "cd server && npm start"

timeout /t 3 /nobreak >nul

echo [2/2] Запуск клиента...
start "Мессенджер - Клиент" cmd /k "cd client && npm start"

echo Готово! Мессенджер запущен.
echo Сервер: http://localhost:3001
echo Клиент: http://localhost:3000
echo.
echo Для остановки закрой окна командной строки.
timeout /t 5 /nobreak >nul