@echo off
echo =====================================
echo Demarrage Application Desktop
echo =====================================
echo.

:: Verification que le serveur backend tourne
echo Verification du serveur backend...
curl -s http://localhost:3000 >nul 2>&1
if %errorlevel% neq 0 (
    echo [ATTENTION] Le serveur backend n'est pas accessible
    echo Assurez-vous d'avoir lance start.bat dans un autre terminal
    echo.
    choice /C YN /M "Voulez-vous continuer quand meme"
    if errorlevel 2 exit /b 0
)

echo Lancement de l'application desktop...
echo.

:: Demarrage de l'application Electron
npm run desktop