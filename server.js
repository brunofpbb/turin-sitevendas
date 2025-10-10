/**
 * Turin SiteVendas - server.js (limpo e estável)
 * - CSP compatível com Bricks
 * - Apenas Payments API (cartão 1x e Pix)
 * - Sem duplicidade de variáveis / app.listen()
 */

require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch'); // ok ter; útil p/ debug se precisar
const { MercadoPagoConfig, Payment } = require('mercadopago');

const app = express();

/* --------------------------- CSP --------------------------- */
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://sdk.mercadopago.com https://wallet.mercadopago.com https://http2.mlstatic.com",
      "connect-src 'self' https://api.mercadopago.com https://wallet.mercadopago.com https://http2.mlstatic.com https://api-static.mercadopago.com https://api.mercadolibre.com https://*.mercadolibre.com https://*.mercadolivre.com",
      "img-src 'self' data: https://*.mercadopago.com https://*.mpago.li https://http2.mlstatic.com https://*.mercadolibre.com https://*.mercadolivre.com",
      "frame-src https://wallet.mercadopago.com https://api.mercadopago.com https://api-static.mercadopago.com https://*.mercadolibre.com https://*.mercadolivre.com",
      "child-src https://wallet.mercadopago.com https://api.mercadopago.com https://api-static.mercadopago.com https://*.mercadolibre.com https://*.mercadolivre.com",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:"
    ].join('; ')
  );
  next();
});

/* -------------------------- STATIC ------------------------- */
const PUBLIC_DIR = fs.existsSync(path.join(__dirname, 'sitevendas'))
  ? path.join(__dirname, 'sitevendas')
  : __dirname;

app.use(express.static(PUBLIC_DIR));
app.use(express.json());

/* --------------------- MP CONFIG / CLIENT ------------------ */
const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || '';
const PUBLIC_KEY   = process.env.MP_PUBLIC_KEY || '';

const mpClient = new MercadoPagoConfig({ accessToken: ACCESS_TOKEN });
const payments = new Payment(mpClient);

app.get('/api/mp/pubkey', (_req, res) => {
  res.json({ publicKey: PUBLIC_KEY });
});

/* -------------------------- HELPERS ------------------------ */
const onlyDigits = (s) => String(s || '').replace(/\D/g, '');

/* ------------------------ /api/mp/pay ---------------------- */
/**
 * Body esperado (cartão):
 * {
 *   transactionAmount: 28.45,
 *   description: 'Compra Turin',
 *   token: 'CARD_TOKEN',
 *   payment_method_id: 'visa' | 'master' | ... (opcional)
 *   payer: {
 *     email: '...',
 *     identification: { type: 'CPF', number: '12345678909' }
 *   }
 * }
 *
 * Body esperado (pix):
 * {
 *   transactionAmount: 28.45,
 *   description: 'Compra Turin',
 *   paymentMethodId: 'pix',
 *   payer: { email: '...' }
 * }
 */
app.post('/api/mp/pay', async (req, res) => {
  try {
    const {
      transactionAmount,
      description,
      token,
      payment_method_id,
      paymentMethodId,
      payer
    } = req.body || {};

    // normaliza/valida valor
    const amount = Number(
      typeof transactionAmount === 'string'
        ? transactionAmount.replace(',', '.')
        : transactionAmount
    );

    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: true, message: 'Valor inválido.' });
    }
    if (!ACCESS_TOKEN) {
      return res.status(401).json({ error: true, message: 'ACCESS_TOKEN ausente no servidor.' });
    }

    // base comum
    const base = {
      transaction_amount: amount,
      description: description || 'Compra Turin Transportes',
      payer: {
        email: payer?.email || '',
        first_name: payer?.first_name || '',
        last_name:  payer?.last_name  || '',
        identification: payer?.identification
          ? {
              type: (payer.identification.type || 'CPF').toUpperCase(),
              number: onlyDigits(payer.identification.number),
            }
          : undefined,
      },
      metadata: { app: 'Turin SiteVendas', when: new Date().toISOString() },
    };

    /* --------------------------- PIX --------------------------- */
    const isPix =
      String(paymentMethodId || '').toLowerCase() === 'pix' ||
      String(payment_method_id || '').toLowerCase() === 'pix';

    if (isPix) {
      if (!base.payer.email) {
        return res.status(400).json({ error: true, message: 'Informe um e-mail para Pix.' });
      }
      const pixBody = {
        ...base,
        payment_method_id: 'pix',
        date_of_expiration: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // +30 minutos
      };
      const r = await payments.create({ body: pixBody });
      const td = r?.point_of_interaction?.transaction_data;
      return res.json({
        id: r?.id,
        status: r?.status,
        status_detail: r?.status_detail,
        pix: {
          qr_base64: td?.qr_code_base64,
          qr_text: td?.qr_code,
          expires_at: td?.expiration_date,
        },
      });
    }

    /* -------------------------- CARTÃO ------------------------- */
    if (!token) {
      return res.status(400).json({ error: true, message: 'Token do cartão ausente.' });
    }
    const email = (base.payer?.email || '').trim();
    if (!email) {
      return res.status(400).json({ error: true, message: 'E-mail do pagador é obrigatório.' });
    }

    // Payments API — 1x fixo
    const payBody = {
      ...base,
      token,
      installments: 1, // força 1x
      payment_method_id: payment_method_id || undefined, // bandeira (opcional)
      capture: true,
    };

    const pr = await payments.create({ body: payBody });
    return res.json({
      id: pr?.id,
      status: pr?.status,
      status_detail: pr?.status_detail,
      payment: pr
    });

  } catch (err) {
    const details =
      err?.cause?.[0]?.description ||
      err?.cause?.[0]?.message ||
      err?.message ||
      'Falha ao processar pagamento';
    console.error('MP /pay error:', details, err);
    return res.status(400).json({ error: true, message: details });
  }
});

/* ------------------------- SPA Fallback -------------------- */
app.get('*', (_req, res) => {
  const indexPath = fs.existsSync(path.join(PUBLIC_DIR, 'index.html'))
    ? path.join(PUBLIC_DIR, 'index.html')
    : path.join(__dirname, 'index.html');
  res.sendFile(indexPath);
});

/* --------------------------- LISTEN ------------------------ */
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORT} | publicDir: ${PUBLIC_DIR}`);
});
