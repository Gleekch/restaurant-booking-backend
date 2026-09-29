jest.mock('../../models/FloorPlan', () => ({ findById: jest.fn(), create: jest.fn(), findOneAndUpdate: jest.fn() }));
jest.mock('../../models/Reservation', () => ({ find: jest.fn() }));
const FloorPlan = require('../../models/FloorPlan');
const Reservation = require('../../models/Reservation');
const service = require('../floorPlanService');
const ctx = service.context('2026-09-30', 'midi');
let records, documents;
const table = (id = 'T1', zone = 'terrace') => ({ id, name: id, zone, shape: 'rectangle', seats: 2, x: 50, y: 50, width: 120, height: 90 });
const payload = (tables = [table()], assignments = []) => ({ revision: 0, layout: { ...service.emptyLayout(), tables }, assignments });
const assignment = (id = 'r1', tableIds = ['T1']) => ({ reservationId: id, tableIds, fingerprint: service.fingerprint(records.find(r => r._id === id)) });
beforeEach(() => {
  jest.clearAllMocks(); documents = new Map();
  records = [{ _id: 'r1', customerName: 'Fixture', date: '2026-09-30', time: '12:00', numberOfPeople: 2, status: 'confirmed' }];
  Reservation.find.mockImplementation(() => ({ select: () => ({ lean: async () => records.filter(r => !['cancelled', 'awaiting-payment'].includes(r.status)) }) }));
  FloorPlan.findById.mockImplementation(id => ({ lean: async () => documents.get(id) || null }));
  FloorPlan.create.mockImplementation(async doc => {
    if (documents.has(doc._id)) throw Object.assign(new Error('duplicate'), { code: 11000 });
    documents.set(doc._id, doc); return doc;
  });
  FloorPlan.findOneAndUpdate.mockImplementation(async (query, update) => {
    if (documents.get(query._id)?.revision !== query.revision) return null;
    const doc = { _id: query._id, ...update.$set }; documents.set(query._id, doc); return doc;
  });
});
test('empty service and two zones without inventing any tables', async () => {
  const data = await service.get(ctx); expect(data.layout.tables).toEqual([]); expect(data.layout.zones).toHaveLength(2); expect(data.revision).toBe(0);
});
test('restaurant catalog contains precisely the 23 supplied numbers and no assumed capacities/zones', async () => {
  const data = await service.get(ctx);
  expect(data.tableCatalog).toEqual(['1','2','3','4','5','10','11','12','14','15','20','21','22','23','24','40','41','42','100','101','102','103','200']);
  expect(data.layout.tables).toEqual([]); expect(FloorPlan.create).not.toHaveBeenCalled();
});
test('service capacity can be adapted without changing the template or the number of guests', async () => {
  await service.save(service.context(null, null, true), payload([table('1')]));
  const before = JSON.stringify(records);
  const result = await service.save(ctx, payload([{ ...table('1'), seats: 6 }], [assignment('r1', ['1'])]));
  expect(result.layout.tables[0].seats).toBe(6);
  expect((await service.get(service.context(null, null, true))).layout.tables[0].seats).toBe(2);
  expect(JSON.stringify(records)).toBe(before);
});
test('service snapshot stays independent of subsequent template changes', async () => {
  await service.save(service.context(null, null, true), payload());
  const inherited = await service.get(ctx); expect(inherited.inherited).toBe(true);
  await service.save(ctx, payload());
  await service.save(service.context(null, null, true), { ...payload([table('T2')]), revision: 1 });
  expect((await service.get(ctx)).layout.tables[0].id).toBe('T1');
  expect((await service.get(service.context('2026-10-01', 'soir'))).layout.tables[0].id).toBe('T2');
});
test('assignment is separate from reservation and financial data', async () => {
  const before = JSON.stringify(records);
  const result = await service.save(ctx, payload([table()], [assignment()]));
  expect(result.assignments[0].review).toBe(false); expect(JSON.stringify(records)).toBe(before);
  expect(Object.keys(Reservation)).toEqual(['find']);
});
test('two simultaneous first saves cannot overwrite each other', async () => {
  const results = await Promise.allSettled([service.save(ctx, payload()), service.save(ctx, payload())]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.find(r => r.status === 'rejected').reason.status).toBe(409);
});
test('existing revision conflict is rejected', async () => {
  await service.save(ctx, payload());
  await service.save(ctx, { ...payload(), revision: 1 });
  await expect(service.save(ctx, { ...payload(), revision: 1 })).rejects.toMatchObject({ status: 409 });
});
test('a group may use multiple tables in one zone', async () => {
  records[0].numberOfPeople = 4;
  const data = await service.save(ctx, payload([table('T1'), table('T2')], [assignment('r1', ['T1', 'T2'])]));
  expect(data.assignments[0].tableIds).toHaveLength(2);
});
test('a table cannot be assigned twice in the same service', async () => {
  records.push({ ...records[0], _id: 'r2' });
  await expect(service.save(ctx, payload([table()], [assignment(), assignment('r2')]))).rejects.toThrow('attribuee deux fois');
});
test('group cannot span terrace and inside', async () => {
  await expect(service.save(ctx, payload([table('T1'), table('T2', 'inside')], [assignment('r1', ['T1', 'T2'])]))).rejects.toThrow('meme zone');
});
test('not enough seats is rejected', async () => {
  records[0].numberOfPeople = 4;
  await expect(service.save(ctx, payload([table()], [assignment()]))).rejects.toThrow('insuffisantes');
});
test.each(['cancelled', 'awaiting-payment'])('unavailable %s booking is never placed', async status => {
  const a = assignment(); records[0].status = status;
  await expect(service.save(ctx, payload([table()], [a]))).rejects.toMatchObject({ status: 409 });
});
test('changed party/date/time is detected on reading and saving', async () => {
  const p = payload([table()], [assignment()]); await service.save(ctx, p);
  records[0].time = '13:00';
  expect((await service.get(ctx)).assignments[0].review).toBe(true);
  await expect(service.save(ctx, { ...p, revision: 1 })).rejects.toThrow('change');
});
test('cancelled booking retains a visible review marker until staff removes placement', async () => {
  await service.save(ctx, payload([table()], [assignment()])); records[0].status = 'cancelled';
  const data = await service.get(ctx); expect(data.bookings).toHaveLength(0); expect(data.assignments[0].review).toBe(true);
  expect((await service.save(ctx, { ...payload(), revision: 1 })).assignments).toHaveLength(0);
});
test('unpaid required deposits are excluded and service matches time', async () => {
  records.push({ ...records[0], _id: 'r2', time: '19:00' }, { ...records[0], _id: 'r3', deposit: { required: true, status: 'awaiting' } });
  expect((await service.get(ctx)).bookings.map(b => b.id)).toEqual(['r1']);
});
test.each([['2026-10-04', 'soir'], ['2026-10-05', 'midi'], ['2026-10-06', 'soir']])('closure is reported for %s %s', async (date, slot) => {
  expect((await service.get(service.context(date, slot))).closed).toBe(true);
});
test('open lunch remains open', async () => { expect((await service.get(ctx)).closed).toBe(false); });
test.each([null, '2026-02-30', '../secrets', ['2026-10-01']])('invalid date is rejected', date => { expect(() => service.context(date, 'midi')).toThrow('Date invalide'); });
test.each([{ seats: 0 }, { seats: 1.5 }, { width: 5000 }, { x: -1 }, { y: Infinity }, { zone: 'other' }, { id: '<script>' }, { shape: 'script' }])('invalid table is rejected: %j', patch => {
  expect(() => service.validateLayout(payload([{ ...table(), ...patch }]).layout)).toThrow();
});
test('duplicate labels and table IDs are rejected', () => {
  expect(() => service.validateLayout(payload([table(), table()]).layout)).toThrow();
  expect(() => service.validateLayout(payload([table(), { ...table('T2'), name: 't1' }]).layout)).toThrow('distinct');
});
test('template cannot carry bookings', async () => {
  await expect(service.save(service.context(null, null, true), payload([table()], [assignment()]))).rejects.toThrow('plan type');
});
