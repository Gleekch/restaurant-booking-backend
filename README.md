# Système de Réservation Restaurant

Système complet de gestion des réservations pour restaurant avec interface web, mobile, desktop et agent vocal IA.

## Fonctionnalités

- **Multi-canal** : Réservations via site web, application mobile, téléphone (agent IA)
- **Notifications automatiques** : SMS et email aux responsables
- **Application Desktop** : Interface temps réel pour la caisse
- **Agent Vocal IA** : Réponse automatique aux appels clients
- **Gestion centralisée** : Base de données MongoDB unique

## Architecture

```
BOOKING/
├── backend/           # API Node.js/Express
│   ├── models/       # Modèles MongoDB
│   ├── routes/       # Endpoints API
│   └── services/     # Services (notifications, etc.)
├── desktop/          # Application Electron
└── package.json      # Dépendances du projet
```

## Installation

1. **Prérequis**
   - Node.js 16+
   - MongoDB
   - Compte Twilio (pour SMS/appels)

2. **Configuration**
   ```bash
   cp .env.example .env
   # Éditer .env avec vos paramètres
   ```

3. **Installation des dépendances**
   ```bash
   npm install
   ```

4. **Démarrage**
   ```bash
   # Backend API
   npm run dev

   # Application Desktop
   npm run desktop
   ```

## Configuration Twilio (Agent Vocal)

1. Créer un compte Twilio
2. Acheter un numéro de téléphone
3. Configurer le webhook : `https://votre-domaine.com/api/voice/incoming`
4. Ajouter les credentials dans `.env`

## API Endpoints

### Réservations
- `POST /api/reservations` - Créer une réservation
- `GET /api/reservations` - Lister les réservations
- `PUT /api/reservations/:id` - Modifier une réservation
- `DELETE /api/reservations/:id` - Annuler une réservation

### Notifications
- `POST /api/notifications/test` - Envoyer une notification test
- `POST /api/notifications/reminder/:id` - Envoyer un rappel

### Menu & Paramètres
- `GET /api/menu` - Obtenir le menu
- `GET /api/settings` - Obtenir les paramètres
- `POST /api/settings/availability` - Vérifier la disponibilité

## Intégration Web/Mobile

Pour intégrer avec votre site web ou application mobile existante :

```javascript
// Exemple d'intégration
const API_URL = 'http://localhost:3000';

// Créer une réservation
fetch(`${API_URL}/api/reservations`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    customerName: 'Jean Dupont',
    phoneNumber: '+33612345678',
    numberOfPeople: 4,
    date: '2024-01-15',
    time: '19:30',
    source: 'website'
  })
});
```

## WebSocket (Temps Réel)

L'application desktop se connecte automatiquement via WebSocket pour recevoir les mises à jour en temps réel :

```javascript
const socket = io('http://localhost:3000');

socket.on('new-reservation', (reservation) => {
  // Nouvelle réservation reçue
});
```

## Déploiement

1. **Backend** : Déployer sur Heroku, AWS, ou serveur VPS
2. **Desktop** : Compiler avec `electron-builder`
3. **Base de données** : MongoDB Atlas pour la production

## Technologies Utilisées

- **Backend** : Node.js, Express, MongoDB, Socket.io
- **Desktop** : Electron
- **Notifications** : Twilio (SMS/Appels), Nodemailer (Email)
- **Agent Vocal** : Twilio Voice API + Transcription

## Prochaines Étapes

1. Implémenter l'authentification JWT
2. Ajouter un tableau de bord analytics
3. Intégrer un système de paiement
4. Améliorer l'IA vocale avec GPT-4
5. Ajouter la gestion des tables