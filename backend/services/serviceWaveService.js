const { getEveningWaves } = require('./eveningWaveService');

// One definition for public recommendations and the staff load display.
function getServiceWaves(bounds, service) {
  if (service === 'soir') return getEveningWaves(bounds);
  return [[bounds.midiStart, 765], [765, 795], [795, bounds.midiEnd + 1]]
    .map(([from, to], index) => ({ from, to, id: `midi-${index + 1}`, label: `Vague ${index + 1}` }));
}

module.exports = { getServiceWaves };
