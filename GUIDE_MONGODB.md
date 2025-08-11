# Guide MongoDB - Base de Données Réservations

## Introduction
MongoDB est une base de données NoSQL parfaite pour stocker les réservations de manière flexible et scalable.

## 1. Installation MongoDB

### Windows

#### Option 1 : Installation MSI (Recommandé)
1. Télécharger : https://www.mongodb.com/try/download/community
2. Choisir :
   - Version : 7.0 (Current)
   - Platform : Windows
   - Package : MSI
3. Installation :
   - Run as Service : ✓
   - Service Name : MongoDB
   - Data Directory : `C:\Program Files\MongoDB\Server\7.0\data`
   - Log Directory : `C:\Program Files\MongoDB\Server\7.0\log`

#### Option 2 : Chocolatey
```powershell
# PowerShell en admin
choco install mongodb
```

### macOS

#### Option 1 : Homebrew (Recommandé)
```bash
# Installer
brew tap mongodb/brew
brew install mongodb-community@7.0

# Démarrer
brew services start mongodb-community@7.0

# Vérifier
brew services list
```

#### Option 2 : Installation manuelle
```bash
# Télécharger le .tgz depuis mongodb.com
tar -zxvf mongodb-macos-*.tgz
sudo mv mongodb-macos-* /usr/local/mongodb

# Créer les dossiers
sudo mkdir -p /usr/local/var/mongodb
sudo mkdir -p /usr/local/var/log/mongodb

# Démarrer
mongod --dbpath /usr/local/var/mongodb --logpath /usr/local/var/log/mongodb/mongo.log --fork
```

### Linux (Ubuntu/Debian)

```bash
# 1. Importer la clé GPG
curl -fsSL https://pgp.mongodb.com/server-7.0.asc | sudo gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg

# 2. Ajouter le repository
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list

# 3. Installer
sudo apt-get update
sudo apt-get install -y mongodb-org

# 4. Démarrer
sudo systemctl start mongod
sudo systemctl enable mongod

# 5. Vérifier
sudo systemctl status mongod
```

## 2. MongoDB Compass (Interface Graphique)

### Installation
1. Télécharger : https://www.mongodb.com/products/compass
2. Installer selon votre OS
3. Connexion : `mongodb://localhost:27017`

### Utilisation de Compass
- **Databases** : Voir toutes les bases
- **Collections** : Tables de données
- **Documents** : Entrées individuelles
- **Indexes** : Optimisation des requêtes
- **Performance** : Monitoring en temps réel

## 3. Configuration de Base

### Fichier de configuration
```yaml
# /etc/mongod.conf ou C:\Program Files\MongoDB\Server\7.0\bin\mongod.cfg

storage:
  dbPath: /var/lib/mongodb
  journal:
    enabled: true

systemLog:
  destination: file
  logAppend: true
  path: /var/log/mongodb/mongod.log

net:
  port: 27017
  bindIp: 127.0.0.1

security:
  authorization: disabled  # Activer en production
```

### Démarrage avec configuration
```bash
mongod --config /etc/mongod.conf
```

## 4. Structure de la Base de Données

### Schéma des Collections

#### Collection: reservations
```javascript
{
  _id: ObjectId("..."),
  customerName: "Jean Dupont",
  phoneNumber: "+33612345678",
  email: "jean@example.com",
  numberOfPeople: 4,
  date: ISODate("2024-01-20"),
  time: "19:30",
  specialRequests: "Table près de la fenêtre",
  source: "website",
  status: "confirmed",
  table: "T5",
  notes: "",
  createdAt: ISODate("2024-01-15T10:30:00Z"),
  updatedAt: ISODate("2024-01-15T10:30:00Z")
}
```

#### Collection: customers
```javascript
{
  _id: ObjectId("..."),
  name: "Jean Dupont",
  phone: "+33612345678",
  email: "jean@example.com",
  totalReservations: 5,
  lastVisit: ISODate("2024-01-10"),
  preferences: {
    seating: "window",
    allergies: ["nuts"],
    favoriteTable: "T5"
  },
  loyalty: {
    points: 150,
    tier: "silver"
  }
}
```

#### Collection: tables
```javascript
{
  _id: ObjectId("..."),
  number: "T5",
  capacity: 4,
  location: "window",
  status: "available",
  features: ["view", "quiet"],
  reservations: [
    {
      date: ISODate("2024-01-20"),
      time: "19:30",
      reservationId: ObjectId("...")
    }
  ]
}
```

## 5. Commandes MongoDB Essentielles

### Connexion au Shell
```bash
# Nouvelle version
mongosh

# Ancienne version
mongo
```

