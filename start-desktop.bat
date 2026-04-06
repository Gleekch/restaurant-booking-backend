@echo off
setlocal
cd /d "%~dp0"

echo =====================================
echo Demarrage Application Desktop
echo =====================================
echo.
echo La configuration backend est chargee depuis le fichier .env si present.
echo.

set "ELECTRON_RUN_AS_NODE="

echo Lancement de l'application desktop...
echo.

npm run desktop
