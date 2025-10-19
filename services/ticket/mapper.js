// services/ticket/mapper.js — rev8 (QR com chBPe & tpAmb)

function mapVendaToTicket(root = {}) {
  // ————— descobre a venda certa (aceita vários formatos) —————
  const candidates = [];
  if (root?.venda?.ListaPassagem?.[0]) candidates.push(root.venda.ListaPassagem[0]);
  if (root?.ListaPassagem?.[0])        candidates.push(root.ListaPassagem[0]);
  if (root?.venda)                     candidates.push(root.venda);
  if (root?.bpe)                       candidates.push(root.bpe);
  candidates.push(root);
  const venda = candidates.find(v =>
    v && (v.Origem || v.Destino || v.NomeLinha || v.CodigoLinha || v.NumPassagem || v.DadosEstabelecimento || v.NomeAgencia)
  ) || {};

  const mp = root.mp || {};
  const pg = root.pg || venda.Pagamento || {};

  // ————— helpers —————
  const fmtMoney = v => {
    const n = Number(String(v ?? 0).replace(',', '.'));
    if (!isFinite(n)) return 'R$ 0,00';
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };
  const pad = n => String(n).padStart(2,'0');
  const fmtHora = h => {
    const s = String(h ?? '');
    if (/^\d{4}$/.test(s)) return `${s.slice(0,2)}:${s.slice(2)}`;
    if (/^\d{3}$/.test(s))  return `${pad(s[0])}:${s.slice(1)}`;
    if (/^\d{2}:\d{2}$/.test(s)) return s;
    return s || '—';
  };
  const fmtData = d => {
    const s = String(d ?? '');
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      const [Y,M,D] = s.slice(0,10).split('-');
      return `${D}/${M}/${Y}`;
    }
    return s || '—';
  };
  function resolveFormaPgto() {
    const ptype = String(mp.payment_type_id || '').toLowerCase();
    const pmeth = String(mp.payment_method_id || '').toLowerCase();
    if (ptype === 'credit_card' || ['visa','master','elo','amex','hipercard','diners'].some(b => pmeth.includes(b))) return 'Cartão de Crédito';
    if (pmeth === 'pix' || ptype === 'bank_transfer') return 'Pix';
    if (typeof venda?.FormaPgto === 'string' && venda.FormaPgto.trim()) return venda.FormaPgto;
    if (pg) {
      if (pg.TipoCartao != null && Number(pg.TipoCartao) !== 0) return 'Cartão de Crédito';
      if (String(pg.TipoPagamento) === '0') return 'Dinheiro';
    }
    return '—';
  }

  // ————— empresa —————
  const est = venda.DadosEstabelecimento || {};
  const empresa = venda.NomeAgencia || venda.Empresa || est.RazaoSocial || 'TURIN TRANSPORTES LTDA';

  // ————— chBPe / tpAmb / URL do QR —————
  const chaveBPe = venda.ChaveBPe || venda.Chave || venda.ChaveAcesso || root.chaveBPe || '';
  const baseQr = venda.UrlQrCodeBPe || root.urlQrBPe || 'https://bpe.fazenda.mg.gov.br/portalbpe/sistema/qrcode.xhtml';
  // tpAmb: 1 produção, 2 homologação
  const tpAmb = (est.AmbienteProducao === false || String(est.AmbienteProducao) === 'false') ? 2 : 1;
  const qrUrlFull = chaveBPe ? `${baseQr}?chBPe=${encodeURIComponent(chaveBPe)}&tpAmb=${tpAmb}` : baseQr;

  const ticket = {
    // Empresa
    empresa,
    cnpjEmpresa: venda.CNPJPrincipal || est.Cnpj || '03308232000108',
    ie: venda.IEstadual || est.IEstadual || '4610699670002',
    im: venda.IMunicipal || est.IMunicipal || '1062553',
    enderecoEmpresa: venda.Endereco || (est.Endereco ? `${est.Endereco}, ${est.Numero || ''}`.trim() : 'Avenida Presidente Juscelino Kubitschek, 890'),
    bairroEmpresa: venda.Bairro || est.Bairro || 'Bauxita',
    cidadeEmpresa: (venda.NomeCidade ? `${venda.NomeCidade} - ${venda.Uf || 'MG'}` :
                    (est.NomeCidade ? `${est.NomeCidade} - ${est.Uf || 'MG'}` : 'Ouro Preto - MG')),
    telefoneEmpresa: venda.Telefone || est.Telefone || '3135511650',

    // Viagem
    horaPartida: fmtHora(venda.HoraPartida ?? venda.Hora ?? root.horaPartida),
    classe: venda.TipoCarro || venda.DescServico || '—',
    origem: venda.Origem || root.origem || '—',
    destino: venda.Destino || root.destino || '—',
    nomeLinha: venda.NomeLinha || root.nomeLinha || '—',
    dataViagem: fmtData(venda.DataPartida || root.dataViagem),
    codigoLinha: venda.CodigoLinha || root.codigoLinha || '—',
    numPassagem: venda.NumPassagem || root.numPassagem || '—',
    serie: venda.SerieBloco || venda.SerieV || root.serie || '—',
    poltrona: venda.Poltrona || root.poltrona || '—',

    // Passageiro
    nomeCliente: venda.NomeCliente || venda.NomeCli || root.nomeCliente || '—',
    documento: venda.DocCliente || venda.IdentidadeCli || root.documento || '—',

    // Valores
    tarifa: fmtMoney(venda.ValorTarifa ?? root.tarifa),
    taxaEmbarque: fmtMoney(venda.TaxaEmbarque ?? root.taxaEmbarque),
    outros: fmtMoney(venda.Outros ?? root.outros),
    valorTotalFmt: fmtMoney(venda.ValorPago ?? venda.ValorPgto ?? root.valorTotal ?? mp.transaction_amount),
    formaPagamento: resolveFormaPgto(),

    // BPe / QR
    chaveBPe,
    urlQrBPe: baseQr,                 // base (sem params) — só se precisar
    urlConsultaAcesso: 'https://bpe.fazenda.mg.gov.br/bpe/services/BPeConsultaDFe',
    qrUrl: qrUrlFull,                 // ← usar ESTE para gerar o QR
    tpAmb,

    // Emissão
    emissaoISO: root.emissaoISO || new Date().toISOString(),

    // Preferência visual opcional (se quiser centralizar tudo no cabeçalho)
    // headerCentered: !!root.headerCentered
    headerCentered: true
  };

  return ticket;
}

module.exports = mapVendaToTicket;                  // default
module.exports.mapVendaToTicket = mapVendaToTicket; // nomeado
