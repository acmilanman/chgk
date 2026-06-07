const fs = require('fs');
const path = require('path');

async function ensureDir(dir) {
  await fs.promises.mkdir(dir, { recursive: true }).catch(() => {});
}

async function readJson(filePath, defaultValue) {
  try {
    const data = await fs.promises.readFile(filePath, 'utf8');
    if (data && data.trim()) return JSON.parse(data);
  } catch (e) {
    // ignore and return default
  }
  return defaultValue;
}

async function writeJson(filePath, obj) {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  const data = JSON.stringify(obj, null, 2);
  await fs.promises.writeFile(filePath, data, 'utf8');
  return true;
}

module.exports = {
  ensureDir,
  readJson,
  writeJson
};
