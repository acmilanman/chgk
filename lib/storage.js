const fs = require('fs');
const path = require('path');

async function ensureDir(dir) {
  await fs.promises.mkdir(dir, { recursive: true }).catch(() => {});
}

async function readText(filePath, defaultValue) {
  try {
    const data = await fs.promises.readFile(filePath, 'utf8');
    if (data && data.trim()) return data;
  } catch (e) {
    // ignore
  }
  return defaultValue;
}

async function writeText(filePath, text) {
  try {
    await ensureDir(path.dirname(filePath));
    await fs.promises.writeFile(filePath, text, 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = { ensureDir, readText, writeText };
