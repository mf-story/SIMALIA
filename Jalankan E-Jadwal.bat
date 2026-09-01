@echo off
title SIMALIA - Server Lokal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [!] Node.js belum terpasang.
  echo     Silakan pasang dari https://nodejs.org (versi LTS), lalu jalankan lagi file ini.
  echo.
  pause
  exit /b 1
)

rem Cek apakah server sudah berjalan di port 8099.
netstat -ano | findstr ":8099" | findstr "LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo.
  echo [i] SIMALIA sudah berjalan. Membuka browser...
  start "" http://localhost:8099
  timeout /t 2 >nul
  exit /b 0
)

echo ============================================
echo   SIMALIA berjalan di http://localhost:8099
echo   Tutup jendela ini untuk menghentikan.
echo ============================================
echo.

start "" http://localhost:8099
node server.js

echo.
echo [!] Server berhenti. Lihat pesan di atas bila ada kesalahan.
pause
