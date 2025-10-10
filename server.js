require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
const nodemailer = require('nodemailer');
const { MercadoPagoConfig, Payment } = require('mercadopago');
const { v4: uuidv4 } = require('uuid');

const app = express();

/* ===== CSP ===== */
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

const PORT = process.env.PORT || 3000;

/* ===== static / json ===== */
const PUBLIC_DIR = fs.existsSync(path.join(__dirname, 'sitevendas'))
  ? path.join(__dirname, 'sitevendas')
  : __dirname;

app.use(express.static(PUBLIC_DIR));
app.use(express.json());

/* ===== MP config ===== */
const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || '';
const PUBLIC_KEY   = process.env.MP_PUBLIC_KEY || '';

const mpClient = new MercadoPagoConfig({ accessToken: ACCESS_TOKEN });

app.get('/api/mp/pubkey', (_req, res) => {
  res.json({ publicKey: PUBLIC_KEY });
});

/* ===== Helpers ===== */
const onlyDigits = (s) => String(s || '').replace(/\D/g, '');

/* ===== Pay endpoint ===== */
app.post('/api/mp/pay', async (req, res) => {
  const payments = new Payment(mpClient);
  try {
    const {
      transactionAmount,
      description,
      token,
      installments,
      payment_method_id,
      paymentMethodId, // 'credit_card' | 'pix'
      payer
    } = req.body || {};

    const amount = Number(
      typeof transactionAmount === 'string' ? transactionAmount.replace(',', '.') : transactionAmount
    );
    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: true, message: 'Valor inválido.' });
    }
    if (!ACCESS_TOKEN) {
      return res.status(401).json({ error: true, message: 'ACCESS_TOKEN ausente no servidor.' });
    }

    // base usada nos dois fluxos
    const base = {
      transaction_amount: amount,
      description: description || 'Compra Turin Transportes',
      payer: {
        email: payer?.email || '',
        first_name: payer?.first_name || '',
        last_name: payer?.last_name || '',
        identification: payer?.identification
          ? {
              type: (payer.identification.type || 'CPF').toUpperCase(),
              number: onlyDigits(payer.identification.number),
            }
          : undefined,
      },
      metadata: { app: 'Turin SiteVendas', when: new Date().toISOString() },
    };

    /* ---------- PIX primeiro ---------- */
    if (String(paymentMethodId || '').toLowerCase() === 'pix') {
      if (!base.payer.email) {
        return res.status(400).json({ error: true, message: 'Informe um e-mail para Pix.' });
      }
      const pixBody = {
        ...base,
        payment_method_id: 'pix',
        date_of_expiration: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
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

    /* ---------- Cartão (tenta Orders API; se 401/403 cai para Payments API) ---------- */
    if (!token) {
      return res.status(400).json({ error: true, message: 'Token do cartão ausente.' });
    }
    const email = (base.payer?.email || '').trim();
    if (!email) {
      return res.status(400).json({ error: true, message: 'E-mail do pagador é obrigatório.' });
    }

    // 1) tenta Orders API (1x fixo)
    const orderBody = {
      type: "online",
      processing_mode: "automatic",
      total_amount: Number(amount).toFixed(2),
      external_reference: `order_${Date.now()}`,
      payer: { email },
      transactions: {
        payments: [
          {
            amount: Number(amount).toFixed(2),
            payment_method: {
              id: String(payment_method_id || ''), // 'visa', 'master', ...
              type: "credit_card",
              token: token,
              installments: 1
            }
          }
        ]
      }
    };

    const orderResp = await fetch('https://api.mercadopago.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'X-Idempotency-Key': uuidv4()
      },
      body: JSON.stringify(orderBody)
    });

    if (orderResp.status === 401 || orderResp.status === 403) {
      // 2) Fallback: Payments API (clássica) 1x
      const payBody = {
        ...base,
        token,
        installments: 1,
        payment_method_id: payment_method_id || undefined,
        capture: true,
      };
      const pr = await payments.create({ body: payBody });
      return res.json({
        id: pr?.id,
        status: pr?.status,
        status_detail: pr?.status_detail,
        payment: pr
      });
    }

    const orderJson = await orderResp.json();
    if (!orderResp.ok) {
      console.error('Orders API error:', orderResp.status, JSON.stringify(orderJson));
      return res.status(orderResp.status).json({
        error: true,
        message: orderJson?.message || orderJson?.error || orderJson?.status_detail || 'Falha na criação da order',
        details: orderJson
      });
    }

    return res.json({
      id: orderJson?.id,
      status: orderJson?.status || 'processed',
      status_detail: orderJson?.status_detail || '',
      order: orderJson
    });

  } catch (err) {
    const details =
      err?.cause?.[0]?.description ||
      err?.cause?.[0]?.message ||
      err?.message || 'Falha ao processar pagamento';
    console.error('MP /pay error:', details, err);
    return res.status(400).json({ error: true, message: details });
  }
});

/* ===== fallback SPA ===== */
app.get('*', (_req, res) => {
  const indexPath = fs.existsSync(path.join(PUBLIC_DIR, 'index.html'))
    ? path.join(PUBLIC_DIR, 'index.html')
    : path.join(__dirname, 'index.html');
  res.sendFile(indexPath);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORT} | publicDir: ${PUBLIC_DIR}`);
});
