// services/ticket/utils.js
const dayjs = require('dayjs');
require('dayjs/locale/pt-br');     // registra o locale
dayjs.locale('pt-br');

exports.asBRDate = (isoLike) => {
  if (!isoLike) return '';
  const d = dayjs(isoLike);
  return d.isValid() ? d.format('DD/MM/YYYY') : String(isoLike);
};

exports.asBRTimeHHMM = (hhmm) => {
  if (!hhmm) return '';
  const s = String(hhmm).padStart(4, '0');
  return `${s.slice(0,2)}:${s.slice(2)}`;
};

exports.moneyBR = (n) =>
  (Number(n) || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });

exports.sanitizeFile = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^\w\s-]/g, '').trim().replace(/\s+/g,'_').slice(0,60);
