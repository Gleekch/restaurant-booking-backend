@echo off
echo =====================================
echo Demarrage Systeme Reservation
echo =====================================
echo.

:: Verification MongoDB
echo Verification de MongoDB...
tasklist /FI "IMAGENAME eq mongod.exe" 2>NUL | find /I /N "mongod.exe">NUL
if %errorlevel% neq 0 (
    echo MongoDB n'est pas demarre. Tentative de demarrage...
    net start MongoDB 2>NUL
    if %errorlevel% neq 0 (
        echo [ATTENTION] Impossible de demarrer MongoDB automatiquement
        echo Veuillez le demarrer manuellement ou utiliser MongoDB Atlas
        echo.
    ) else (
        echo MongoDB demarre avec succes
    )
) else (
    echo MongoDB est deja en cours d'execution
)

echo.
echo Demarrage du serveur backend...
echo =====================================
echo Serveur disponible sur: http://localhost:3000
echo API Documentation: http://localhost:3000/api-docs
echo.
echo Appuyez sur Ctrl+C pour arreter le serveur
echo =====================================
echo.

:: Demarrage du serveur
npm run dev