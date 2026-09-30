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

function assertDesktopRuntime(files, readFile) {
  const entries = new Set(files.map(name => name.replace(/\\/g, '/').replace(/^\//, '')));
  const checked = new Set();
  const fail = name => { throw new Error(`Paquet desktop incomplet : ${name}`); };
  const isFile = name => {
    if (!entries.has(name)) return false;
    try { const content = readFile(name); return typeof content === 'string' || Buffer.isBuffer(content); }
    catch (_) { return false; }
  };
  for (const name of ['desktop/main.js', 'desktop/preload.js', 'desktop/connection-store.js', 'desktop/index.html', 'desktop/connection.html']) {
    if (!isFile(name)) fail(name);
  }
  function visit(name, from = '') {
    if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name)) fail('nom de dependance invalide');
    let dir = from, manifestPath;
    // Follow Node's nested/hoisted dependency lookup inside the archive, not on disk.
    while (true) {
      const candidate = path.posix.join(dir, 'node_modules', name, 'package.json');
      if (entries.has(candidate)) { manifestPath = candidate; break; }
      if (!dir || dir === '.') fail(`${name} requis par ${from || 'desktop'}`);
      dir = path.posix.dirname(dir);
    }
    if (checked.has(manifestPath)) return;
    checked.add(manifestPath);
    const manifest = JSON.parse(readFile(manifestPath).toString());
    const packageDir = path.posix.dirname(manifestPath);
    const entry = path.posix.join(packageDir, manifest.main || 'index.js');
    if (!entry.startsWith(packageDir + '/')) fail(`${name} : point d'entree invalide`);
    const candidates = [entry, `${entry}.js`, `${entry}.json`, `${entry}.node`,
      path.posix.join(entry, 'index.js'), path.posix.join(entry, 'index.json'), path.posix.join(entry, 'index.node')];
    if (!candidates.some(isFile)) fail(`${name} : point d'entree absent`);
    for (const dependency of Object.keys(manifest.dependencies || {})) {
      if (!Object.hasOwn(manifest.optionalDependencies || {}, dependency)) visit(dependency, packageDir);
    }
  }
  visit('socket.io-client');
  return checked.size;
}

async function afterPack(context) {
  // Never read the server .env or copy credentials into a distributable.
  const resources = path.join(context.appOutDir, 'resources');
  assertSafePackagedFiles(fs.readdirSync(resources));
  const asar = require('@electron/asar');
  const archive = path.join(resources, 'app.asar');
  const files = asar.listPackage(archive);
  assertSafePackagedFiles(files);
  assertDesktopRuntime(files, name => asar.extractFile(archive, path.normalize(name)));
}

module.exports = afterPack;
module.exports.assertSafePackagedFiles = assertSafePackagedFiles;
module.exports.assertDesktopRuntime = assertDesktopRuntime;
