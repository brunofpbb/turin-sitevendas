// server.js
require('dotenv').config();

const express = require('express');
const fetch = require('node-fetch');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

/* -------------------------------------------------
 * STATIC & PARSERS
 * ------------------------------------------------- */
app.use(express.static('sitevendas'));
app.use(express.json());

/* -------------------------------------------------
 * SMTP (UHServer) - envio do código de login
 * Vars esperadas no .env:
 *   SMTP_HOST=smtps.uhserver.com
 *   SMTP_PORT=465
 *   SMTP_SECURE=true
 *   SMTP_USER=noreply@turintransportes.com.br
 *   SMTP_PASS=********
 *   APP_NAME=Turin Transportes
 *   SUPPORT_FROM_NAME=Turin Transportes
 * ------------------------------------------------- */
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtps.uhserver.com',
  port: Number(process.env.SMTP_PORT || 465),
  secure: String(process.env.SMTP_SECURE || 'true') === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: { rejectUnauthorized: false }, // compat com provedores que usam cadeia antiga
});

// store simples em memória para códigos de verificação
const codes = new Map(); // email -> { code, expiresAt, attempts }
const CODE_TTL_MIN = 10;
const MAX_ATTEMPTS = 6;

function genCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}
function normalizeEmail(e) {
  return String(e || '').trim().toLowerCase();
}
// limpeza periódica de expirados
setInterval(() => {
  const now = Date.now();
  for (const [email, data] of codes.entries()) {
    if (data.expiresAt <= now) codes.delete(email);
  }
}, 60 * 1000);

/* -------------------------------------------------
 * API: Autenticação por código (email)
 * ------------------------------------------------- */

// Solicitar código
app.post('/api/auth/request-code', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ ok: false, error: 'E-mail inválido.' });
    }

    const code = genCode();
    const expiresAt = Date.now() + CODE_TTL_MIN * 60 * 1000;
    codes.set(email, { code, expiresAt, attempts: 0 });

    const appName = process.env.APP_NAME || 'Turin Transportes';
    const fromName = process.env.SUPPORT_FROM_NAME || 'Turin Transportes';
    const from = `"${fromName}" <${process.env.SMTP_USER || 'noreply@turintransportes.com.br'}>`;

    const html = `
      <div style="font-family:Arial,sans-serif;font-size:16px;color:#222">
        <p>Olá,</p>
        <p>Seu código de acesso ao <b>${appName}</b> é:</p>
        <p style="font-size:28px;letter-spacing:3px;margin:16px 0"><b>${code}</b></p>
        <p>Ele expira em ${CODE_TTL_MIN} minutos.</p>
        <p style="color:#666;font-size:13px">Se não foi você, ignore este e-mail.</p>
      </div>
    `;

    await transporter.sendMail({
      from,
      to: email,
      subject: `Seu código de acesso (${appName})`,
      text: `Seu código de acesso é: ${code} (expira em ${CODE_TTL_MIN} minutos).`,
      html,
    });

    const devPayload =
      process.env.NODE_ENV === 'development' ? { demoCode: code } : {};

    res.json({ ok: true, message: 'Código enviado.', ...devPayload });
  } catch (err) {
    console.error('Erro ao enviar e-mail:', err);
    res.status(500).json({ ok: false, error: 'Falha ao enviar o e-mail do código.' });
  }
});

// Verificar código
app.post('/api/auth/verify-code', (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const code = String(req.body?.code || '');

  if (!email || !code) {
    return res.status(400).json({ ok: false, error: 'E-mail e código são obrigatórios.' });
  }

  const entry = codes.get(email);
  if (!entry) return res.status(400).json({ ok: false, error: 'Solicite um novo código.' });

  if (entry.expiresAt < Date.now()) {
    codes.delete(email);
    return res.status(400).json({ ok: false, error: 'Código expirado. Solicite outro.' });
  }

  if (entry.attempts >= MAX_ATTEMPTS) {
    codes.delete(email);
    return res.status(429).json({ ok: false, error: 'Muitas tentativas. Solicite outro código.' });
  }

  entry.attempts += 1;

  if (entry.code !== code) {
    return res.status(400).json({ ok: false, error: 'Código incorreto.' });
  }

  // sucesso
  codes.delete(email);
  const user = {
    email,
    name: email.split('@')[0],
    createdAt: new Date().toISOString(),
  };
  res.json({ ok: true, user });
});

/* -------------------------------------------------
 * API: Praxio — Partidas
 * ------------------------------------------------- */
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

    const loginResp = await fetch(
      'https://oci-parceiros2.praxioluna.com.br/Autumn/Login/efetualogin',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginBody),
      }
    );
    const loginData = await loginResp.json();
    const idSessaoOp = loginData.IdSessaoOp;

    // Atenção: IdEstabelecimento fixo "1", conforme seu comentário original
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

    const partResp = await fetch(
      'https://oci-parceiros2.praxioluna.com.br/Autumn/Partidas/Partidas',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partidasBody),
      }
    );
    const partData = await partResp.json();
    res.json(partData);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao consultar partidas' });
  }
});

/* -------------------------------------------------
 * API: Praxio — RetornaPoltronas
 * ------------------------------------------------- */
app.post('/api/poltronas', async (req, res) => {
  try {
    const { idViagem, idTipoVeiculo, idLocOrigem, idLocDestino } = req.body;

    const loginBody = {
      Nome: process.env.PRAXIO_USER,
      Senha: process.env.PRAXIO_PASS,
      Sistema: 'WINVR.EXE',
      TipoBD: 0,
      Empresa: process.env.PRAXIO_EMP,
      Cliente: process.env.PRAXIO_CLIENT,
      TipoAplicacao: 0,
    };
    const loginResp = await fetch(
      'https://oci-parceiros2.praxioluna.com.br/Autumn/Login/efetualogin',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginBody),
      }
    );
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

    const seatResp = await fetch(
      'https://oci-parceiros2.praxioluna.com.br/Autumn/Poltrona/RetornaPoltronas',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(seatBody),
      }
    );
    const seatData = await seatResp.json();
    res.json(seatData);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao consultar poltronas' });
  }
});

/* -------------------------------------------------
 * START
 * ------------------------------------------------- */
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
