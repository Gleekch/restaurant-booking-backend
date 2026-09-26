const publicFields = ['customerName', 'phoneNumber', 'email', 'numberOfPeople', 'date', 'time', 'specialRequests'];
const staffFields = [...publicFields, 'source', 'status', 'table', 'notes'];

function reservationInput(body, staff = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Reservation invalide');
  const allowed = staff ? staffFields : publicFields;
  if (staff && Object.keys(body).some(key => !allowed.includes(key))) {
    throw new Error('Champ protege : utilisez les actions dediees aux paiements.');
  }
  const result = {};
  for (const key of allowed) {
    if (!Object.hasOwn(body, key)) continue;
    const value = body[key];
    if (key === 'numberOfPeople') {
      if (!Number.isSafeInteger(Number(value)) || Number(value) < 1) throw new Error('Nombre de couverts invalide');
      result[key] = Number(value);
    } else {
      if (key === 'table' && value === null) { result[key] = null; continue; }
      if (typeof value !== 'string' || value.length > (['notes', 'specialRequests'].includes(key) ? 4000 : 320)) {
        throw new Error('Champ de reservation invalide : ' + key);
      }
      result[key] = value;
    }
  }
  if (result.status && !['pending', 'confirmed', 'cancelled'].includes(result.status)) {
    throw new Error('Utilisez l action dediee pour changer ce statut.');
  }
  return result;
}

module.exports = { reservationInput };
