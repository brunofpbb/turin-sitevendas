// services/ticket/mapper.js — rev6
// Compatível com require({ mapVendaToTicket }) e default

function mapVendaToTicket(root = {}) {
  // ----- origem de dados (compat): venda pode vir como objeto OU resposta com ListaPassagem -----
  const vendaRaw = root.venda || root.bpe || {};
  const venda = Array.isArray(vendaRaw?.ListaPassagem) ? vendaRaw.ListaPassagem[0] : vendaRaw;

  const mp = root.mp || {};
  const pg = root.pg || venda?.Pagamento || {};

  // ----- helpers -----
  const fmtMoney = v => {
    const n = Number(String(v ?? 0).toString().replace(',', '.'));
    if (!isFinite(n)) return 'R$ 0,00';
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };
  const pad = n => String(n).padStart(2,'0');
  // "1727" -> "17:27"
  const fmtHora = h => {
    const s = String(h ?? '');
    if (s.length === 4 && /^\d{4}$/.test(s)) return `${s.slice(0,2)}:${s.slice(2)}`;
    if (s.length === 3 && /^\d{3}$/.test(s)) return `${pad(s.slice(0,1))}:${s.slice(1)}`;
    if (/^\d{2}:\d{2}$/.test(s)) return s;
    return s || '—';
  };
  // "2025-10-20T00:00:00" -> "20/10/2025"
  const fmtData = d => {
    const s = String(d ?? '');
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      const [Y,M,D] = s.slice(0,10).split('-');
      return `${D}/${M}/${Y}`;
    }
    return s || '—';
  };

  function resolveFormaPgto() {
    // Mercado Pago
    const ptype = String(mp.payment_type_id || '').toLowerCase();
    const pmeth = String(mp.payment_method_id || '').toLowerCase();
    if (ptype === 'credit_card' ||
        ['visa','master','elo','amex','hipercard','diners'].some(b => pmeth.includes(b))) return 'Cartão de Crédito';
    if (pmeth === 'pix' || ptype === 'bank_transfer') return 'Pix';
    // Praxio
    if (typeof venda?.FormaPgto === 'string' && venda.FormaPgto.trim()) return venda.FormaPgto;
    if (pg) {
      if (pg.TipoCartao && Number(pg.TipoCartao) !== 0) return 'Cartão de Crédito';
      if (String(pg.TipoPagamento) === '0') return 'Dinheiro';
    }
    return '—';
  }

  const ticket = {
    // Empresa
    empresa: venda?.NomeAgencia || venda?.Empresa || root.empresa || 'TURIN TRANSPORTES LTDA',
    cnpjEmpresa: venda?.CNPJPrincipal || venda?.Cnpj || root.cnpj || '03308232000108',
    ie: venda?.IEstadual || root.ie || '4610699670002',
    im: venda?.IMunicipal || root.im || '1062553',
    enderecoEmpresa: venda?.Endereco || root.endereco || 'Avenida Presidente Juscelino Kubitschek, 890',
    bairroEmpresa: venda?.Bairro || 'Bauxita',
    cidadeEmpresa: (venda?.NomeCidade ? `${venda.NomeCidade} - ${venda.Uf || 'MG'}` : (root.cidade || 'Ouro Preto - MG')),
    telefoneEmpresa: venda?.Telefone || root.telefone || '3135511650',

    // Viagem / bilhete
    horaPartida: fmtHora(venda?.HoraPartida ?? root.horaPartida),
    classe: venda?.TipoCarro || venda?.DescServico || root.classe || '—',
    origem: venda?.Origem || root.origem || '—',
    destino: venda?.Destino || root.destino || '—',
    nomeLinha: venda?.NomeLinha || root.nomeLinha || '—',
    dataViagem: fmtData(venda?.DataPartida || root.dataViagem),
    codigoLinha: venda?.CodigoLinha || root.codigoLinha || '—',
    numPassagem: venda?.NumPassagem || root.numPassagem || '—',
    serie: venda?.SerieBloco || venda?.SerieV || root.serie || '—',
    poltrona: venda?.Poltrona || root.poltrona || '—',

    // Passageiro
    nomeCliente: venda?.NomeCliente || venda?.NomeCli || root.nomeCliente || '—',
    documento: venda?.DocCliente || venda?.IdentidadeCli || root.documento || '—',

    // Valores
    tarifa: fmtMoney(venda?.ValorTarifa ?? root.tarifa),
    taxaEmbarque: fmtMoney(venda?.TaxaEmbarque ?? root.taxaEmbarque),
    outros: fmtMoney(venda?.Outros ?? root.outros),
    valorTotalFmt: fmtMoney(venda?.ValorPago ?? venda?.ValorPgto ?? root.valorTotal ?? mp.transaction_amount),
    formaPagamento: resolveFormaPgto(),

    // BPe / QR
    chaveBPe: venda?.ChaveBPe || root.chaveBPe || '',
    urlQrBPe: venda?.UrlQrCodeBPe || root.urlQrBPe || 'https://bpe.fazenda.mg.gov.br/portalbpe/sistema/qrcode.xhtml',
    urlConsultaAcesso: 'https://bpe.fazenda.mg.gov.br/bpe/services/BPeConsultaDFe',
    qrUrl: venda?.UrlQrCodeBPe || root.qrUrl || '',

    // Emissão
    emissaoISO: root.emissaoISO || new Date().toISOString()
  };

  return ticket;
}

module.exports = mapVendaToTicket;                 // default
module.exports.mapVendaToTicket = mapVendaToTicket; // nomeado
