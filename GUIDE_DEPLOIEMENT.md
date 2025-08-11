# Guide de Déploiement en Production

## Vue d'ensemble
Ce guide couvre le déploiement complet du système de réservation en production.

## 1. Préparation du Code

### Variables d'environnement de production
```bash
# .env.production
NODE_ENV=production
PORT=3000

# MongoDB Atlas ou serveur dédié
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/restaurant_booking

# JWT avec clé forte
JWT_SECRET=production_secret_key_minimum_32_chars_xY9#mK2$

# Twilio Production
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+33756123456

# Email Production (SendGrid recommandé)
EMAIL_SERVICE=sendgrid
SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Domaine de production
DOMAIN=https://reservations.restaurant.com
```

### Optimisations de production
```javascript
// backend/server.js - Ajouts pour production
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

if (process.env.NODE_ENV === 'production') {
  // Sécurité
  app.use(helmet());
  
  // Compression
  app.use(compression());
  
  // Rate limiting
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limite par IP
  });
  app.use('/api/', limiter);
  
  // Logs de production
  const morgan = require('morgan');
  app.use(morgan('combined'));
}
```

## 2. Déploiement sur VPS (DigitalOcean/OVH/AWS EC2)

### Prérequis serveur
- Ubuntu 22.04 LTS
- 2GB RAM minimum
- 20GB SSD
- Ouverture ports : 22 (SSH), 80 (HTTP), 443 (HTTPS), 27017 (MongoDB si local)

### Configuration initiale du serveur
```bash
# 1. Connexion SSH
ssh root@votre-ip-serveur

# 2. Mise à jour système
apt update && apt upgrade -y

# 3. Créer utilisateur non-root
adduser restaurant
usermod -aG sudo restaurant
su - restaurant

# 4. Configuration firewall
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable

# 5. Installation des dépendances
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs git nginx certbot python3-certbot-nginx

# 6. Installation MongoDB (si local)
# Suivre GUIDE_MONGODB.md section Linux

# 7. Installation PM2
sudo npm install -g pm2
```

### Déploiement de l'application
```bash
# 1. Cloner le projet
cd /home/restaurant
git clone https://github.com/votre-repo/booking-system.git
cd booking-system

# 2. Installer les dépendances
npm install --production

# 3. Copier et configurer .env
cp .env.example .env
nano .env  # Éditer avec vos valeurs de production

# 4. Tester l'application
node backend/server.js

# 5. Configuration PM2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### Fichier ecosystem.config.js
```javascript
module.exports = {
  apps: [{
    name: 'restaurant-booking',
    script: './backend/server.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    max_memory_restart: '500M',
    cron_restart: '0 2 * * *',
    watch: false,
    ignore_watch: ['node_modules', 'logs']
  }]
};
```

### Configuration Nginx
```nginx
# /etc/nginx/sites-available/restaurant-booking

server {
    listen 80;
    server_name reservations.restaurant.com www.reservations.restaurant.com;
    
    # Redirection HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name reservations.restaurant.com;
    
    # SSL (géré par Certbot)
    ssl_certificate /etc/letsencrypt/live/reservations.restaurant.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/reservations.restaurant.com/privkey.pem;
    
    # Sécurité SSL
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    
    # Headers de sécurité
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    
    # Logs
    access_log /var/log/nginx/restaurant-booking.access.log;
    error_log /var/log/nginx/restaurant-booking.error.log;
    
    # Proxy vers Node.js
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    # WebSocket support
    location /socket.io/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
    
    # Limite de taille pour uploads
    client_max_body_size 10M;
    
    # Compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/json application/javascript application/xml+rss application/rss+xml application/atom+xml image/svg+xml text/javascript application/x-javascript application/x-font-ttf application/vnd.ms-fontobject font/opentype;
}
```

### Activation du site
```bash
# Activer le site
sudo ln -s /etc/nginx/sites-available/restaurant-booking /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# SSL avec Let's Encrypt
sudo certbot --nginx -d reservations.restaurant.com -d www.reservations.restaurant.com
```

## 3. Déploiement sur Heroku

### Préparation
```bash
# 1. Installer Heroku CLI
# https://devcenter.heroku.com/articles/heroku-cli

# 2. Login
heroku login

# 3. Créer l'application
heroku create restaurant-booking-prod

