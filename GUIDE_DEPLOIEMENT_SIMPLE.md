# Guide de Déploiement - Restaurant Booking System

## Options d'Hébergement Recommandées

### 1. **Render** (GRATUIT - Recommandé pour débuter)
- ✅ Hébergement gratuit avec limitations raisonnables
- ✅ Support MongoDB Atlas gratuit
- ✅ HTTPS automatique
- ✅ Déploiement depuis GitHub

### 2. **Railway** (Simple et abordable)
- 💵 5$/mois pour commencer
- ✅ Déploiement en 1 clic
- ✅ Base de données incluse
- ✅ Variables d'environnement faciles

### 3. **VPS Hostinger** (Plus de contrôle)
- 💵 À partir de 4€/mois
- ✅ Contrôle total du serveur
- ⚠️ Configuration manuelle requise

## Étapes de Déploiement sur Render (GRATUIT)

### 1. Préparer MongoDB Atlas
1. Créer un compte sur [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Créer un cluster gratuit
3. Créer un utilisateur de base de données
4. Autoriser l'accès depuis n'importe où (0.0.0.0/0)
5. Récupérer l'URL de connexion

### 2. Préparer GitHub
1. Créer un compte GitHub si nécessaire
2. Créer un nouveau repository
3. Pousser votre code :
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/votreusername/restaurant-booking.git
git push -u origin main
```

### 3. Déployer sur Render
1. Créer un compte sur [Render](https://render.com)
2. Nouveau > Web Service
3. Connecter votre repository GitHub
4. Configuration :
   - **Name:** restaurant-booking
   - **Environment:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Free

### 4. Variables d'Environnement
Dans Render, ajouter ces variables :
```
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/restaurant_booking
PORT=3000
JWT_SECRET=votre_secret_key_securise
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=aumurmuredesflots@gmail.com
EMAIL_PASS=yiqnmblnyiykgwnj
```

### 5. Frontend (Site Web)
Pour l'interface client, vous avez besoin d'un site web qui communique avec votre API.

Options :
1. **GitHub Pages** (gratuit) - pour un site statique
2. **Netlify** (gratuit) - pour React/Vue/Angular
3. **Vercel** (gratuit) - pour Next.js

## Configuration DNS (pour votre domaine)

Si vous avez un domaine (ex: aumurmuredesflots.re) :
1. Dans Render, ajouter votre domaine personnalisé
2. Chez votre registrar, configurer :
   - Type: CNAME
   - Nom: www
   - Valeur: votre-app.onrender.com

## Fichiers à Modifier Avant Déploiement

### package.json
Vérifier que le script start pointe vers le bon fichier :
```json
"scripts": {
  "start": "node backend/server.js"
}
```

### .env
Ne jamais commit le fichier .env ! Utiliser les variables d'environnement du service d'hébergement.

### .gitignore
Créer ce fichier pour exclure les fichiers sensibles :
```
node_modules/
.env
desktop/
*.log
```

## Test Après Déploiement

1. Tester l'API :
```bash
curl https://votre-app.onrender.com/api/reservations
```

2. Créer une réservation test
3. Vérifier la réception des emails

## Support et Maintenance

- Surveiller les logs dans Render Dashboard
- MongoDB Atlas pour voir les données
- Mettre à jour régulièrement les dépendances

## Prochaines Étapes

1. **Créer l'interface web client** (HTML/CSS/JS ou React)
2. **Sécuriser l'API** avec authentification
3. **Ajouter un système de paiement** (Stripe)
4. **Configurer des sauvegardes automatiques**

---

Besoin d'aide ? Les services d'hébergement ont généralement un excellent support et documentation.