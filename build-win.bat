@echo off
cd /d %~dp0
call npm install
call npx electron-builder --win nsis portable --x64
start dist
