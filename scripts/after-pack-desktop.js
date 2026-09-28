const fs = require('fs');
const path = require('path');

function assertSafePackagedFiles(files) {
  const forbidden = files.some(name => {
    const normalized = name.replace(/\\/g, '/');
    return /(^|\/)\.env($|[./])/.test(normalized)
      || /(^|\/)operator-connection(?:\.|$)/.test(normalized)
      || /^\/?backend\//.test(normalized);
  });
  if (forbidden) throw new Error('Configuration privee interdite dans le paquet desktop');
}

async function afterPack(context) {
  // Never read the server .env or copy credentials into a distributable.
  const resources = path.join(context.appOutDir, 'resources');
  assertSafePackagedFiles(fs.readdirSync(resources));
  const asar = require('@electron/asar');
  assertSafePackagedFiles(asar.listPackage(path.join(resources, 'app.asar')));
}

module.exports = afterPack;
module.exports.assertSafePackagedFiles = assertSafePackagedFiles;
