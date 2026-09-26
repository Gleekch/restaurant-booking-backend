const { reservationInput } = require('../reservationInputService');
test('public inputs cannot set ids, tokens, financial or operator fields', () => {
  expect(reservationInput({ customerName: 'Test', numberOfPeople: 2, _id: 'chosen',
    cancellationToken: 'chosen', deposit: { status: 'paid' }, 'deposit.status': 'paid',
    status: 'confirmed', source: 'desktop', notes: 'internal' })).toEqual({ customerName: 'Test', numberOfPeople: 2 });
});
test.each([{ deposit: { status: 'paid' } }, { $set: { status: 'confirmed' } },
  { 'deposit.status': 'paid' }, { cancellationToken: 'known' }, { status: 'completed' }])('staff cannot spoof protected state %j', payload => {
  expect(() => reservationInput(payload, true)).toThrow();
});
test('text is preserved in storage, escaping belongs at display time', () => {
  const customerName = '<img src=x onerror=alert(1)>';
  expect(reservationInput({ customerName }).customerName).toBe(customerName);
});
