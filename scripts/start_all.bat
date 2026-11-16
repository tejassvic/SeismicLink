@echo off
cd /d "%~dp0\.."
echo Starting SeismoLink (database, FastAPI + Socket.IO, and React dashboard)...
docker compose up -d --build
echo Dashboard: http://localhost:9000
echo Admin credentials are configured in the root .env file.
pause
