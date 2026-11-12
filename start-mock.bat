@echo off
title Neuroport Mock Server
cd /d "%~dp0"
node server\server.js --mock %*
pause
