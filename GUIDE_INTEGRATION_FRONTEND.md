# Guide d'Intégration Frontend Lovable.dev avec Backend

## 🔗 Configuration de la connexion

### 1. Dans votre frontend Lovable.dev

Modifiez l'URL de l'API selon l'environnement :

```javascript
// Configuration API
const API_URL = process.env.NODE_ENV === 'production' 
  ? 'https://votre-backend.onrender.com/api'  // URL de production
  : 'http://localhost:3000/api';               // URL locale

// Exemple d'appel API pour créer une réservation
async function createReservation(data) {
  const response = await fetch(`${API_URL}/reservations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      customerName: data.name,
      phoneNumber: data.phone,
      email: data.email,
      numberOfPeople: data.guests,
      date: data.date,
      time: data.time,
      specialRequests: data.requests,
      source: 'website'  // Important: toujours inclure 'source'
    })
  });
  
  return response.json();
}
```

### 2. Structure des données requises

```javascript
// Format de réservation attendu par l'API
{
  "customerName": "string",      // Requis
  "phoneNumber": "string",        // Requis
  "email": "string",              // Optionnel mais recommandé
  "numberOfPeople": number,       // Requis
  "date": "YYYY-MM-DD",          // Requis
  "time": "HH:MM",               // Requis
  "source": "website",           // Requis: "website", "phone", etc.
  "specialRequests": "string"     // Optionnel
}
```

### 3. Endpoints disponibles

```
GET    /api/reservations          # Liste toutes les réservations
POST   /api/reservations          # Créer une réservation
GET    /api/reservations/:id      # Obtenir une réservation
PUT    /api/reservations/:id      # Modifier une réservation
DELETE /api/reservations/:id      # Annuler une réservation

GET    /api/menu                  # Obtenir le menu
GET    /api/settings              # Obtenir les paramètres du restaurant
```

## 🚀 Déploiement

### Option 1: Lovable.dev + Render (Recommandé)

1. **Frontend sur Lovable.dev:**
   - Votre site est déjà hébergé
   - Ajoutez la variable d'environnement : `REACT_APP_API_URL=https://votre-backend.onrender.com`

2. **Backend sur Render:**
   - Suivez le GUIDE_DEPLOIEMENT_SIMPLE.md
   - URL finale : `https://votre-app.onrender.com`

3. **Configuration CORS du backend:**
   Mettez à jour `backend/server.js` :
   ```javascript
   app.use(cors({
     origin: [
       'https://votre-site.lovable.app',  // URL de votre frontend Lovable
       'http://localhost:3000',
       'http://localhost:3001'
     ],
     credentials: true
   }));
   ```

### Option 2: Tout sur le même serveur

Si vous préférez héberger frontend + backend ensemble :

1. Build du frontend Lovable
2. Placer les fichiers dans `backend/public/`
3. Ajouter dans `server.js` :
   ```javascript
   app.use(express.static('public'));
   ```

## 🔒 Sécurité

### Headers de sécurité
```javascript
// À ajouter dans server.js
app.use((req, res, next) => {
  res.header('X-Content-Type-Options', 'nosniff');
  res.header('X-Frame-Options', 'DENY');
  res.header('X-XSS-Protection', '1; mode=block');
  next();
});
```

### Validation des données
L'API valide automatiquement :
- Format email
- Numéro de téléphone
- Date future uniquement
- Nombre de personnes (1-20)

## 🧪 Test de l'intégration

### 1. Test local
```bash
# Terminal 1 - Backend
cd BOOKING
npm start

# Terminal 2 - Frontend (si en local)
cd votre-frontend
npm start
```

### 2. Test avec cURL
```bash
# Tester la création de réservation
curl -X POST http://localhost:3000/api/reservations \
  -H "Content-Type: application/json" \
  -d '{
    "customerName": "Test Client",
    "phoneNumber": "+262692000000",
    "email": "test@test.com",
    "numberOfPeople": 2,
    "date": "2025-08-25",
    "time": "19:00",
    "source": "website"
  }'
```

### 3. Vérifier les emails
- Les confirmations sont envoyées automatiquement
- Vérifiez spam si non reçu

## 📱 Fonctionnalités additionnelles

### Widget WhatsApp
```javascript
// Ajouter dans votre frontend
const whatsappNumber = "262692504049"; // Sans le +
const message = "Bonjour, je souhaite réserver une table";
const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;
```

### Affichage en temps réel (Socket.io)
```javascript
// Connexion Socket.io dans le frontend
import io from 'socket.io-client';

const socket = io('http://localhost:3000');

socket.on('newReservation', (reservation) => {
  // Mettre à jour l'interface
  console.log('Nouvelle réservation:', reservation);
});
```

## ❓ Problèmes courants

### CORS Error
- Vérifier que l'URL du frontend est dans la liste CORS du backend
- Assurez-vous d'utiliser HTTPS en production

### Email non reçu
- Vérifier les spams
- Confirmer que EMAIL_PASS est un mot de passe d'application Gmail

### Connection refused
- Backend non démarré
- Mauvaise URL d'API
- Firewall bloquant le port

## 📞 Support

Pour toute question sur l'intégration :
1. Vérifiez les logs du serveur
2. Testez avec Postman/cURL
3. Consultez la console du navigateur

---

Votre système est maintenant prêt à recevoir des réservations depuis votre site Lovable.dev ! 🎉