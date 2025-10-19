// services/ticket/mapper.js — rev7 (robusto p/ diferentes formatos)

function mapVendaToTicket(root = {}) {
  // --- escolher a "venda" certa (tenta em várias estruturas) ---
  const candidates = [];
  if (root?.venda?.ListaPassagem?.[0]) candidates.push(root.venda.ListaPassagem[0]);
  if (root?.ListaPassagem?.[0])        candidates.push(root.ListaPassagem[0]);
  if (root?.venda)                     candidates.push(root.venda);
  if (root?.bpe)                       candidates.push(root.bpe);
  // por último, o próprio root pode ser a venda
  candidates.push(root);

  const venda = candidates.find(v =>
    v && (
      v.Origem || v.Destino || v.NomeLinha || v.CodigoLinha ||
      v.NumPassagem || v.DadosEstabelecimento || v.NomeAgencia
    )
  ) || {};

  const mp = root.mp || {};
  const pg = root.pg || venda.Pagamento || {};

  // ---- helpers ----
  const fmtMoney = v => {
    const n = Number(String(v ?? 0).toString().replace(',', '.'));
    if (!isFinite(n)) return 'R$ 0,00';
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };
  const pad = n => String(n).padStart(2, '0');

  const fmtHora = h => {
    const s = String(h ?? '');
    if (s.length === 4 && /^\d{4}$/.test(s)) return `${s.slice(0,2)}:${s.slice(2)}`;
    if (/^\d{2}:\d{2}$/.test(s)) return s;
    if (s.length === 3 && /^\d{3}$/.test(s)) return `${pad(s[0])}:${s.slice(1)}`;
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
    // Mercado Pago
    const ptype = String(mp.payment_type_id || '').toLowerCase();
    const pmeth = String(mp.payment_method_id || '').toLowerCase();
    if (ptype === 'credit_card' ||
        ['visa','master','elo','amex','hipercard','diners'].some(b => pmeth.includes(b)))
      return 'Cartão de Crédito';
    if (pmeth === 'pix' || ptype === 'bank_transfer') return 'Pix';

    // Praxio
    if (typeof venda?.FormaPgto === 'string' && venda.FormaPgto.trim()) return venda.FormaPgto;
    if (pg) {
      if (Number(pg.TipoCartao) !== 0 && pg.TipoCartao != null) return 'Cartão de Crédito';
      if (String(pg.TipoPagamento) === '0') return 'Dinheiro';
    }
    return '—';
  }

  // Empresa (usa DadosEstabelecimento quando existir)
  const est = venda.DadosEstabelecimento || {};

  const ticket = {
    // Empresa
    empresa: venda.NomeAgencia || venda.Empresa || est.RazaoSocial || 'TURIN TRANSPORTES LTDA',
    cnpjEmpresa: venda.CNPJPrincipal || est.Cnpj || '03308232000108',
    ie: venda.IEstadual || est.IEstadual || '4610699670002',
    im: venda.IMunicipal || est.IMunicipal || '1062553',
    enderecoEmpresa: venda.Endereco || (est.Endereco ? `${est.Endereco}, ${est.Numero || ''}`.trim() : 'Avenida Presidente Juscelino Kubitschek, 890'),
    bairroEmpresa: venda.Bairro || est.Bairro || 'Bauxita',
    cidadeEmpresa: (venda.NomeCidade ? `${venda.NomeCidade} - ${venda.Uf || 'MG'}` :
                    (est.NomeCidade ? `${est.NomeCidade} - ${est.Uf || 'MG'}` : 'Ouro Preto - MG')),
    telefoneEmpresa: venda.Telefone || est.Telefone || '3135511650',

    // Viagem / bilhete
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
    chaveBPe: venda.ChaveBPe || venda.Chave || venda.ChaveAcesso || root.chaveBPe || '',
    urlQrBPe: venda.UrlQrCodeBPe || root.urlQrBPe || 'https://bpe.fazenda.mg.gov.br/portalbpe/sistema/qrcode.xhtml',
    urlConsultaAcesso: 'https://bpe.fazenda.mg.gov.br/bpe/services/BPeConsultaDFe',
    qrUrl: venda.UrlQrCodeBPe || root.qrUrl || '',

    // Emissão
    emissaoISO: root.emissaoISO || new Date().toISOString()
  };

  return ticket;
}

module.exports = mapVendaToTicket;                  // default
module.exports.mapVendaToTicket = mapVendaToTicket; // nomeado