### Commandes de base
```javascript
// Voir les bases de données
show dbs

// Utiliser une base
use restaurant_booking

// Voir les collections
show collections

// Créer une collection
db.createCollection("reservations")

// Insérer un document
db.reservations.insertOne({
  customerName: "Test Client",
  phoneNumber: "+33612345678",
  numberOfPeople: 2,
  date: new Date("2024-01-20"),
  time: "20:00",
  status: "pending"
})

// Chercher des documents
db.reservations.find({ status: "confirmed" })

// Mettre à jour
db.reservations.updateOne(
  { _id: ObjectId("...") },
  { $set: { status: "confirmed" } }
)

// Supprimer
db.reservations.deleteOne({ _id: ObjectId("...") })

// Compter
db.reservations.countDocuments({ status: "confirmed" })
```

## 6. Indexes et Optimisation

### Créer des indexes
```javascript
// Index sur la date (recherches fréquentes)
db.reservations.createIndex({ date: 1 })

// Index composé date + status
db.reservations.createIndex({ date: 1, status: 1 })

// Index sur le téléphone (unique)
db.reservations.createIndex(
  { phoneNumber: 1 },
  { unique: false }
)

// Index texte pour recherche
db.reservations.createIndex({ customerName: "text" })

// Voir les indexes
db.reservations.getIndexes()

// Analyser les performances
db.reservations.find({ date: new Date() }).explain("executionStats")
```

### Optimisations recommandées
```javascript
// Index pour les requêtes fréquentes
db.reservations.createIndex({ date: 1, time: 1 })
db.reservations.createIndex({ status: 1 })
db.reservations.createIndex({ phoneNumber: 1 })
db.reservations.createIndex({ "source": 1 })

// Index TTL pour auto-suppression (archives)
db.reservations.createIndex(
  { createdAt: 1 },
  { expireAfterSeconds: 31536000 } // 1 an
)
```

## 7. Agrégations et Rapports

### Pipeline d'agrégation
```javascript
// Statistiques par jour
db.reservations.aggregate([
  {
    $match: {
      date: {
        $gte: ISODate("2024-01-01"),
        $lt: ISODate("2024-02-01")
      }
    }
  },
  {
    $group: {
      _id: { $dateToString: { format: "%Y-%m-%d", date: "$date" } },
      totalReservations: { $sum: 1 },
      totalPeople: { $sum: "$numberOfPeople" },
      avgPeople: { $avg: "$numberOfPeople" }
    }
  },
  {
    $sort: { _id: 1 }
  }
])

// Top clients
db.reservations.aggregate([
  {
    $group: {
      _id: "$phoneNumber",
      name: { $first: "$customerName" },
      count: { $sum: 1 },
      totalPeople: { $sum: "$numberOfPeople" }
    }
  },
  {
    $sort: { count: -1 }
  },
  {
    $limit: 10
  }
])

// Taux de remplissage par heure
db.reservations.aggregate([
  {
    $group: {
      _id: "$time",
      count: { $sum: 1 },
      avgPeople: { $avg: "$numberOfPeople" }
    }
  },
  {
    $sort: { _id: 1 }
  }
])
```

## 8. Sauvegardes et Restauration

### Sauvegarde complète
```bash
# Backup simple
mongodump --db restaurant_booking --out ./backup/$(date +%Y%m%d)

# Backup avec compression
mongodump --db restaurant_booking --gzip --archive=backup-$(date +%Y%m%d).gz

# Backup d'une collection
mongodump --db restaurant_booking --collection reservations --out ./backup/
```

### Restauration
```bash
# Restaurer depuis un dossier
mongorestore --db restaurant_booking ./backup/20240120/restaurant_booking

# Restaurer depuis une archive
mongorestore --gzip --archive=backup-20240120.gz

# Restaurer une collection spécifique
mongorestore --db restaurant_booking --collection reservations ./backup/reservations.bson
```

### Script de backup automatique
```bash
#!/bin/bash
# backup-mongo.sh

BACKUP_DIR="/var/backups/mongodb"
DATE=$(date +%Y%m%d_%H%M%S)
DB_NAME="restaurant_booking"

# Créer le dossier si nécessaire
mkdir -p $BACKUP_DIR

# Faire le backup
mongodump --db $DB_NAME --gzip --archive=$BACKUP_DIR/backup-$DATE.gz

# Garder seulement les 7 derniers jours
find $BACKUP_DIR -type f -mtime +7 -delete

echo "Backup completed: backup-$DATE.gz"
```

