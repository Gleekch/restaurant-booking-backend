const router = require('express').Router();
const service = require('../services/floorPlanService');
router.use(require('../middleware/auth').apiKey);
router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
for (const path of ['/template', '/service']) {
  const ctx = req => service.context(req.query.date, req.query.service, path === '/template');
  const error = (res, e) => res.status(e.status || 503).json({ success: false, message: e.status ? e.message : 'Plan indisponible. Vos reservations restent inchangees.' });
  router.get(path, async (req, res) => {
    try { res.json({ success: true, data: await service.get(ctx(req)) }); } catch (e) { error(res, e); }
  });
  router.put(path, async (req, res) => {
    try { res.json({ success: true, data: await service.save(ctx(req), req.body) }); } catch (e) { error(res, e); }
  });
}
module.exports = router;
