@echo off
rem Starts Cars Map on this PC and opens a free public HTTPS link to it (Cloudflare quick tunnel).
rem The link appears below as "TUNNEL https://....trycloudflare.com" and is saved to tools\tunnel-url.txt.
rem Close this window to take the link offline. Phones that already opened the app keep working offline.
cd /d "%~dp0"
node scripts\precache.mjs
start "Cars Map server" /min node server\serve.mjs
node scripts\tunnel.mjs