### Automatisation avec cron
```bash
# Éditer crontab
crontab -e

# Ajouter (backup tous les jours à 2h du matin)
0 2 * * * /path/to/backup-mongo.sh
```

## 9. Sécurité

### Activer l'authentification
```javascript
// 1. Créer un admin
use admin
db.createUser({
  user: "admin",
  pwd: "SecurePassword123!",
  roles: [{ role: "root", db: "admin" }]
})

// 2. Créer un utilisateur pour l'app
use restaurant_booking
db.createUser({
  user: "booking_app",
  pwd: "AppPassword456!",
  roles: [
    { role: "readWrite", db: "restaurant_booking" }
  ]
})
```

### Connexion avec authentification
```javascript
// Dans .env
MONGODB_URI=mongodb://booking_app:AppPassword456!@localhost:27017/restaurant_booking?authSource=restaurant_booking

// Ou dans le code
const mongoose = require('mongoose');
mongoose.connect('mongodb://localhost:27017/restaurant_booking', {
  auth: {
    username: 'booking_app',
    password: 'AppPassword456!'
  },
  authSource: 'restaurant_booking'
});
```

### Sécurité réseau
```yaml
# mongod.conf
net:
  bindIp: 127.0.0.1  # Localhost uniquement
  # bindIp: 0.0.0.0  # Toutes les interfaces (danger!)
  port: 27017
  
security:
  authorization: enabled
```

## 10. MongoDB Atlas (Cloud)

### Configuration Atlas
1. Créer compte : https://cloud.mongodb.com
2. Créer un cluster (M0 gratuit = 512MB)
3. Configurer :
   - Username/Password
   - IP Whitelist
   - Connection string

### Connection string Atlas
```javascript
// Format
mongodb+srv://username:password@cluster.xxxxx.mongodb.net/database?retryWrites=true&w=majority

// Dans .env
MONGODB_URI=mongodb+srv://booking_app:password@cluster0.xxxxx.mongodb.net/restaurant_booking?retryWrites=true&w=majority
```

### Migration vers Atlas
```bash
# Export depuis local
mongodump --db restaurant_booking --gzip --archive=migration.gz

# Import vers Atlas
mongorestore --uri="mongodb+srv://user:pass@cluster.mongodb.net" --gzip --archive=migration.gz
```

## 11. Monitoring

### Commandes de monitoring
```javascript
// État du serveur
db.serverStatus()

// Statistiques de la base
db.stats()

// Opérations en cours
db.currentOp()

// Statistiques collection
db.reservations.stats()

// Voir les connexions
db.serverStatus().connections

// Performance des requêtes
db.setProfilingLevel(2)  // Log toutes les requêtes
db.system.profile.find().limit(5).sort({ ts: -1 })
```

### Outils de monitoring
- **MongoDB Compass** : Interface graphique
- **Studio 3T** : IDE professionnel
- **Robo 3T** : Gratuit et léger
- **mongostat** : CLI monitoring
- **mongotop** : Top des collections

## 12. Troubleshooting

### Problèmes courants

#### MongoDB ne démarre pas
```bash
# Vérifier les logs
tail -f /var/log/mongodb/mongod.log

# Vérifier les permissions
sudo chown -R mongodb:mongodb /var/lib/mongodb
sudo chown -R mongodb:mongodb /var/log/mongodb

# Réparer la base
mongod --repair --dbpath /var/lib/mongodb
```

#### Connexion refusée
```bash
# Vérifier si MongoDB tourne
ps aux | grep mongod
sudo systemctl status mongod

# Vérifier le port
netstat -an | grep 27017

# Redémarrer
sudo systemctl restart mongod
```

#### Base corrompue
```bash
# Réparer
mongod --repair

# Ou reconstruire les indexes
db.reservations.reIndex()
```

## 13. Performance Tips

### Best Practices
1. **Indexes** : Créer des indexes sur les champs de recherche
2. **Projection** : Ne récupérer que les champs nécessaires
3. **Pagination** : Utiliser skip() et limit()
4. **Batch** : Utiliser bulkWrite() pour multiples opérations
5. **Connection Pool** : Configurer le pool dans mongoose

### Configuration Mongoose optimisée
```javascript
mongoose.connect(uri, {
  maxPoolSize: 10,
  minPoolSize: 2,
  socketTimeoutMS: 45000,
  serverSelectionTimeoutMS: 5000,
  family: 4
});
```

## Support et Ressources

- **Documentation** : https://docs.mongodb.com
- **University** : https://university.mongodb.com
- **Forum** : https://www.mongodb.com/community/forums
- **Stack Overflow** : Tag [mongodb]