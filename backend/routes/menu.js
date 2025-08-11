const express = require('express');
const router = express.Router();

// Base de données du menu (pourrait être dans MongoDB)
const menu = {
  starters: [
    { name: 'Salade César', price: 12, description: 'Salade romaine, parmesan, croûtons' },
    { name: 'Soupe à l\'oignon', price: 10, description: 'Gratinée au fromage' },
    { name: 'Carpaccio de bœuf', price: 15, description: 'Huile d\'olive, parmesan, roquette' }
  ],
  mains: [
    { name: 'Entrecôte grillée', price: 28, description: 'Frites maison, sauce béarnaise' },
    { name: 'Saumon en papillote', price: 24, description: 'Légumes de saison' },
    { name: 'Risotto aux champignons', price: 22, description: 'Parmesan, truffe' }
  ],
  desserts: [
    { name: 'Tiramisu', price: 8, description: 'Recette traditionnelle' },
    { name: 'Crème brûlée', price: 7, description: 'Vanille de Madagascar' },
    { name: 'Tarte aux pommes', price: 7, description: 'Glace vanille' }
  ],
  menuDuJour: {
    price: 35,
    description: 'Entrée + Plat + Dessert',
    available: true
  }
};

// Obtenir le menu complet
router.get('/', (req, res) => {
  res.json({
    success: true,
    data: menu
  });
});

// Obtenir une catégorie spécifique
router.get('/:category', (req, res) => {
  const category = req.params.category;
  if (menu[category]) {
    res.json({
      success: true,
      data: menu[category]
    });
  } else {
    res.status(404).json({
      success: false,
      message: 'Catégorie non trouvée'
    });
  }
});

module.exports = router;