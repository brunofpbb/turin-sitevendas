const { asBRDate, asBRTimeHHMM, moneyBR } = require('./utils');

exports.mapVendaToTicket = (root) => {
  const venda = root?.ListaPassagem?.[0] || {};
  const est = venda?.DadosEstabelecimento || venda?.DadosEstabEmissor || {};
  const pg = Array.isArray(venda?.DadosPagamento) ? venda.DadosPagamento[0] : null;

  const ticket = {
    empresa: est?.NomeFantasia || est?.RazaoSocial || 'Turin Transportes Ltda',
    cnpjEmpresa: est?.Cnpj || '',
    origem: venda?.Origem || '',
    destino: venda?.Destino || '',
    nomeLinha: venda?.NomeLinha || '',
    dataViagem: asBRDate(venda?.DataPartida),
    horaPartida: asBRTimeHHMM(venda?.HoraPartida),
    poltrona: String(venda?.Poltrona || ''),
    nomeCliente: venda?.NomeCliente || '',
    documento: venda?.DocCliente || venda?.CpfCliente || '',
    idViagem: String(venda?.IdViagem || ''),
    serie: String(venda?.SerieBloco || ''),
    numPassagem: String(venda?.NumPassagem || ''),
    chaveBPe: venda?.ChaveBPe || '',
    urlQrBPe: venda?.UrlQrCodeBPe || '',
    valor: moneyBR(venda?.ValorPgto ?? venda?.ValorRecebido ?? venda?.ValorBruto ?? 0),
    valorNumerico: Number(venda?.ValorPgto ?? venda?.ValorRecebido ?? venda?.ValorBruto ?? 0),
    tarifa: moneyBR(venda?.ValorTarifa || 0),
    taxa: moneyBR(venda?.TaxaEmbarque || 0),
    mensagem: venda?.Mensagem || '',
    agencia: venda?.NomeAgencia || '',
    codigoLinha: venda?.CodigoLinha || '',
    bpeNumero: venda?.ChaveBPe ? venda.ChaveBPe.slice(-9) : '',
    dataVenda: venda?.DataVenda ? asBRDate(venda.DataVenda) : '',
    formaPgto: venda?.FormaPgto || (pg ? (pg.Tipo === 0 ? 'Dinheiro' : 'Cartão/Pix') : ''),
  };

  ticket.qrPayload = ticket.chaveBPe || `${ticket.empresa} • Passagem ${ticket.numPassagem}`;
  return ticket;
};