# 4. Ajouter MongoDB (MongoLab)
heroku addons:create mongolab:sandbox
```

### Configuration Heroku
```json
// package.json - Ajouter
{
  "engines": {
    "node": "18.x",
    "npm": "9.x"
  },
  "scripts": {
    "start": "node backend/server.js",
    "heroku-postbuild": "npm install --production"
  }
}
```

### Procfile
```
web: node backend/server.js
```

### Variables d'environnement
```bash
heroku config:set NODE_ENV=production
heroku config:set JWT_SECRET=your_secret_key
heroku config:set TWILIO_ACCOUNT_SID=ACxxxxx
heroku config:set TWILIO_AUTH_TOKEN=xxxxx
heroku config:set TWILIO_PHONE_NUMBER=+33xxxxx
# etc...
```

### Déploiement
```bash
git add .
git commit -m "Deploy to Heroku"
git push heroku main

# Voir les logs
heroku logs --tail

# Ouvrir l'app
heroku open
```

## 4. Déploiement avec Docker

### Dockerfile
```dockerfile
# Multi-stage build
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:18-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
USER node
CMD ["node", "backend/server.js"]
```

### docker-compose.yml
```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - MONGODB_URI=mongodb://mongo:27017/restaurant_booking
    depends_on:
      - mongo
    restart: unless-stopped
    networks:
      - restaurant-network

  mongo:
    image: mongo:7
    volumes:
      - mongo-data:/data/db
    environment:
      - MONGO_INITDB_ROOT_USERNAME=admin
      - MONGO_INITDB_ROOT_PASSWORD=secretpassword
      - MONGO_INITDB_DATABASE=restaurant_booking
    restart: unless-stopped
    networks:
      - restaurant-network

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
    depends_on:
      - app
    restart: unless-stopped
    networks:
      - restaurant-network

volumes:
  mongo-data:

networks:
  restaurant-network:
    driver: bridge
```

### Déploiement Docker
```bash
# Build et démarrer
docker-compose up -d --build

# Voir les logs
docker-compose logs -f

# Arrêter
docker-compose down

# Backup MongoDB
docker exec -t mongo mongodump --archive --gzip > backup.gz
```

## 5. Déploiement sur AWS

### Option 1 : EC2
```bash
# 1. Créer instance EC2 (t3.small minimum)
# 2. Configurer Security Groups (ports 22, 80, 443)
# 3. Suivre les étapes VPS ci-dessus
```

### Option 2 : Elastic Beanstalk
```bash
# 1. Installer EB CLI
pip install awsebcli

# 2. Initialiser
eb init -p node.js restaurant-booking

# 3. Créer environnement
eb create production

# 4. Déployer
eb deploy

# 5. Configurer variables
eb setenv NODE_ENV=production JWT_SECRET=xxx
```

### Option 3 : ECS avec Fargate
```json
// task-definition.json
{
  "family": "restaurant-booking",
  "taskRoleArn": "arn:aws:iam::xxx:role/ecsTaskRole",
  "executionRoleArn": "arn:aws:iam::xxx:role/ecsTaskExecutionRole",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "containerDefinitions": [{
    "name": "app",
    "image": "your-ecr-repo/restaurant-booking:latest",
    "portMappings": [{
      "containerPort": 3000,
      "protocol": "tcp"
    }],
    "environment": [
      {"name": "NODE_ENV", "value": "production"}
    ],
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group": "/ecs/restaurant-booking",
        "awslogs-region": "eu-west-1",
        "awslogs-stream-prefix": "ecs"
      }
    }
  }]
}
```

## 6. Application Desktop (Electron)

### Build pour distribution
```bash
# Installation electron-builder
npm install --save-dev electron-builder

# Configuration package.json
"build": {
  "appId": "com.restaurant.booking",
  "productName": "Restaurant Booking",
  "directories": {
    "output": "dist"
  },
  "win": {
    "target": "nsis",
    "icon": "desktop/assets/icon.ico"
  },
  "mac": {
    "target": "dmg",
    "icon": "desktop/assets/icon.icns"
  },
  "linux": {
    "target": "AppImage",
    "icon": "desktop/assets/icon.png"
  }
}

# Build
npm run electron-pack  # Windows
npm run electron-pack-mac  # macOS
npm run electron-pack-linux  # Linux
```

### Auto-update
```javascript
// desktop/main.js
const { autoUpdater } = require('electron-updater');

