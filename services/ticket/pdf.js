// services/ticket/pdf.js (rev3 – fixa sobreposição, separadores e centragem do bloco do QR)
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

// ---- helpers ---------------------------------------------------------------
function fmtDataBR(iso, tzOffsetMin = -180) {
  const src = new Date(iso || Date.now());
  const local = new Date(src.getTime() + (tzOffsetMin + src.getTimezoneOffset()) * 60000);
  const p = n => String(n).padStart(2, '0');
  const y = local.getFullYear(), m = p(local.getMonth()+1), d = p(local.getDate());
  const hh = p(local.getHours()), mm = p(local.getMinutes());
  const sgn = tzOffsetMin <= 0 ? '-' : '+';
  const oh = p(Math.floor(Math.abs(tzOffsetMin)/60)), om = p(Math.abs(tzOffsetMin)%60);
  return `${d}/${m}/${y} ${hh}:${mm} ${sgn}${oh}:${om}`;
}
function fit(doc, text, w) {
  const ell = '…';
  let s = String(text ?? '');
  if (!s) return '';
  if (doc.widthOfString(s) <= w) return s;
  while (s.length && doc.widthOfString(s + ell) > w) s = s.slice(0, -1);
  return s + ell;
}

// ---- main ------------------------------------------------------------------
exports.generateTicketPdf = async (t, outDir) => {
  await fs.promises.mkdir(outDir, { recursive: true });

  const baseName = `bpe_${(t.nomeCliente||'passageiro').replace(/\s+/g,'_')}_${(t.dataViagem||'').replace(/\D/g,'')}_${(t.horaPartida||'').replace(/\D/g,'')}_${t.numPassagem||''}.pdf`;
  const outPath = path.join(outDir, baseName);

  const qrDataURL = await QRCode.toDataURL(t.qrUrl || '', { margin: 1, scale: 6 });

  const doc = new PDFDocument({ size: 'A4', margins: { top: 36, left: 36, right: 36, bottom: 48 } });
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  const fullW = () => (doc.page.width - doc.page.margins.left - doc.page.margins.right);
  const cx = () => (doc.page.margins.left + fullW()/2);
  const HR = (y) => {
    doc.save()
      .moveTo(doc.page.margins.left, y)
      .lineTo(doc.page.margins.left + fullW(), y)
      .lineWidth(0.7)
      .strokeColor('#bbb')
      .stroke()
      .restore();
  };

  // Título
  doc.font('Helvetica-Bold').fontSize(14).text(
    'DABP-e - Documento Auxiliar do Bilhete de Passagem Eletrônico',
    doc.page.margins.left, doc.y, { width: fullW(), align: 'center'
  });
  let y = doc.y + 8; HR(y); doc.y = y + 12;

  // Cabeçalho empresa
  doc.font('Helvetica-Bold').fontSize(12).text(t.empresa || 'TURIN TRANSPORTES LTDA', { width: fullW(), align:'center' });
  doc.font('Helvetica').fontSize(10).fillColor('#000');
  const l1 = [];
  if (t.cnpjEmpresa) l1.push(`CNPJ: ${t.cnpjEmpresa}`);
  if (t.ie)          l1.push(`IE.: ${t.ie}`);
  if (t.im)          l1.push(`IM.: ${t.im}`);
  doc.text(l1.join('    '), { width: fullW(), align:'center' });
  if (t.enderecoEmpresa) doc.text(t.enderecoEmpresa, { width: fullW(), align:'center' });
  const l2 = [];
  if (t.cidadeEmpresa)   l2.push(t.cidadeEmpresa);
  if (t.telefoneEmpresa) l2.push(`Telefone: ${t.telefoneEmpresa}`);
  if (l2.length) doc.text(l2.join('  -  '), { width: fullW(), align:'center' });

  y = doc.y + 10; HR(y); doc.y = y + 12;

  // ==== Bloco "dados da viagem" (3 colunas x 4 linhas) ====
  const w = fullW();
  const colW = Math.floor(w/3) - 12;     // largura segura
  const x0 = doc.page.margins.left, x1 = x0 + colW + 18, x2 = x1 + colW + 18;
  const yStart = doc.y;
  const rowH = 26;                       // rótulo (9) em y, valor (11) em y+11

  const label = (txt, x, y) => doc.font('Helvetica').fontSize(9).fillColor('#555').text(txt, x, y, { width: colW, lineBreak:false });
  const value = (txt, x, y, bold=true) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(11).fillColor('#111');
    doc.text(fit(doc, String(txt ?? '—'), colW), x, y, { width: colW, lineBreak:false });
  };
  const cell = (x, rLabel, rValue, rowIndex) => {
    const y = yStart + rowIndex*rowH;
    label(rLabel, x, y);
    value(rValue, x, y + 11);
  };

  // linha 0
  cell(x0, 'Empresa', t.empresa, 0);
  cell(x1, 'Horário', t.horaPartida, 0);
  cell(x2, 'Classe',  t.classe, 0);
  // linha 1
  cell(x0, 'Origem',   t.origem, 1);
  cell(x1, 'Poltrona', t.poltrona, 1);
  cell(x2, 'Bilhete',  t.numPassagem, 1);
  // linha 2
  cell(x0, 'Destino', t.destino, 2);
  cell(x1, 'Linha',   t.nomeLinha, 2);
  cell(x2, 'Série',   t.serie, 2);
  // linha 3
  cell(x0, 'Data',    t.dataViagem, 3);
  cell(x1, 'Prefixo', t.codigoLinha, 3);

  const yAfterGrid = yStart + 4*rowH + 10;
  HR(yAfterGrid);
  doc.y = yAfterGrid + 12;

  // ==== Passageiro (nome e documento numa mesma linha) ====
  const half = Math.floor(w/2) - 10;
  doc.font('Helvetica').fontSize(9).fillColor('#555').text('Passageiro', x0, doc.y, { width: half, lineBreak:false });
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#111').text(fit(doc, t.nomeCliente || '—', half), x0, doc.y+11, { width: half, lineBreak:false });

  doc.font('Helvetica').fontSize(9).fillColor('#555').text('Documento', x0+half+20, doc.y, { width: half-20, lineBreak:false });
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#111').text(fit(doc, t.documento || '—', half-20), x0+half+20, doc.y+11, { width: half-20, lineBreak:false });

  // separador obrigatório entre passageiro e valores
  const ySep = yAfterGrid + 12 + 26 + 10;
  HR(ySep);
  doc.y = ySep + 12;

  // ==== Totais (4 colunas) ====
  const cW = Math.floor(w/4) - 8;
  const cxCol = i => doc.page.margins.left + i*(cW + 12);
  const money = (lbl, val, i, big=false) => {
    const x = cxCol(i), y = doc.y;
    doc.font('Helvetica').fontSize(9).fillColor('#555').text(lbl, x, y, { width: cW, lineBreak:false });
    doc.font('Helvetica-Bold').fontSize(big?12:11).fillColor('#111').text(String(val ?? 'R$ 0,00'), x, y+11, { width: cW, lineBreak:false });
  };
  money('Tarifa', t.tarifa, 0);
  money('Taxa de Embarque', t.taxaEmbarque, 1);
  money('Outros', t.outros, 2);
  money('Valor Pago', t.valorTotalFmt, 3, true);

  doc.y += 26 + 8;
  HR(doc.y);
  doc.y += 12;

  // ==== QR centralizado e bloco de textos centralizados ====
  const qrSize = 120; // voltou a ser discreto
  const qrX = cx() - (qrSize/2);
  const qrY = doc.y;
  doc.image(qrDataURL, qrX, qrY, { fit: [qrSize, qrSize] });

  // força cursor abaixo do QR com padding fixo
  doc.y = qrY + qrSize + 12;

  const emissaoBR = fmtDataBR(t.emissaoISO, -180);
  doc.font('Helvetica').fontSize(10).fillColor('#000')
     .text(`Emissão: ${emissaoBR}`, { width: fullW(), align:'center' });

  if (t.qrUrl) {
    doc.font('Helvetica').fontSize(10)
       .text(t.qrUrl, { width: fullW(), align:'center' });
  }
  if (t.chaveBPe) {
    doc.font('Helvetica').fontSize(10)
       .text(t.chaveBPe, { width: fullW(), align:'center' });
  }

  doc.moveDown(0.4);
  doc.font('Helvetica').fontSize(11)
     .text('Protocolo de autorização: EMITIDO EM CONTINGÊNCIA', { width: fullW(), align:'center' });

  // Rodapé
  doc.font('Helvetica').fontSize(9).fillColor('#666')
     .text(`© ${new Date().getFullYear()} Turin Transportes`, doc.page.margins.left, doc.page.height - doc.page.margins.bottom + 16, { width: fullW(), align:'center' });

  doc.end();
  await new Promise(r => stream.on('finish', r));
  return { path: outPath, filename: baseName };
};
