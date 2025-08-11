@echo off
echo =====================================
echo Installation Systeme Reservation Restaurant
echo =====================================
echo.

:: Verification Node.js
echo [1/6] Verification de Node.js...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERREUR] Node.js n'est pas installe!
    echo Telechargez-le depuis: https://nodejs.org/
    pause
    exit /b 1
)
echo Node.js OK

:: Verification MongoDB
echo [2/6] Verification de MongoDB...
where mongod >nul 2>&1
if %errorlevel% neq 0 (
    echo [ATTENTION] MongoDB n'est pas detecte dans PATH
    echo Assurez-vous qu'il est installe ou utilisez MongoDB Atlas
    echo Telechargez depuis: https://www.mongodb.com/try/download/community
    echo.
)

:: Installation des dependances
echo [3/6] Installation des dependances NPM...
call npm install
if %errorlevel% neq 0 (
    echo [ERREUR] Echec de l'installation des dependances
    pause
    exit /b 1
)

:: Creation du fichier .env
echo [4/6] Configuration de l'environnement...
if not exist .env (
    copy .env.example .env
    echo.
    echo [IMPORTANT] Fichier .env cree!
    echo Editez le fichier .env avec vos parametres:
    echo - Twilio (Account SID, Auth Token, Phone Number)
    echo - Email (SMTP settings)
    echo - Numeros de telephone pour notifications
    echo.
) else (
    echo Fichier .env existe deja
)

:: Creation des dossiers necessaires
echo [5/6] Creation des dossiers...
if not exist logs mkdir logs
if not exist backups mkdir backups
if not exist desktop\assets mkdir desktop\assets

:: Installation PM2 (optionnel pour production)
echo [6/6] Installation des outils globaux...
npm list -g pm2 >nul 2>&1
if %errorlevel% neq 0 (
    echo Installation de PM2 pour la gestion des processus...
    call npm install -g pm2
)

echo.
echo =====================================
echo Installation terminee avec succes!
echo =====================================
echo.
echo Prochaines etapes:
echo 1. Editez le fichier .env avec vos parametres
echo 2. Demarrez MongoDB (si installation locale)
echo 3. Lancez: npm run dev (pour le serveur)
echo 4. Lancez: npm run desktop (pour l'app desktop)
echo.
echo Pour plus d'informations, consultez:
echo - GUIDE_CONFIGURATION.md
echo - GUIDE_TWILIO.md
echo - GUIDE_MONGODB.md
echo.
pause