app.on('ready', () => {
  autoUpdater.checkForUpdatesAndNotify();
});

autoUpdater.on('update-available', () => {
  dialog.showMessageBox({
    type: 'info',
    title: 'Mise à jour disponible',
    message: 'Une nouvelle version est disponible. Elle sera installée au redémarrage.',
    buttons: ['OK']
  });
});
```

## 7. Monitoring et Logs

### Configuration des logs
```javascript
// logger.js
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new DailyRotateFile({
      filename: 'logs/application-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d'
    }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

module.exports = logger;
```

### Monitoring avec PM2
```bash
# Interface web PM2
pm2 install pm2-logrotate
pm2 web

# Métriques
pm2 monit
```

### Services de monitoring externes
- **Sentry** : Tracking d'erreurs
- **New Relic** : APM complet
- **DataDog** : Infrastructure + APM
- **LogRocket** : Session replay

## 8. Sauvegardes automatiques

### Script de backup complet
```bash
#!/bin/bash
# backup.sh

# Configuration
BACKUP_DIR="/backups"
DATE=$(date +%Y%m%d_%H%M%S)
S3_BUCKET="s3://restaurant-backups"

# MongoDB
mongodump --uri=$MONGODB_URI --gzip --archive=$BACKUP_DIR/mongo_$DATE.gz

# Fichiers application
tar -czf $BACKUP_DIR/app_$DATE.tar.gz /home/restaurant/booking-system

# Upload vers S3
aws s3 cp $BACKUP_DIR/mongo_$DATE.gz $S3_BUCKET/
aws s3 cp $BACKUP_DIR/app_$DATE.tar.gz $S3_BUCKET/

# Nettoyer les vieux backups locaux
find $BACKUP_DIR -type f -mtime +7 -delete

# Notification
curl -X POST https://hooks.slack.com/services/xxx \
  -H 'Content-Type: application/json' \
  -d '{"text":"Backup completed: '$DATE'"}'
```

### Automatisation avec cron
```bash
# Backup quotidien à 3h du matin
0 3 * * * /home/restaurant/backup.sh >> /var/log/backup.log 2>&1
```

## 9. Mise à jour et rollback

### Stratégie de mise à jour
```bash
# 1. Backup avant mise à jour
./backup.sh

# 2. Pull les changements
git pull origin main

# 3. Installer les dépendances
npm install --production

# 4. Restart avec PM2 (zero-downtime)
pm2 reload restaurant-booking

# 5. Vérifier les logs
pm2 logs restaurant-booking --lines 100
```

### Rollback si problème
```bash
# 1. Revenir à la version précédente
git reset --hard HEAD~1

# 2. Réinstaller les dépendances
npm install --production

# 3. Restart
pm2 restart restaurant-booking

# 4. Restaurer la base si nécessaire
mongorestore --gzip --archive=backup.gz --drop
```

## 10. Checklist de production

### Avant le déploiement
- [ ] Variables d'environnement configurées
- [ ] MongoDB sécurisé avec authentification
- [ ] SSL/HTTPS configuré
- [ ] Firewall configuré
- [ ] Backups automatiques configurés
- [ ] Monitoring configuré
- [ ] Tests effectués

### Sécurité
- [ ] Mots de passe forts
- [ ] JWT secret unique
- [ ] Rate limiting activé
- [ ] Headers de sécurité (Helmet)
- [ ] CORS configuré correctement
- [ ] Validation des entrées
- [ ] Sanitization des données

### Performance
- [ ] Compression activée
- [ ] Cache configuré
- [ ] Indexes MongoDB créés
- [ ] PM2 en mode cluster
- [ ] CDN pour assets statiques

### Monitoring
- [ ] Logs centralisés
- [ ] Alertes configurées
- [ ] Métriques système
- [ ] Tracking d'erreurs

## Support et maintenance

### Commandes utiles
```bash
# Status application
pm2 status

# Logs temps réel
pm2 logs --lines 50

# Restart application
pm2 restart restaurant-booking

# Monitoring système
htop
df -h
free -m

# Logs Nginx
tail -f /var/log/nginx/error.log
```

### Plan de disaster recovery
1. Backups testés régulièrement
2. Documentation à jour
3. Procédures de rollback
4. Contacts d'urgence
5. Monitoring 24/7