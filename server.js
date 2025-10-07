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
/** cria transporter 465/SSL a partir das variáveis atuais */
/** 465/SSL */
function createSSL() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) return null;
  return require('nodemailer').createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),                      // 465
    secure: String(SMTP_SECURE || 'true') === 'true',
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: { rejectUnauthorized: false },
    family: 4,                // força IPv4
    connectionTimeout: 4000,
    greetingTimeout: 4000,
    socketTimeout: 4000,
  });
}

/** 587/STARTTLS */
function createSTARTTLS() {
  const { SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  return require('nodemailer').createTransport({
    host: SMTP_HOST,                             // ex.: smtp.uhserver.com
    port: 587,
    secure: false,                               // STARTTLS
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: { rejectUnauthorized: false },
    family: 4,
    connectionTimeout: 4000,
    greetingTimeout: 4000,
    socketTimeout: 4000,
  });
}

function verifyWithTimeout(transporter, ms = 4000) {
  return Promise.race([
    transporter.verify().then(() => ({ ok: true })),
    new Promise(resolve => setTimeout(() => resolve({ ok: false, error: 'verify-timeout' }), ms + 200))
  ]).catch(e => ({ ok: false, error: e?.message || String(e) }));
}



/** resolve um transporter pronto para uso (testa SSL e depois STARTTLS) */
async function ensureTransport() {
  // tenta SSL(465) conforme variáveis
  let t = createSSL();
  if (t) {
    const r = await verifyWithTimeout(t);
    if (r.ok) return { transporter: t, mode: 'SSL(465)' };
  }
  // fallback: STARTTLS(587)
  t = createSTARTTLS();
  if (t) {
    const r = await verifyWithTimeout(t);
    if (r.ok) return { transporter: t, mode: 'STARTTLS(587)' };
    return { transporter: null, mode: null, error: r.error || 'falha STARTTLS' };
  }
  return { transporter: null, mode: null, error: 'Variáveis SMTP ausentes/incompletas' };
}


/** endpoint de diagnóstico: testa ambos os modos e retorna o erro real */
app.get('/api/auth/_debug-smtp', async (_req, res) => {
  const sslT = createSSL();
  const stT  = createSTARTTLS();

  const [sslRes, stRes] = await Promise.all([
    sslT ? verifyWithTimeout(sslT) : Promise.resolve({ ok: false, error: 'vars faltando (SSL)' }),
    stT  ? verifyWithTimeout(stT)  : Promise.resolve({ ok: false, error: 'vars faltando (STARTTLS)' }),
  ]);

  res.json({
    host: process.env.SMTP_HOST || null,
    user: !!process.env.SMTP_USER,
    ssl: sslRes,            // { ok: true/false, error?: '...' }
    starttls: stRes
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

    // obtém transporter válido (tenta SSL 465; se falhar, STARTTLS 587)
    const { transporter, mode, error } = await ensureTransport();
    if (!transporter) {
      const devPayload = process.env.NODE_ENV !== 'production' ? { demoCode: code } : {};
      return res
        .status(503)
        .json({ ok: false, error: `SMTP indisponível: ${error}`, ...devPayload });
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
        <p style="color:#999;font-size:12px">Transporte usado: ${mode}</p>
      </div>
    `;

    await transporter.sendMail({
      from,
      to: email,
      subject: `Seu código de acesso (${appName})`,
      text: `Seu código é: ${code} (expira em ${CODE_TTL_MIN} minutos).`,
      html,
    });

    const devPayload = process.env.NODE_ENV !== 'production' ? { demoCode: code } : {};
    return res.json({ ok: true, message: `Código enviado via ${mode}.`, ...devPayload });
  } catch (err) {
    console.error('Erro ao preparar/envio do e-mail:', err?.message || err);
    return res.status(500).json({ ok: false, error: 'Falha ao enviar e-mail.' });
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
