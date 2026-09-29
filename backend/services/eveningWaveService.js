// Shared by staff load reporting and public slot metadata. Bounds are half-open.
function getEveningWaves(bounds) {
  return [
    { id: 'soir-tapas', label: 'Tapas', kind: 'tapas', from: bounds.soirStart, to: 1140, endExclusive: true },
    { id: 'soir-1', label: 'Vague 1 - Plats', kind: 'dinner', from: 1140, to: 1200 },
    { id: 'soir-2', label: 'Vague 2 - Plats', kind: 'dinner', from: 1200, to: 1260 },
    { id: 'soir-3', label: 'Vague 3 - Plats', kind: 'dinner', from: 1260, to: bounds.soirEnd + 1 }
  ];
}

module.exports = { getEveningWaves };
