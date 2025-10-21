// routes/mpRoutes.js (compatível com mercadopago v2 + CommonJS)
// Usa import dinâmico para evitar mudar o projeto para ESM.

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
  const sdk = await import('mercadopago'); // v2 ESM
  const { MercadoPagoConfig, Payment } = sdk;
  const client = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN });
  mpPayment = new Payment(client);
  return mpPayment;
}

// ===== Endpoints =====

// Public Key para o Brick
router.get('/pubkey', (_req, res) => {
  res.json({ publicKey: MP_PUBLIC_KEY || null });
});

// Criar pagamento (PIX + Cartão)
router.post('/pay', async (req, res) => {
  try {
    const payment = await ensureMP();

    // recebido do front em camelCase
    const {
      transactionAmount,
      description,
      token,
      installments,
      paymentMethodId,
      issuerId,          // não vamos enviar por padrão (pode quebrar no sandbox)
      payer = {},
    } = req.body || {};

    // normalização de documento e entity_type
    const idType   = String(payer?.identification?.type || '').toUpperCase(); // "CPF"/"CNPJ"
    const idNumber = onlyDigits(payer?.identification?.number);
    const entityType = resolveEntityType({ ...payer, identification: { type: idType } });

    // monta payload v2 (snake_case)
    const base = {
      transaction_amount: Number(transactionAmount),
      description: description || 'Compra Turin Transportes',
      payer: {
        email: payer?.email || '',
        first_name: payer?.first_name,
        last_name:  payer?.last_name,
        identification: {
          type: idType || undefined,
          number: idNumber || undefined,
        },
        entity_type: entityType, // <-- ESSENCIAL NO BRASIL
      },
    };

    const method = String(paymentMethodId || '').toLowerCase();

    // ===== PIX =====
    if (method === 'pix') {
      base.payment_method_id = 'pix';
      base.date_of_expiration = new Date(Date.now() + 30 * 60 * 1000).toISOString();

      console.log('[MP] PIX create payload ->', JSON.stringify(base));
      const idemKey = req.headers['x-idempotency-key'];
      const resp = await payment.create(base, idemKey ? { idempotencyKey: idemKey } : undefined);
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

    // ===== Cartão =====
    base.payment_method_id = paymentMethodId; // "master", "visa", etc.
    base.token = token;
    base.installments = Number(installments || 1);
    // ⚠ issuer_id pode causar 400 no sandbox — envie só se necessário:
    if (issuerId) base.issuer_id = issuerId;
    base.capture = true;

    console.log('[MP] CARD create payload ->', JSON.stringify(base));
    const idemKey = req.headers['x-idempotency-key'];
    const resp = await payment.create(base, idemKey ? { idempotencyKey: idemKey } : undefined);
    const body = resp || {};

    return res.json({
      id: body?.id,
      status: body?.status,
      status_detail: body?.status_detail,
    });
  } catch (err) {
    // Na v2, erros vêm como { message, error, cause[] }
    const e = err;
    console.error('[MP] /api/mp/pay ERROR ->', JSON.stringify(e));
    return res.status(400).json({
      error: true,
      message: e?.message || e?.error || 'Falha ao processar pagamento',
      cause: e?.cause || undefined,
    });
  }
});

module.exports = router;
