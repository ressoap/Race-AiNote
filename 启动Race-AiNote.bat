@echo off
chcp 65001 >nul
title Race-AiNote
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 没有检测到 Node.js，请先安装 Node 20+ 后再双击本文件。
  pause
  exit /b 1
)
node "%~dp0scripts\desktop.js"
if errorlevel 1 pause
