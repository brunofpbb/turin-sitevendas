// mpRoutes.js
require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch'); // ok com Node 18 + "node-fetch": "^2.7.0"
const { MercadoPagoConfig, Payment } = require('mercadopago');

const router = express.Router();

const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || '';
const PUBLIC_KEY   = process.env.MP_PUBLIC_KEY || '';

if (!ACCESS_TOKEN) {
  console.warn('[MP] MP_ACCESS_TOKEN ausente! Configure no Railway (.env).');
}

/** Cliente SDK (para /v1/payments) */
const mpClient  = new MercadoPagoConfig({ accessToken: ACCESS_TOKEN, options: { timeout: 15000 } });
const payments  = new Payment(mpClient);

/** Expor a public key para o front */
router.get('/pubkey', (_req, res) => {
  return res.json({ publicKey: PUBLIC_KEY || '' });
});

/**
 * POST /api/mp/pay
 * Body mínimo esperado (cartão):
 * {
 *   payment_method_id: "visa"|"master"|...,
 *   token: "<card_token>",
 *   transaction_amount: 28.45,
 *   installments: 1,
 *   payer: { email: "...", identification: { type: "CPF", number: "12345678909" } }
 * }
 *
 * Pix:
 * {
 *   payment_method_id: "pix",
 *   transaction_amount: 28.45,
 *   payer: { email: "..." }
 * }
 */
router.post('/pay', async (req, res) => {
  try {
    if (!ACCESS_TOKEN) {
      return res.status(400).json({ error: true, message: 'Access token ausente no servidor.' });
    }

    const {
      payment_method_id,
      token,
      transaction_amount,
      installments,
      payer
    } = req.body || {};

    const amount = Number(transaction_amount || 0);
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: true, message: 'Valor inválido.' });
    }
    if (!payer?.email) {
      return res.status(400).json({ error: true, message: 'E-mail do pagador é obrigatório.' });
    }

    /** ======================= PIX ======================= */
    if (payment_method_id === 'pix') {
      // Fluxo clássico de PIX: POST /v1/payments
      const body = {
        transaction_amount: amount,
        description: 'Compra Turin Transportes',
        payment_method_id: 'pix',
        payer: { email: payer.email }
      };

      // Você pode usar o SDK:
      // const r = await payments.create({ body });
      // OU fetch (fica mais fácil de inspecionar em alguns cenários):
      const r = await fetch('https://api.mercadopago.com/v1/payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ACCESS_TOKEN}`
        },
        body: JSON.stringify(body)
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        console.error('[MP][PIX] ERRO', r.status, JSON.stringify(j, null, 2));
        const msg = j?.message || j?.error_message || 'Falha ao criar pagamento PIX';
        return res.status(400).json({ error: true, message: msg, details: j });
      }

      const tx = j?.point_of_interaction?.transaction_data || {};
      return res.json({
        id: j.id,
        status: j.status,
        status_detail: j.status_detail,
        qr_code: tx.qr_code,
        qr_code_base64: tx.qr_code_base64,
        ticket_url: tx.ticket_url
      });
    }

    /** =================== CARTÃO (crédito/débito) =================== */
    if (!token) {
      return res.status(400).json({ error: true, message: 'Token do cartão ausente.' });
    }
    if (!payment_method_id) {
      return res.status(400).json({ error: true, message: 'payment_method_id ausente.' });
    }

    // Força 1x do lado do servidor também:
    const nInstallments = Number(installments || 1);

    const body = {
      transaction_amount: amount,
      description: 'Compra Turin Transportes',
      payment_method_id,         // "visa", "master", ...
      token,                     // token do Brick
      installments: nInstallments,
      payer: {
        email: payer.email,
        identification: payer.identification
          ? {
              type: String(payer.identification.type || 'CPF'),
              number: String(payer.identification.number || '').replace(/\D/g, '')
            }
          : undefined
      }
    };

    // SDK oficial
    const r = await payments.create({ body });

    return res.json({
      id: r?.id,
      status: r?.status,
      status_detail: r?.status_detail
    });

  } catch (err) {
    // Log detalhado
    const cause = err?.cause || err;
    console.error('[MP] /pay CATCH ->', JSON.stringify(cause, null, 2));
    const details =
      (Array.isArray(err?.cause) && err.cause[0]?.description) ||
      err?.message ||
      'Falha ao processar pagamento';
    return res.status(400).json({ error: true, message: details, details: err });
  }
});

module.exports = router;
