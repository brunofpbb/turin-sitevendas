// services/ticket/mapper.js — rev5
// Constrói o objeto "ticket" consumido pelo pdf.js

module.exports = function mapTicket(root = {}) {
  const venda = root.venda || root?.bpe || {};
  const mp    = root.mp || {};
  const pg    = root.pg || venda?.Pagamento || {};

  function resolveFormaPgto() {
    const ptype = String(mp.payment_type_id || '').toLowerCase();
    const pmeth = String(mp.payment_method_id || '').toLowerCase();

    if (ptype === 'credit_card' ||
        ['visa','master','elo','amex','hipercard','diners'].some(b => pmeth.includes(b))) {
      return 'Cartão de Crédito';
    }
    if (pmeth === 'pix' || ptype === 'bank_transfer') return 'Pix';

    // dados da Praxio
    if (typeof venda?.FormaPgto === 'string' && venda.FormaPgto.trim()) return venda.FormaPgto;
    if (pg) {
      if (pg.TipoCartao && Number(pg.TipoCartao) !== 0) return 'Cartão de Crédito';
      if (pg.Tipo === 0) return 'Dinheiro';
    }
    return '—';
  }

  // números para "R$ x,xx"
  const fmtMoney = v => {
    const n = Number(String(v).replace(',', '.'));
    if (!isFinite(n)) return 'R$ 0,00';
    return n.toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
  };

  const ticket = {
    // Empresa
    empresa: venda.Empresa || root.empresa || 'TURIN TRANSPORTES LTDA',
    cnpjEmpresa: venda.CNPJ || root.cnpj || '03308232000108',
    ie: venda.IE || root.ie || '4610699670002',
    im: venda.IM || root.im || '1062553',
    enderecoEmpresa: venda.Endereco || root.endereco || 'Avenida Presidente Juscelino Kubitschek, 890',
    bairroEmpresa: venda.Bairro || '',
    cidadeEmpresa: venda.Cidade || root.cidade || 'Ouro Preto - MG',
    telefoneEmpresa: venda.Telefone || root.telefone || '3135511650',

    // Viagem
    horaPartida: venda.Hora || root.horaPartida || '',
    classe: venda.Classe || root.classe || '',
    origem: venda.Origem || root.origem || '',
    destino: venda.Destino || root.destino || '',
    nomeLinha: venda.NomeLinha || root.nomeLinha || '',
    dataViagem: venda.DataViagem || root.dataViagem || '',
    codigoLinha: venda.Prefixo || root.codigoLinha || '',
    numPassagem: venda.Bilhete || root.numPassagem || '',
    serie: venda.Serie || root.serie || '',
    poltrona: venda.Poltrona || root.poltrona || '',

    // Passageiro
    nomeCliente: venda.Passageiro || root.nomeCliente || '',
    documento: venda.Documento || root.documento || '',

    // Valores
    tarifa: fmtMoney(venda.Tarifa ?? root.tarifa ?? 0),
    taxaEmbarque: fmtMoney(venda.TaxaEmbarque ?? root.taxaEmbarque ?? 0),
    outros: fmtMoney(venda.Outros ?? root.outros ?? 0),
    valorTotalFmt: fmtMoney(venda.ValorPago ?? root.valorTotal ?? mp.transaction_amount ?? 0),
    formaPagamento: resolveFormaPgto(),

    // BPe / QR
    chaveBPe: venda.ChaveBPe || root.chaveBPe || '',
    urlQrBPe: venda.UrlQrCodeBPe || root.urlQrBPe || 'https://bpe.fazenda.mg.gov.br/portalbpe/sistema/qrcode.xhtml',
    urlConsultaAcesso: 'https://bpe.fazenda.mg.gov.br/bpe/services/BPeConsultaDFe',
    qrUrl: venda.UrlQrCodeBPe || root.qrUrl || '',

    // Emissão
    emissaoISO: root.emissaoISO || new Date().toISOString()
  };

  return ticket;
};
