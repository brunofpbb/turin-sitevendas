// server.js
require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
// use node-fetch v2 (CommonJS) no package.json
const fetch = require('node-fetch');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

/* ========= Static: detecta pasta pública e configura fallback ========= */
const PUBLIC_DIR = fs.existsSync(path.join(__dirname, 'sitevendas'))
  ? path.join(__dirname, 'sitevendas')
  : __dirname;

app.use(express.static(PUBLIC_DIR));
app.use(express.json());

// healthcheck p/ Railway
app.get('/health', (_req, res) => res.json({ ok: true, publicDir: PUBLIC_DIR }));

/* =================== SMTP (login por e-mail) =================== */
/** Cria transporte primário conforme variáveis definidas (ex.: 465/SSL) */
function createPrimaryTransport() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_PORT || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: String(process.env.SMTP_SECURE || 'true') === 'true', // 465 => true
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    tls: { rejectUnauthorized: false },
  });
}

/** Fallback típico para PaaS: 587/STARTTLS */
function createFallbackTransport() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: 587,
    secure: false, // STARTTLS
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    tls: { rejectUnauthorized: false },
  });
}

let transporter = createPrimaryTransport();
let transporterInfo = { active: false, mode: null, error: null };

// Verifica ao subir; se falhar, tenta fallback 587/STARTTLS
(async () => {
  try {
    if (transporter) {
      await transporter.verify();
      transporterInfo = {
        active: true,
        mode: `${process.env.SMTP_PORT}/${String(process.env.SMTP_SECURE || 'true') === 'true' ? 'SSL' : 'STARTTLS'}`,
        error: null
      };
      console.log('[SMTP] OK em', transporterInfo.mode);
    } else {
      throw new Error('Vars SMTP ausentes');
    }
  } catch (e) {
    console.warn('[SMTP] primário falhou:', e.message);
    try {
      const fb = createFallbackTransport();
      if (!fb) throw new Error('Sem vars SMTP para fallback');
      await fb.verify();
      transporter = fb;
      transporterInfo = { active: true, mode: '587/STARTTLS', error: null };
      console.log('[SMTP] Fallback OK em', transporterInfo.mode);
    } catch (e2) {
      console.error('[SMTP] fallback também falhou:', e2.message);
      transporter = null;
      transporterInfo = { active: false, mode: null, error: e2.message };
    }
  }
})();

// Endpoint de debug SMTP (não expõe segredos)
app.get('/api/auth/_debug-smtp', (_req, res) => {
  res.json({
    ok: transporterInfo.active,
    mode: transporterInfo.mode,
    error: transporterInfo.error,
    user: process.env.SMTP_USER ? 'set' : 'missing',
    host: process.env.SMTP_HOST || 'missing'
  });
});

// memória simples p/ códigos
const codes = new Map();
const CODE_TTL_MIN = 10;
const MAX_ATTEMPTS = 6;

const genCode = () => Math.floor(100000 + Math.random() * 900000).toString();
const normalizeEmail = e => String(e || '').trim().toLowerCase();

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of codes.entries()) if (v.expiresAt <= now) codes.delete(k);
}, 60 * 1000);

// solicitar código
app.post('/api/auth/request-code', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ ok: false, error: 'E-mail inválido.' });
    }

    const code = genCode();
    const expiresAt = Date.now() + CODE_TTL_MIN * 60 * 1000;
    codes.set(email, { code, expiresAt, attempts: 0 });

    if (!transporter) {
      // sem SMTP funcional: não tenta enviar; informa indisponibilidade
      const devPayload = process.env.NODE_ENV !== 'production' ? { demoCode: code } : {};
      return res.status(503).json({ ok: false, error: 'SMTP indisponível', ...devPayload });
    }

    const appName = process.env.APP_NAME || 'Turin Transportes';
    const fromName = process.env.SUPPORT_FROM_NAME || 'Turin Transportes';
    const from = `"${fromName}" <${process.env.SMTP_USER}>`; // remetente == usuário SMTP

    const html = `
      <div style="font-family:Arial,sans-serif;font-size:16px;color:#222">
        <p>Olá,</p>
        <p>Seu código de acesso ao <b>${appName}</b> é:</p>
        <p style="font-size:28px;letter-spacing:3px;margin:16px 0"><b>${code}</b></p>
        <p>Ele expira em ${CODE_TTL_MIN} minutos.</p>
        <p style="color:#666;font-size:13px">Se não foi você, ignore este e-mail.</p>
      </div>
    `;

    try {
      await transporter.sendMail({
        from, to: email,
        subject: `Seu código de acesso (${appName})`,
        text: `Seu código é: ${code} (expira em ${CODE_TTL_MIN} minutos).`,
        html,
      });
      const devPayload = process.env.NODE_ENV !== 'production' ? { demoCode: code } : {};
      return res.json({ ok: true, message: 'Código enviado.', ...devPayload });
    } catch (sendErr) {
      console.error('[SMTP] erro ao enviar:', sendErr?.message || sendErr);
      return res.status(502).json({ ok: false, error: 'Não foi possível enviar o e-mail agora.' });
    }
  } catch (err) {
    console.error('Erro ao preparar envio:', err);
    res.status(500).json({ ok: false, error: 'Falha ao enviar e-mail.' });
  }
});

