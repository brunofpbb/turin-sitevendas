const { asBRDate, asBRTimeHHMM, moneyBR } = require('./utils');

exports.mapVendaToTicket = (root) => {
  const venda = root?.ListaPassagem?.[0] || {};
  const est   = venda?.DadosEstabelecimento || venda?.DadosEstabEmissor || {};
  const pg    = Array.isArray(venda?.DadosPagamento) ? venda.DadosPagamento[0] : null;

  const valorNumerico = Number(
    venda?.ValorPgto ?? venda?.ValorRecebido ?? venda?.ValorBruto ?? 0
  );

  const ticket = {
    // Emitentes / empresa
    empresa: est?.NomeFantasia || est?.RazaoSocial || 'TURIN TRANSPORTES LTDA',
    cnpjEmpresa: est?.Cnpj || '',
    enderecoEmpresa: [
      est?.Endereco, est?.Numero, est?.Bairro
    ].filter(Boolean).join(', '),
    cidadeEmpresa: [est?.NomeCidade, est?.Uf].filter(Boolean).join(' - '),
    im: est?.IMunicipal || '',
    ie: est?.IEstadual || '',

    // Viagem
    nomeLinha: venda?.NomeLinha || '',
    origem: venda?.Origem || '',
    destino: venda?.Destino || '',
    ufOrigem: venda?.UfOrigem || '',
    ufDestino: venda?.UfDestino || '',
    dataViagem: asBRDate(venda?.DataPartida),
    horaPartida: asBRTimeHHMM(venda?.HoraPartida),
    poltrona: String(venda?.Poltrona || ''),
    classe: venda?.DescServico || venda?.TipoCarro || '',
    tipo: venda?.TipoCarro || '',

    // Identificadores
    idViagem: String(venda?.IdViagem || ''),
    codigoLinha: venda?.CodigoLinha || '',
    numPassagem: String(venda?.NumPassagem || ''),
    serie: String(venda?.SerieBloco || ''),
    localizador: venda?.Localizador || '',

    // Passageiro
    nomeCliente: venda?.NomeCliente || '',
    documento: venda?.DocCliente || venda?.CpfCliente || '',

    // Valores
    tarifa: moneyBR(venda?.ValorTarifa || 0),
    pedagio: moneyBR(venda?.Pedagio || 0),
    taxaEmbarque: moneyBR(venda?.TaxaEmbarque || 0),
    outros: moneyBR(venda?.Outros || 0),
    valorTotalFmt: moneyBR(valorNumerico),
    valorNumerico,

    formaPgto: venda?.FormaPgto || (pg ? (pg.Tipo === 0 ? 'Dinheiro' : 'Cartão/Pix') : ''),

    // BPe / QR
    chaveBPe: venda?.ChaveBPe || '',
    urlQrBPe: venda?.UrlQrCodeBPe || 'https://bpe.fazenda.mg.gov.br/portalbpe/sistema/qrcode.xhtml',
    bpeNumeroCurto: venda?.ChaveBPe ? venda.ChaveBPe.slice(-9) : '',

    // Mensagens
    mensagem: venda?.Mensagem || '',
  };

  ticket.qrUrl = ticket.chaveBPe
    ? `${ticket.urlQrBPe}?chBPe=${ticket.chaveBPe}&tpAmb=1`
    : `${ticket.urlQrBPe}`;

  return ticket;
};
