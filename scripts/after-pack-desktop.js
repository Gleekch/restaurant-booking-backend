const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const DESKTOP_ENV_KEYS = ['BACKEND_URL', 'API_KEY'];

function pickDesktopConfig(source) {
  return Object.fromEntries(
    DESKTOP_ENV_KEYS
      .filter((key) => typeof source[key] === 'string' && source[key].length > 0)
      .map((key) => [key, source[key]])
  );
}

function serializeDesktopConfig(config) {
  return Object.entries(config)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join('\n') + '\n';
}

async function afterPack(context) {
  const sourcePath = path.join(context.packager.projectDir, '.env');
  if (!fs.existsSync(sourcePath)) {
    throw new Error('Le fichier .env serveur est requis pour preparer la configuration desktop');
  }

  const source = dotenv.parse(fs.readFileSync(sourcePath));
  const desktopConfig = pickDesktopConfig(source);
  if (!desktopConfig.API_KEY) {
    throw new Error('API_KEY est requis pour construire l application desktop');
  }

  const outputPath = path.join(context.appOutDir, 'resources', '.env');
  fs.writeFileSync(outputPath, serializeDesktopConfig(desktopConfig), {
    encoding: 'utf8',
    mode: 0o600
  });
}

module.exports = afterPack;
module.exports.pickDesktopConfig = pickDesktopConfig;
module.exports.serializeDesktopConfig = serializeDesktopConfig;
