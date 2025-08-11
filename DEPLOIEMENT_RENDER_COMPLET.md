# 🚀 Déploiement Complet sur Render

## Étape 1: MongoDB Atlas (Base de données gratuite)

1. Aller sur [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. **Sign Up** → Créer un compte gratuit
3. **Create Cluster** → Choisir FREE (M0 Sandbox)
4. **Cloud Provider:** AWS
5. **Region:** Europe (Paris) eu-west-3
6. Créer le cluster

### Configuration de l'accès:
1. **Database Access** → Add New Database User
   - Username: `restaurantadmin`
   - Password: Générer un mot de passe sécurisé (notez-le!)
   - Roles: Atlas Admin

2. **Network Access** → Add IP Address
   - Cliquer sur "Allow Access from Anywhere"
   - Ajouter `0.0.0.0/0`

3. **Connect** → Connect your application
   - Copier l'URL de connexion:
   ```
   mongodb+srv://restaurantadmin:<password>@cluster0.xxxxx.mongodb.net/restaurant_booking?retryWrites=true&w=majority
   ```
   - Remplacer `<password>` par votre mot de passe

## Étape 2: Backend sur Render

### A. Préparer votre repository GitHub

1. Créer un nouveau repository sur GitHub pour le backend
2. Dans votre dossier BOOKING local:
```bash
git init
git add .
git commit -m "Initial backend commit"
git branch -M main
git remote add origin https://github.com/VOTRE_USERNAME/restaurant-booking-backend.git
git push -u origin main
```

### B. Déployer sur Render

1. Aller sur [Render.com](https://render.com)
2. **Sign Up** avec GitHub
3. **New +** → **Web Service**
4. **Connect a repository** → Choisir `restaurant-booking-backend`
5. Configuration:
   - **Name:** `restaurant-booking-backend`
   - **Region:** Frankfurt (EU Central)
   - **Branch:** main
   - **Root Directory:** (laisser vide)
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free

6. **Environment Variables** (cliquer sur Advanced):
```
MONGODB_URI=mongodb+srv://restaurantadmin:VOTRE_MOT_DE_PASSE@cluster0.xxxxx.mongodb.net/restaurant_booking?retryWrites=true&w=majority
PORT=3000
JWT_SECRET=un_secret_tres_securise_2024_murmure_flots
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=aumurmuredesflots@gmail.com
EMAIL_PASS=yiqnmblnyiykgwnj
WHATSAPP_NUMBER=262692504049
```

7. **Create Web Service**

⏳ Attendre 5-10 minutes pour le déploiement

Votre backend sera disponible sur: `https://restaurant-booking-backend.onrender.com`

## Étape 3: Frontend sur Render

### A. Préparer le frontend

1. Dans le repository `your-dinner-spot`, créer/modifier ces fichiers:

**.env.production** (à la racine):
```
VITE_API_URL=https://restaurant-booking-backend.onrender.com/api
```

**Modifier les appels API** dans le code pour utiliser:
```javascript
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
```

2. Commit et push les changements:
```bash
git add .
git commit -m "Add production API URL"
git push
```

### B. Déployer le frontend

1. Sur Render: **New +** → **Static Site**
2. **Connect repository** → `your-dinner-spot`
3. Configuration:
   - **Name:** `your-dinner-spot`
   - **Branch:** main
   - **Root Directory:** (laisser vide)
   - **Build Command:** `npm install && npm run build`
   - **Publish Directory:** `dist`

4. **Environment Variables**:
```
VITE_API_URL=https://restaurant-booking-backend.onrender.com/api
```

5. **Create Static Site**

⏳ Attendre 5-10 minutes

Votre site sera disponible sur: `https://your-dinner-spot.onrender.com`

## Étape 4: Test de l'intégration

### 1. Tester l'API Backend:
```bash
curl https://restaurant-booking-backend.onrender.com/api/reservations
```

### 2. Tester une réservation:
```bash
curl -X POST https://restaurant-booking-backend.onrender.com/api/reservations \
  -H "Content-Type: application/json" \
  -d '{
    "customerName": "Test Client",
    "phoneNumber": "+262692000000",
    "email": "test@example.com",
    "numberOfPeople": 2,
    "date": "2025-08-25",
    "time": "19:00",
    "source": "website",
    "specialRequests": "Test de production"
  }'
```

### 3. Vérifier le frontend:
- Aller sur `https://your-dinner-spot.onrender.com`
- Tester le formulaire de réservation
- Vérifier la réception de l'email de confirmation

## 📝 Notes importantes

### Limitations du plan gratuit Render:
- ⚠️ L'application se met en veille après 15 min d'inactivité
- Premier chargement peut prendre 30-60 secondes
- 750 heures/mois d'utilisation

### Pour éviter la mise en veille:
1. Utiliser [UptimeRobot](https://uptimerobot.com) (gratuit)
2. Configurer un ping toutes les 14 minutes vers:
   - `https://restaurant-booking-backend.onrender.com/api/reservations`

### Mise à jour du code:
- Tout push sur GitHub déclenche un redéploiement automatique
- Temps de redéploiement: 3-5 minutes

## 🔧 Dépannage

### "Application error" sur le frontend:
- Vérifier que l'API_URL est correcte
- Vérifier les logs dans Render Dashboard

### Emails non reçus:
- Vérifier les spams
- Confirmer que l'email et mot de passe sont corrects

### MongoDB connection error:
- Vérifier l'URL MongoDB Atlas
- Confirmer que l'IP 0.0.0.0/0 est autorisée

## 🎉 Félicitations!

Votre système de réservation est maintenant en ligne:
- Frontend: `https://your-dinner-spot.onrender.com`
- Backend API: `https://restaurant-booking-backend.onrender.com/api`
- Emails de confirmation: ✅
- Base de données: MongoDB Atlas

## Prochaines étapes optionnelles:

1. **Nom de domaine personnalisé**
   - Acheter un domaine (ex: aumurmuredesflots.re)
   - Configurer dans Render → Settings → Custom Domains

2. **Upgrade pour meilleures performances**
   - Plan Render Starter: 7$/mois (pas de mise en veille)

3. **Monitoring**
   - Ajouter Google Analytics
   - Configurer des alertes email pour nouvelles réservations