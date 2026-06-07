const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const AdmZip = require('adm-zip');
const express = require('express');
const logger = require('../lib/logger');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SOUNDS_DIR = path.join(DATA_DIR, 'sounds');
const IMAGES_DIR = path.join(DATA_DIR, 'images');

function createRouter(state) {
  const router = express.Router();

  router.post('/upload-sound/:type', express.raw({ limit: '2mb', type: 'audio/*' }), (req, res) => {
    const type = req.params.type;
    const requiredToken = process.env.ADMIN_TOKEN;
    if (requiredToken) {
      const token = String(req.headers['x-admin-token'] || '');
      if (token !== requiredToken) {
        logger.warn('Unauthorized sound upload attempt');
        return res.status(401).json({ ok: false, message: 'Unauthorized' });
      }
    }
    if (type !== 'beep' && type !== 'gong') {
      return res.status(400).json({ ok: false, message: 'Неверный тип звука' });
    }
    const filePath = path.join(SOUNDS_DIR, `${type}.mp3`);
    try {
      fs.writeFileSync(filePath, req.body);
      fs.chmodSync(filePath, 0o644);
      logger.info(`Sound uploaded: ${type}.mp3`);
      state.reloadSoundCache();
      state.broadcast('sounds_update', state.cachedSounds, 'admin');
      if (state.game.soundEnabledCaptains) state.broadcast('sounds_update', state.cachedSounds, 'captain');
      if (state.game.soundEnabledScreens) state.broadcast('sounds_update', state.cachedSounds, 'player');
      res.json({ ok: true });
    } catch (err) {
      logger.error(`Error saving sound ${type}: ${err.message}`);
      res.status(500).json({ ok: false, message: 'Ошибка сохранения' });
    }
  });

  router.post('/upload-questions-package', express.raw({ limit: '50mb', type: 'application/zip' }), (req, res) => {
    const requiredToken = process.env.ADMIN_TOKEN;
    if (requiredToken) {
      const token = String(req.headers['x-admin-token'] || '');
      if (token !== requiredToken) {
        return res.status(401).json({ ok: false, message: 'Unauthorized' });
      }
    }
    try {
      const zip = new AdmZip(req.body);
      const zipEntries = zip.getEntries();
      const xlsxEntry = zipEntries.find(e => e.entryName === 'questions.xlsx' || e.entryName.endsWith('.xlsx'));
      if (!xlsxEntry) {
        return res.status(400).json({ ok: false, message: 'ZIP не содержит questions.xlsx' });
      }
      const wb = XLSX.read(xlsxEntry.getData(), { type: 'buffer' });
      const ws0 = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws0, { defval: '' });
      const questions = rows.map(r => ({
        text: String(r.Question ?? r.question ?? r.Вопрос ?? '').trim(),
        answer: String(r.Answer ?? r.answer ?? r.Ответ ?? '').trim(),
        comment: String(r.Comment ?? r.comment ?? r.Комментарий ?? '').trim(),
        handoutImage: String(r.HandoutImage ?? r.handoutImage ?? '').trim(),
        commentImage: String(r.CommentImage ?? r.commentImage ?? '').trim(),
        warmup: (r.Warmup === 'Да' || r.warmup === true)
      })).filter(q => q.text);
      if (!questions.length) {
        return res.status(400).json({ ok: false, message: 'Нет вопросов в XLSX' });
      }
      questions.forEach(q => {
        ['handoutImage', 'commentImage'].forEach(field => {
          const fname = q[field];
          if (!fname) return;
          const entry = zipEntries.find(e => e.entryName === `images/${fname}`);
          if (entry) {
            const stored = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${fname}`;
            const dest = path.join(IMAGES_DIR, stored);
            fs.writeFileSync(dest, entry.getData());
            q[field] = `/i/${stored}`;
          } else {
            q[field] = '';
          }
        });
      });
      const result = state.loadQuestions(questions);
      logger.info(`Questions package loaded: ${questions.length} questions`);
      res.json({ ok: true, message: result.message });
    } catch (err) {
      logger.error(`Error importing package: ${err.message}`);
      res.status(500).json({ ok: false, message: 'Ошибка импорта пакета' });
    }
  });

  return router;
}

module.exports = { createRouter };