// verificar código
app.post('/api/auth/verify-code', (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const code = String(req.body?.code || '');
  if (!email || !code) return res.status(400).json({ ok: false, error: 'E-mail e código são obrigatórios.' });

  const entry = codes.get(email);
  if (!entry) return res.status(400).json({ ok: false, error: 'Solicite um novo código.' });
  if (entry.expiresAt < Date.now()) { codes.delete(email); return res.status(400).json({ ok: false, error: 'Código expirado. Solicite outro.' }); }
  if (entry.attempts >= MAX_ATTEMPTS) { codes.delete(email); return res.status(429).json({ ok: false, error: 'Muitas tentativas. Solicite outro código.' }); }

  entry.attempts += 1;
  if (entry.code !== code) return res.status(400).json({ ok: false, error: 'Código incorreto.' });

  codes.delete(email);
  const user = { email, name: email.split('@')[0], createdAt: new Date().toISOString() };
  res.json({ ok: true, user });
});

/* =================== Praxio: Partidas =================== */
app.post('/api/partidas', async (req, res) => {
  try {
    const { origemId, destinoId, data } = req.body;

    const loginBody = {
      Nome: process.env.PRAXIO_USER,
      Senha: process.env.PRAXIO_PASS,
      Sistema: 'WINVR.EXE',
      TipoBD: 0,
      Empresa: process.env.PRAXIO_EMP,
      Cliente: process.env.PRAXIO_CLIENT,
      TipoAplicacao: 0,
    };
    const loginResp = await fetch('https://oci-parceiros2.praxioluna.com.br/Autumn/Login/efetualogin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(loginBody),
    });
    const loginData = await loginResp.json();
    const idSessaoOp = loginData.IdSessaoOp;

    const partidasBody = {
      IdSessaoOp: idSessaoOp,
      LocalidadeOrigem: origemId,
      LocalidadeDestino: destinoId,
      DataPartida: data,
      SugestaoPassagem: '1',
      ListarTodas: '1',
      SomenteExtra: '0',
      TempoPartida: 1,
      IdEstabelecimento: '1',
      DescontoAutomatico: 0,
    };
    const partResp = await fetch('https://oci-parceiros2.praxioluna.com.br/Autumn/Partidas/Partidas', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(partidasBody),
    });
    const partData = await partResp.json();
    res.json(partData);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao consultar partidas' });
  }
});

/* =================== Praxio: Poltronas =================== */
app.post('/api/poltronas', async (req, res) => {
  try {
    const { idViagem, idTipoVeiculo, idLocOrigem, idLocDestino } = req.body;

    const loginBody = {
      Nome: process.env.PRAXIO_USER, Senha: process.env.PRAXIO_PASS,
      Sistema: 'WINVR.EXE', TipoBD: 0, Empresa: process.env.PRAXIO_EMP,
      Cliente: process.env.PRAXIO_CLIENT, TipoAplicacao: 0,
    };
    const loginResp = await fetch('https://oci-parceiros2.praxioluna.com.br/Autumn/Login/efetualogin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(loginBody),
    });
    const loginData = await loginResp.json();
    const idSessaoOp = loginData.IdSessaoOp;

    const seatBody = {
      IdSessaoOp: idSessaoOp,
      IdViagem: idViagem,
      IdTipoVeiculo: idTipoVeiculo,
      IdLocOrigem: idLocOrigem,
      IdLocdestino: idLocDestino,
      Andar: 0,
      VerificarSugestao: 1,
    };
    const seatResp = await fetch('https://oci-parceiros2.praxioluna.com.br/Autumn/Poltrona/RetornaPoltronas', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(seatBody),
    });
    const seatData = await seatResp.json();
    res.json(seatData);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao consultar poltronas' });
  }
});

/* =================== SPA fallback =================== */
app.get('*', (_req, res) => {
  const indexPath = fs.existsSync(path.join(PUBLIC_DIR, 'index.html'))
    ? path.join(PUBLIC_DIR, 'index.html')
    : path.join(__dirname, 'index.html');
  res.sendFile(indexPath);
});

/* =================== Start =================== */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORT} | publicDir: ${PUBLIC_DIR}`);
});

process.on('unhandledRejection', r => console.error('UnhandledRejection:', r));
process.on('uncaughtException', e => console.error('UncaughtException:', e));
