// mpRoutes.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');

const {
  MercadoPagoConfig,
  Payment,
  MPRequestOptions
} = require('mercadopago');

const router = express.Router();

// ---------- CONFIGURA SDK NO BOOT ----------
const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
if (!ACCESS_TOKEN) {
  console.warn('[MP] MP_ACCESS_TOKEN ausente! /api/mp/pay vai retornar 500.');
}
const mp = new MercadoPagoConfig({ accessToken: ACCESS_TOKEN });

// ---------- Helpers ----------
const onlyDigits = (str) => String(str || '').replace(/\D/g, '');

// ---------- PubKey para o frontend ----------
router.get('/pubkey', (req, res) => {
  res.json({ publicKey: process.env.MP_PUBLIC_KEY || '' });
});

// ---------- Pagamento ----------
router.post('/pay', async (req, res) => {
  try {
    if (!ACCESS_TOKEN) {
      return res.status(500).json({
        error: true,
        message: 'MP_ACCESS_TOKEN não configurado no servidor.'
      });
    }

    const {
      payment_method_id,            // 'pix' | 'credit_card' | 'debit_card'
      transaction_amount,           // number
      token,                        // token do cartão
      installments,                 // number
      issuer_id,                    // string
      payer = {},                   // { email, identification: { type, number } }
      description                   // optional
    } = req.body || {};

    // Sanitiza CPF
    if (payer?.identification?.number) {
      payer.identification.number = onlyDigits(payer.identification.number);
    }

    // Corpo base
    const base = {
      transaction_amount: Number(transaction_amount || 0),
      description: description || 'Compra Turin Transportes',
      payer: {
        email: payer?.email || '',
        identification: payer?.identification?.number
          ? {
              type: payer?.identification?.type || 'CPF',
              number: payer.identification.number
            }
          : undefined
      }
    };

    // Valida valor
    if (!base.transaction_amount || base.transaction_amount <= 0) {
      return res.status(400).json({ error: true, message: 'Valor inválido.' });
    }

    // Prepara cabeçalho de idempotência
    const requestOptions = new MPRequestOptions({
      customHeaders: { 'X-Idempotency-Key': uuidv4() }
    });

    const payments = new Payment(mp);

    let body;

    if (payment_method_id === 'pix') {
      // --------- PIX ----------
      if (!base.payer?.email) {
        return res.status(400).json({ error: true, message: 'E-mail obrigatório para Pix.' });
      }
      body = {
        ...base,
        payment_method_id: 'pix'
      };
    } else {
      // --------- CARTÃO (crédito/débito) ----------
      if (!token) {
        return res.status(400).json({ error: true, message: 'Token do cartão ausente.' });
      }
      body = {
        ...base,
        token,
        installments: Number(installments || 1),
        capture: true
        // NÃO envie payment_method_id/issuer_id aqui.
        // O MP infere pelo token/BIN e issuer_id.
      };
    }

    const mpResp = await payments.create({ body, requestOptions });

    return res.json({
      id: mpResp?.id,
      status: mpResp?.status,
      status_detail: mpResp?.status_detail,
      point_of_interaction: mpResp?.point_of_interaction,
      transaction_details: mpResp?.transaction_details
    });
  } catch (err) {
    // Mostra a causa real no log:
    const cause =
      err?.cause?.[0]?.description ||
      err?.cause?.[0]?.message ||
      err?.message ||
      'Falha ao processar pagamento';
    console.error('[MP] /pay error ->', JSON.stringify(err?.cause || err, null, 2));
    return res.status(401).json({ error: true, message: cause });
  }
});

module.exports = router;
