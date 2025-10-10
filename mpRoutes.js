// mpRoutes.js
require('dotenv').config();
const express = require('express');
const { MercadoPagoConfig, Payment } = require('mercadopago');

const router = express.Router();

// --- credenciais
const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || '';
const PUBLIC_KEY   = process.env.MP_PUBLIC_KEY || '';

const mpClient = new MercadoPagoConfig({ accessToken: ACCESS_TOKEN });
const payments = new Payment(mpClient);

// chave pública para o front
router.get('/pubkey', (_req, res) => {
  res.json({ publicKey: PUBLIC_KEY });
});

const onlyDigits = s => String(s || '').replace(/\D/g, '');

// pagamento (cartão 1x fixo) e Pix
router.post('/pay', async (req, res) => {
  try {
    const {
      transactionAmount,
      description,
      token,
      payment_method_id,
      paymentMethodId,
      payer
    } = req.body || {};

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

    const isPix =
      String(paymentMethodId || '').toLowerCase() === 'pix' ||
      String(payment_method_id || '').toLowerCase() === 'pix';

    // PIX
    if (isPix) {
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

    // Cartão (1x fixo)
    if (!token) {
      return res.status(400).json({ error: true, message: 'Token do cartão ausente.' });
    }
    if (!base.payer.email) {
      return res.status(400).json({ error: true, message: 'E-mail do pagador é obrigatório.' });
    }

    const payBody = {
      ...base,
      token,
      installments: 1,                 // força 1x
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

  } catch (err) {
    const details =
      err?.cause?.[0]?.description ||
      err?.cause?.[0]?.message ||
      err?.message ||
      'Falha ao processar pagamento';
    console.error('MP /pay error:', details);
    return res.status(400).json({ error: true, message: details });
  }
});

module.exports = router;
