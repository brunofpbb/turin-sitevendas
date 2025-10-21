// routes/mpRoutes.js — Mercado Pago SDK v2 + CommonJS (import dinâmico, chamada correta: create({ body }))

const express = require('express');
const router = express.Router();

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const MP_PUBLIC_KEY  = process.env.MP_PUBLIC_KEY;

if (!MP_ACCESS_TOKEN) console.warn('[MP] ⚠ MP_ACCESS_TOKEN não definido');
if (!MP_PUBLIC_KEY)  console.warn('[MP] ⚠ MP_PUBLIC_KEY não definido');

// ===== Helpers =====
const onlyDigits = v => String(v || '').replace(/\D/g, '');

function resolveEntityType(payer = {}) {
  const tRaw = payer.entityType || payer.entity_type || payer?.identification?.type;
  const t = String(tRaw || '').toUpperCase();
  if (t === 'CPF') return 'individual';
  if (t === 'CNPJ') return 'association';
  if (t === 'INDIVIDUAL' || t === 'ASSOCIATION') return t.toLowerCase();
  return undefined;
}

// ===== Lazy init SDK v2 (ESM) =====
let mpPayment = null;
async function ensureMP() {
  if (mpPayment) return mpPayment;
  const sdk = await import('mercadopago'); // v2 (ESM)
  const { MercadoPagoConfig, Payment } = sdk;
  const client = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN });
  mpPayment = new Payment(client);
  return mpPayment;
}

// ===== Endpoints =====
router.get('/pubkey', (_req, res) => res.json({ publicKey: MP_PUBLIC_KEY || null }));

router.post('/pay', async (req, res) => {
  try {
    const payment = await ensureMP();

    // === transactionAmount compat (camel/snake) ===
    const rawAmount =
      req.body?.transactionAmount ??
      req.body?.transaction_amount ??
      req.body?.amount ??
      null;

    let transactionAmountNum = NaN;
    if (typeof rawAmount === 'number') {
      transactionAmountNum = rawAmount;
    } else if (typeof rawAmount === 'string') {
      let s = rawAmount.trim().replace(/\s/g, '');
      // Se tem vírgula, trata como pt-BR "1.234,56"
      if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
      transactionAmountNum = Number(s);
    }
    console.log('[MP] amount raw =>', rawAmount, typeof rawAmount, '=>', transactionAmountNum);

    if (!Number.isFinite(transactionAmountNum) || transactionAmountNum <= 0) {
      return res.status(400).json({ error: true, message: 'transactionAmount inválido ou ausente' });
    }

    // === demais campos ===
    const description     = req.body?.description || 'Compra Turin Transportes';
    const token           = req.body?.token;
    const installments    = Number(req.body?.installments || 1);
    const paymentMethodId = String(req.body?.paymentMethodId || req.body?.payment_method_id || '').toLowerCase();
    const issuerId        = req.body?.issuerId || req.body?.issuer_id; // evite no sandbox
    const payer           = req.body?.payer || {};

    // normaliza CPF/CNPJ e entity_type
    const idType   = String(payer?.identification?.type || '').toUpperCase(); // "CPF" | "CNPJ"
    const idNumber = onlyDigits(payer?.identification?.number);
    const entityType = resolveEntityType({ ...payer, identification: { type: idType } });

    // payload v2 (snake_case)
    const base = {
      transaction_amount: transactionAmountNum,
      description,
      payer: {
        email: payer?.email || '',
        first_name: payer?.first_name,
        last_name:  payer?.last_name,
        identification: {
          type:   idType || undefined,
          number: idNumber || undefined,
        },
        entity_type: entityType, // ESSENCIAL no BR
      },
    };

    const isPix = paymentMethodId === 'pix' || paymentMethodId === 'bank_transfer';
    const idemKey = req.headers['x-idempotency-key'];

    if (isPix) {
      base.payment_method_id = 'pix';
      base.date_of_expiration = new Date(Date.now() + 30 * 60 * 1000).toISOString();

      console.log('[MP] PIX create payload ->', JSON.stringify(base));
      const resp = await payment.create(
        { body: base },
        idemKey ? { idempotencyKey: idemKey } : undefined
      );
      const body = resp || {};
      const td = body?.point_of_interaction?.transaction_data;

      return res.json({
        id: body?.id,
        status: body?.status,
        status_detail: body?.status_detail,
        pix: {
          qr_base64: td?.qr_code_base64,
          qr_text: td?.qr_code,
          expires_at: td?.expiration_date,
        },
      });
    }

    // Cartão
    base.payment_method_id = paymentMethodId; // "master", "visa" etc.
    base.token = token;
    base.installments = installments;
    if (issuerId) base.issuer_id = issuerId;  // deixe de fora no sandbox se der 400
    base.capture = true;

    console.log('[MP] CARD create payload ->', JSON.stringify(base));
    const resp = await payment.create(
      { body: base },                                  // <<<<<< CORRETO
      idemKey ? { idempotencyKey: idemKey } : undefined
    );
    const body = resp || {};

    return res.json({
      id: body?.id,
      status: body?.status,
      status_detail: body?.status_detail,
    });
  } catch (err) {
    console.error('[MP] /api/mp/pay ERROR ->', JSON.stringify(err));
    return res.status(400).json({
      error: true,
      message: err?.message || err?.error || 'Falha ao processar pagamento',
      cause: err?.cause || undefined,
    });
  }
});

module.exports = router;
