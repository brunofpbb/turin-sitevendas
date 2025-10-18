const { asBRDate, asBRTimeHHMM, moneyBR } = require('./utils');

/**
 * root pode conter:
 *  - ListaPassagem: [ {...} ] (retorno da Praxio)
 *  - mp: { payment_type_id, payment_method_id, status, installments } (opcional, vindo do servidor)
 *  - emissaoISO: string ISO de quando o BPe foi gerado (opcional)
 */
exports.mapVendaToTicket = (root) => {
  const venda = root?.ListaPassagem?.[0] || {};
  const est   = venda?.DadosEstabelecimento || venda?.DadosEstabEmissor || {};
  const pg    = Array.isArray(venda?.DadosPagamento) ? venda.DadosPagamento[0] : null;

  const valorNumerico = Number(
    venda?.ValorPgto ?? venda?.ValorRecebido ?? venda?.ValorBruto ?? 0
  );

  // Forma de pagamento (prioriza dados do MP, depois mapeia Praxio)
  function resolveFormaPgto() {
    const mp = root?.mp || {};
    const ptype = String(mp.payment_type_id || '').toLowerCase();
    const pmeth = String(mp.payment_method_id || '').toLowerCase();

    if (ptype === 'credit_card' || ['visa','master','elo','amex','hipercard','diners'].some(b => pmeth.includes(b))) {
      return 'Cartão de Crédito';
    }
    if (pmeth === 'pix' || ptype === 'bank_transfer') return 'Pix';

    // Praxio
    if (typeof venda?.FormaPgto === 'string' && venda.FormaPgto.trim()) return venda.FormaPgto;
    if (pg) {
      if (pg.TipoCartao && Number(pg.TipoCartao) !== 0) return 'Cartão';
      if (pg.Tipo === 0) return 'Dinheiro';
    }
    return '—';
  }

  const ticket = {
    // Empresa
    empresa: est?.NomeFantasia || est?.RazaoSocial || 'TURIN TRANSPORTES LTDA',
    cnpjEmpresa: est?.Cnpj || '',
    enderecoEmpresa: [ est?.Endereco, est?.Numero ].filter(Boolean).join(', '),
    bairroEmpresa: est?.Bairro || '',
    cidadeEmpresa: [est?.NomeCidade, est?.Uf].filter(Boolean).join(' - '),
    telefoneEmpresa: est?.Telefone || '',
    im: est?.IMunicipal || '',
    ie: est?.IEstadual || '',

    // Viagem
    nomeLinha: venda?.NomeLinha || '',          // descrição (vai em "Linha")
    codigoLinha: venda?.CodigoLinha || '',      // código (vai em "Prefixo")
    origem: venda?.Origem || '',
    destino: venda?.Destino || '',
    dataViagem: asBRDate(venda?.DataPartida),
    horaPartida: asBRTimeHHMM(venda?.HoraPartida),
    poltrona: String(venda?.Poltrona || ''),
    classe: venda?.DescServico || venda?.TipoCarro || '',

    // Identificadores
    idViagem: String(venda?.IdViagem || ''),
    numPassagem: String(venda?.NumPassagem || ''),
    serie: String(venda?.SerieBloco || ''),
    localizador: venda?.Localizador || '',

    // Passageiro
    nomeCliente: venda?.NomeCliente || '',
    documento: venda?.DocCliente || venda?.CpfCliente || '',

    // Valores
    tarifa: moneyBR(venda?.ValorTarifa || 0),
    // pedagio: moneyBR(venda?.Pedagio || 0), // removido do layout
    taxaEmbarque: moneyBR(venda?.TaxaEmbarque || 0),
    outros: moneyBR(venda?.Outros || 0),
    valorTotalFmt: moneyBR(valorNumerico),
    valorNumerico,

    formaPgto: resolveFormaPgto(),

    // BPe / QR
    chaveBPe: venda?.ChaveBPe || '',
    urlQrBPe: venda?.UrlQrCodeBPe || 'https://bpe.fazenda.mg.gov.br/portalbpe/sistema/qrcode.xhtml',

    // Emissão
    emissaoISO: root?.emissaoISO || new Date().toISOString()
  };

  // URL usada no QR e impressa no texto (idêntica)
  ticket.qrUrl = ticket.chaveBPe
    ? `${ticket.urlQrBPe}?chBPe=${ticket.chaveBPe}&tpAmb=1`
    : ticket.urlQrBPe;

  return ticket;
};
