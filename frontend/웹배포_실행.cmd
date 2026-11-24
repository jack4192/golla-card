@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo  Pay-Mate Web Demo - Build for AWS Amplify
echo ============================================
if not exist node_modules (
  echo [1/4] Installing dependencies. This may take a few minutes.
  call npm install
  if errorlevel 1 goto error
)
echo [2/4] Checking Expo web dependencies...
call npx expo install react-dom react-native-web @expo/metro-runtime
if errorlevel 1 goto error
echo [3/4] Exporting Expo web bundle...
call npx expo export --platform web
if errorlevel 1 goto error
node scripts\prepare-amplify.js
if errorlevel 1 goto error
echo [4/4] Creating Amplify ZIP...
powershell -NoProfile -Command "Compress-Archive -Path '.\dist\*' -DestinationPath '.\solpay-web-ready.zip' -Force"
if errorlevel 1 goto error
if not exist solpay-web-ready.zip goto error
echo.
echo SUCCESS! Upload solpay-web-ready.zip into your existing AWS Amplify main branch.
pause
exit /b 0
:error
echo.
echo ERROR - copy this window's messages and send them to ChatGPT. No AWS deployment was performed.
pause
exit /b 1
