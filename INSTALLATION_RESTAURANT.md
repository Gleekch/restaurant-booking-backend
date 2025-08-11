# Installation pour le Restaurant

## Option A : Interface Web (RECOMMANDÉ) 
Pas d'installation ! Utilisez simplement le navigateur :

1. Ouvrez Chrome/Edge/Firefox
2. Allez sur : `[URL de votre interface admin]`
3. Connectez-vous avec les identifiants
4. Créez un raccourci sur le bureau

## Option B : Application Desktop

### Ce dont vous avez besoin :
- Windows 10/11
- Connexion internet

### Installation simple (pour non-techniciens) :

1. **Téléchargez le dossier complet** depuis une clé USB ou lien

2. **Installez Node.js** :
   - Allez sur https://nodejs.org
   - Téléchargez la version LTS
   - Installez (suivez les étapes par défaut)

3. **Configurez l'application** :
   - Ouvrez le dossier BOOKING
   - Double-cliquez sur `install.bat`
   - Attendez que l'installation se termine

4. **Modifiez la connexion** :
   Ouvrez `desktop/renderer.js` et changez :
   ```javascript
   const API_URL = 'https://restaurant-booking-backend-y3sp.onrender.com/api';
   ```

5. **Lancez l'application** :
   - Double-cliquez sur `start-desktop.bat`
   - L'application s'ouvre automatiquement

### Créer un raccourci Bureau :
1. Clic droit sur `start-desktop.bat`
2. "Envoyer vers" → "Bureau"
3. Renommez le raccourci "Réservations Restaurant"

## Option C : Solution PROFESSIONNELLE

### Application installable (.exe) :
Je peux créer une vraie application Windows :
- Un seul fichier .exe à installer
- Mises à jour automatiques
- Icône personnalisée
- Connexion automatique au serveur

Avec Electron Builder :
```json
{
  "build": {
    "appId": "com.aumurmuredesflots.reservations",
    "productName": "Au Murmure des Flots - Réservations",
    "directories": {
      "output": "dist"
    },
    "win": {
      "target": "nsis",
      "icon": "assets/icon.ico"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true
    }
  }
}
```

## 🎯 Ma Recommandation :

**Créez plutôt une interface web admin** :
- Plus simple à maintenir
- Accessible partout (même depuis un smartphone)
- Pas d'installation sur chaque PC
- Mises à jour instantanées

Voulez-vous que je crée :
1. Une interface web admin ?
2. Un installateur Windows (.exe) ?
3. Les deux ?