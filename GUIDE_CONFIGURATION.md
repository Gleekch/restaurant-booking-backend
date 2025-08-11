# Guide de Configuration Complet - Système de Réservation Restaurant

## Table des matières
1. [Prérequis](#prérequis)
2. [Installation MongoDB](#installation-mongodb)
3. [Configuration Twilio](#configuration-twilio)
4. [Configuration Email](#configuration-email)
5. [Installation du Projet](#installation-du-projet)
6. [Configuration Environnement](#configuration-environnement)
7. [Démarrage](#démarrage)
8. [Tests](#tests)
9. [Déploiement Production](#déploiement-production)
10. [Maintenance](#maintenance)

---

## 1. Prérequis

### Logiciels requis
- **Node.js** : Version 16 ou supérieure
- **MongoDB** : Version 5.0 ou supérieure
- **Git** : Pour le versioning
- **VS Code** (recommandé) : Éditeur de code

### Installation Node.js
```bash
# Windows - Télécharger depuis https://nodejs.org/
# ou via Chocolatey
choco install nodejs

# macOS
brew install node

# Linux
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### Vérification des installations
```bash
node --version  # Devrait afficher v16.x.x ou plus
npm --version   # Devrait afficher 8.x.x ou plus
```

---

## 2. Installation MongoDB

### Windows
1. Télécharger MongoDB Community Server : https://www.mongodb.com/try/download/community
2. Installer avec les options par défaut
3. MongoDB sera disponible sur `mongodb://localhost:27017`

### macOS
```bash
brew tap mongodb/brew
brew install mongodb-community
brew services start mongodb-community
```

### Linux (Ubuntu/Debian)
```bash
# Importer la clé GPG
wget -qO - https://www.mongodb.org/static/pgp/server-5.0.asc | sudo apt-key add -

# Ajouter le repository
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/5.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-5.0.list

# Installer MongoDB
sudo apt-get update
sudo apt-get install -y mongodb-org

# Démarrer le service
sudo systemctl start mongod
sudo systemctl enable mongod
```

### Vérification MongoDB
```bash
# Tester la connexion
mongosh --eval "db.version()"
```

### Interface graphique MongoDB (optionnel)
Télécharger MongoDB Compass : https://www.mongodb.com/products/compass

---

## 3. Configuration Twilio

### Création du compte
1. Aller sur https://www.twilio.com/try-twilio
2. Créer un compte (gratuit avec 15$ de crédit)
3. Vérifier votre numéro de téléphone

### Configuration du compte
1. **Dashboard** → Noter votre `Account SID` et `Auth Token`
2. **Phone Numbers** → Acheter un numéro français (+33)
   - Coût : ~1€/mois
   - Sélectionner "Voice" et "SMS" capabilities

### Configuration des webhooks
1. Aller dans **Phone Numbers** → **Manage** → **Active Numbers**
2. Cliquer sur votre numéro
3. Dans **Voice & Fax** :
   - Webhook : `https://votre-domaine.com/api/voice/incoming`
   - Method : `HTTP POST`
   - Fallback : `https://votre-domaine.com/api/voice/fallback`

### Test local avec ngrok
```bash
# Installer ngrok
npm install -g ngrok

# Exposer votre serveur local
ngrok http 3000

# Utiliser l'URL ngrok dans Twilio (ex: https://abc123.ngrok.io/api/voice/incoming)
```

---

## 4. Configuration Email

### Option 1 : Gmail (Recommandé pour tests)

1. **Activer l'accès aux applications moins sécurisées** :
   - Aller sur https://myaccount.google.com/security
   - Activer "Accès aux applications moins sécurisées"
   
2. **Ou créer un mot de passe d'application** (plus sécurisé) :
   - Activer la validation en 2 étapes
   - Générer un mot de passe d'application
   - Utiliser ce mot de passe dans `.env`

### Option 2 : Service professionnel (Production)

Services recommandés :
- **SendGrid** : 100 emails/jour gratuits
- **Mailgun** : 5000 emails/mois gratuits
- **Amazon SES** : 0.10$ pour 1000 emails

Configuration SendGrid :
```javascript
// Dans .env
EMAIL_SERVICE=sendgrid
SENDGRID_API_KEY=your_api_key

// Dans notificationService.js
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);
```

---

## 5. Installation du Projet

### Cloner ou copier le projet
```bash
# Si vous utilisez Git
git clone [votre-repo]
cd BOOKING

# Ou simplement naviguer vers le dossier
cd C:\Users\Cleme\OneDrive\Documents\Dev\BOOKING
```

### Installer les dépendances
```bash
# Installation complète
npm install

# Si erreurs de permissions (Linux/Mac)
sudo npm install --unsafe-perm

# Si erreurs sur Windows
npm install --force
```

### Structure des dossiers
```
BOOKING/
├── backend/          # Code serveur
│   ├── models/      # Modèles de données
│   ├── routes/      # Endpoints API
│   └── services/    # Services (notifications, etc.)
├── desktop/         # Application Electron
├── .env            # Configuration (à créer)
├── .env.example    # Modèle de configuration
└── package.json    # Dépendances
```

---

## 6. Configuration Environnement

### Créer le fichier .env
```bash
# Copier le modèle
cp .env.example .env

# Ou sur Windows
copy .env.example .env
```

### Éditer .env avec vos valeurs
```env
# MongoDB
MONGODB_URI=mongodb://localhost:27017/restaurant_booking

# Serveur
PORT=3000

# Sécurité
JWT_SECRET=changez_cette_cle_secrete_en_production_xyz123

# Twilio (depuis votre dashboard Twilio)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+33756XXXXXX

# Email SMTP
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=votre.restaurant@gmail.com
EMAIL_PASS=votre_mot_de_passe_application

# Contacts pour notifications
CHEF_PHONE=+33612345678
MANAGER_PHONE=+33687654321

# OpenAI (optionnel pour IA avancée)
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### Variables importantes à modifier
- `JWT_SECRET` : Générer une clé aléatoire (min 32 caractères)
- `TWILIO_*` : Depuis votre compte Twilio
- `EMAIL_*` : Vos identifiants email
- `CHEF_PHONE` et `MANAGER_PHONE` : Numéros réels

---

## 7. Démarrage

### Démarrer MongoDB
```bash
# Windows (si pas démarré automatiquement)
net start MongoDB

# macOS
brew services start mongodb-community

# Linux
sudo systemctl start mongod
```

### Démarrer le backend
```bash
# Mode développement (avec rechargement automatique)
npm run dev

# Mode production
npm start
```

### Démarrer l'application desktop
```bash
# Dans un nouveau terminal
npm run desktop
```

### Vérification
1. Backend : http://localhost:3000/api/menu
2. Desktop : L'application Electron devrait s'ouvrir
3. MongoDB : Utiliser Compass pour voir la base de données

---

## 8. Tests

### Tests manuels de base

#### Test API Réservation
```bash
# Créer une réservation
curl -X POST http://localhost:3000/api/reservations \
  -H "Content-Type: application/json" \
  -d '{
    "customerName": "Test Client",
    "phoneNumber": "+33612345678",
    "numberOfPeople": 4,
    "date": "2024-01-20",
    "time": "19:30",
    "source": "website"
  }'

# Lister les réservations
curl http://localhost:3000/api/reservations
```

#### Test Notifications
```bash
# Test SMS (remplacer le numéro)
curl -X POST http://localhost:3000/api/notifications/test \
  -H "Content-Type: application/json" \
  -d '{
    "type": "sms",
    "recipient": "+33612345678",
    "message": "Test SMS depuis le système de réservation"
  }'
```

#### Test Agent Vocal
1. Configurer ngrok : `ngrok http 3000`
2. Mettre l'URL ngrok dans Twilio
3. Appeler votre numéro Twilio
4. Suivre les instructions vocales

### Tests automatisés
```bash
# Installer les dépendances de test
npm install --save-dev jest supertest

# Lancer les tests
npm test
```

---

## 9. Déploiement Production

### Option 1 : VPS (DigitalOcean, OVH, etc.)

```bash
# Sur le serveur
# 1. Installer Node.js et MongoDB
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs mongodb

# 2. Cloner le projet
git clone [votre-repo]
cd BOOKING
npm install --production

# 3. Utiliser PM2 pour la gestion du processus
npm install -g pm2
pm2 start backend/server.js --name "booking-api"
pm2 save
pm2 startup

# 4. Configurer nginx
sudo apt-get install nginx
# Configurer le reverse proxy vers port 3000
```

### Option 2 : Heroku (Plus simple)

```bash
# 1. Installer Heroku CLI
# 2. Créer l'application
heroku create mon-restaurant-booking

# 3. Ajouter MongoDB
heroku addons:create mongolab

# 4. Configurer les variables
heroku config:set TWILIO_ACCOUNT_SID=xxx
heroku config:set TWILIO_AUTH_TOKEN=xxx
# etc...

# 5. Déployer
git push heroku main
```

### Option 3 : Docker

```dockerfile
# Créer Dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["node", "backend/server.js"]
```

### Configuration HTTPS (Important!)
```bash
# Avec Let's Encrypt
sudo apt-get install certbot python3-certbot-nginx
sudo certbot --nginx -d votre-domaine.com
```

---

## 10. Maintenance

### Sauvegardes MongoDB
```bash
# Backup
mongodump --db restaurant_booking --out ./backup/$(date +%Y%m%d)

# Restore
mongorestore --db restaurant_booking ./backup/20240120/restaurant_booking
```

### Monitoring
```bash
# Logs avec PM2
pm2 logs booking-api

# Monitoring système
pm2 monit
```

### Mises à jour
```bash
# Mettre à jour les dépendances
npm update

# Vérifier les vulnérabilités
npm audit
npm audit fix
```

### Commandes utiles
```bash
# Redémarrer l'application
pm2 restart booking-api

# Voir le statut
pm2 status

# Nettoyer les logs
pm2 flush

# Voir l'utilisation des ressources
pm2 info booking-api
```

---

## Dépannage courant

### Erreur : "Cannot connect to MongoDB"
```bash
# Vérifier que MongoDB est démarré
sudo systemctl status mongod
# Redémarrer si nécessaire
sudo systemctl restart mongod
```

### Erreur : "Port 3000 already in use"
```bash
# Trouver le processus
netstat -ano | findstr :3000  # Windows
lsof -i :3000                  # Linux/Mac

# Tuer le processus ou changer le port dans .env
```

### Erreur Twilio : "Invalid webhook"
- Vérifier que l'URL est accessible publiquement
- Utiliser ngrok pour les tests locaux
- Vérifier les logs Twilio dans le dashboard

### Application desktop ne se connecte pas
- Vérifier que le backend est démarré
- Vérifier l'URL dans `desktop/main.js`
- Ouvrir la console développeur (Ctrl+Shift+I)

---

## Support et Contact

- **Documentation API** : Voir `/api-docs` une fois le serveur démarré
- **Logs** : Vérifier `logs/` pour les erreurs
- **Base de données** : Utiliser MongoDB Compass pour debug

Pour toute question, créer une issue sur le repository ou contacter l'équipe de développement.