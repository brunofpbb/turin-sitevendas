// services/ticket/pdf.js (rev4)
// Fixa: bloco Passageiro/Documento + Totais, centralização dos textos do QR e 1 página apenas.

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

function fmtDataBR(iso, tzOffsetMin = -180) {
  const src = new Date(iso || Date.now());
  const local = new Date(src.getTime() + (tzOffsetMin + src.getTimezoneOffset()) * 60000);
  const p = n => String(n).padStart(2,'0');
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
  while (s.length && doc.widthOfString(s + ell) > w) s = s.slice(0,-1);
  return s + ell;
}

exports.generateTicketPdf = async (t, outDir) => {
  await fs.promises.mkdir(outDir, { recursive: true });

  const baseName = `bpe_${(t.nomeCliente||'passageiro').replace(/\s+/g,'_')}_${(t.dataViagem||'').replace(/\D/g,'')}_${(t.horaPartida||'').replace(/\D/g,'')}_${t.numPassagem||''}.pdf`;
  const outPath = path.join(outDir, baseName);

  const qrDataURL = await QRCode.toDataURL(t.qrUrl || '', { margin: 1, scale: 6 });

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 36, left: 36, right: 36, bottom: 42 }
  });
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  const fullW = () => (doc.page.width - doc.page.margins.left - doc.page.margins.right);
  const left = () => doc.page.margins.left;
  const cx = () => (left() + fullW()/2);
  const HR = (y) => {
    doc.save()
      .moveTo(left(), y)
      .lineTo(left() + fullW(), y)
      .lineWidth(0.7)
      .strokeColor('#bbb')
      .stroke()
      .restore();
  };

  // ===== Título
  doc.font('Helvetica-Bold').fontSize(14)
     .text('DABP-e - Documento Auxiliar do Bilhete de Passagem Eletrônico', left(), doc.y, { width: fullW(), align: 'center' });
  let y = doc.y + 8; HR(y); doc.y = y + 12;

  // ===== Empresa
  doc.font('Helvetica-Bold').fontSize(12)
     .text(t.empresa || 'TURIN TRANSPORTES LTDA', left(), doc.y, { width: fullW(), align:'center' });
  doc.font('Helvetica').fontSize(10).fillColor('#000');
  const l1 = [];
  if (t.cnpjEmpresa) l1.push(`CNPJ: ${t.cnpjEmpresa}`);
  if (t.ie)          l1.push(`IE.: ${t.ie}`);
  if (t.im)          l1.push(`IM.: ${t.im}`);
  if (l1.length) doc.text(l1.join('    '), left(), doc.y, { width: fullW(), align:'center' });
  if (t.enderecoEmpresa) doc.text(t.enderecoEmpresa, left(), doc.y, { width: fullW(), align:'center' });
  const l2 = [];
  if (t.cidadeEmpresa)   l2.push(t.cidadeEmpresa);
  if (t.telefoneEmpresa) l2.push(`Telefone: ${t.telefoneEmpresa}`);
  if (l2.length) doc.text(l2.join('  -  '), left(), doc.y, { width: fullW(), align:'center' });

  y = doc.y + 10; HR(y); doc.y = y + 12;

  // ===== Bloco “Detalhes da Viagem” (mantido como aprovado)
  const w = fullW();
  const colW = Math.floor(w/3) - 12;
  const x0 = left(), x1 = x0 + colW + 18, x2 = x1 + colW + 18;
  const yStart = doc.y;
  const rowH = 26;

  const label = (txt, x, y) => doc.font('Helvetica').fontSize(9).fillColor('#555').text(txt, x, y, { width: colW, lineBreak:false });
  const value = (txt, x, y, bold=true) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(11).fillColor('#111');
    doc.text(fit(doc, String(txt ?? '—'), colW), x, y, { width: colW, lineBreak:false });
  };
  const cell = (x, rLabel, rValue, rowIndex) => {
    const yy = yStart + rowIndex*rowH;
    label(rLabel, x, yy);
    value(rValue, x, yy + 11);
  };

  cell(x0, 'Empresa', t.empresa, 0);
  cell(x1, 'Horário', t.horaPartida, 0);
  cell(x2, 'Classe',  t.classe, 0);

  cell(x0, 'Origem',   t.origem, 1);
  cell(x1, 'Poltrona', t.poltrona, 1);
  cell(x2, 'Bilhete',  t.numPassagem, 1);

  cell(x0, 'Destino', t.destino, 2);
  cell(x1, 'Linha',   t.nomeLinha, 2);
  cell(x2, 'Série',   t.serie, 2);

  cell(x0, 'Data',    t.dataViagem, 3);
  cell(x1, 'Prefixo', t.codigoLinha, 3);

  const yAfterGrid = yStart + 4*rowH + 10;
  HR(yAfterGrid);

  // ===== Linha “Passageiro / Documento”
  const padTop = 10;
  const half = Math.floor(w/2) - 10;
  const yPD = yAfterGrid + padTop;
  doc.font('Helvetica').fontSize(9).fillColor('#555').text('Passageiro:', x0, yPD, { width: 70, lineBreak:false });
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#111')
     .text(fit(doc, t.nomeCliente || '—', half - 80), x0 + 70, yPD, { width: half - 80, lineBreak:false });

  doc.font('Helvetica').fontSize(9).fillColor('#555').text('Documento:', x0 + half + 20, yPD, { width: 80, lineBreak:false });
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#111')
     .text(fit(doc, t.documento || '—', half - 100), x0 + half + 20 + 80, yPD, { width: half - 100, lineBreak:false });

  // separador abaixo (restaurado)
  const yPDLine = yPD + 18;
  HR(yPDLine);

  // ===== Totais (2 colunas com subitens), como na sua print
  const yVals = yPDLine + 10;
  const colHalfW = Math.floor(w/2) - 12;
  const colRightX = x0 + colHalfW + 24;

  // esquerda: Tarifa / Taxa / Outros
  let yCursor = yVals;
  const itemL = (lbl, val) => {
    doc.font('Helvetica').fontSize(9).fillColor('#555').text(lbl, x0, yCursor, { width: colHalfW, lineBreak:false });
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#111').text(String(val || 'R$ 0,00'), x0, yCursor + 11, { width: colHalfW, lineBreak:false });
    yCursor += 30;
  };
  itemL('Tarifa', t.tarifa);
  itemL('Taxa de Embarque', t.taxaEmbarque);
  itemL('Outros', t.outros);

  // direita: Forma de Pagamento / Valor Pago
  let yCursorR = yVals;
  const itemR = (lbl, val, big=false) => {
    doc.font('Helvetica').fontSize(9).fillColor('#555').text(lbl, colRightX, yCursorR, { width: colHalfW, lineBreak:false });
    doc.font('Helvetica-Bold').fontSize(big ? 12 : 11).fillColor('#111')
       .text(String(val || '—'), colRightX, yCursorR + 11, { width: colHalfW, lineBreak:false });
    yCursorR += 30;
  };
  itemR('Forma de Pagamento', t.formaPagamento || t.forma_pagamento || '—');
  itemR('Valor Pago', t.valorTotalFmt, true);

  // traço fino antes do QR
  const yBeforeQR = Math.max(yCursor, yCursorR) + 6;
  HR(yBeforeQR);

  // ===== QR + textos centralizados (coordenadas explícitas)
  const qrSize = 120;
  const qrX = cx() - qrSize/2;
  const qrY = yBeforeQR + 12;
  doc.image(qrDataURL, qrX, qrY, { fit: [qrSize, qrSize] });

  // bloco de textos CENTRALIZADOS abaixo:
  const textBlockTop = qrY + qrSize + 10;
  const wAll = fullW();
  doc.font('Helvetica').fontSize(10).fillColor('#000')
     .text(`Emissão: ${fmtDataBR(t.emissaoISO, -180)}`, left(), textBlockTop, { width: wAll, align: 'center' });

  if (t.qrUrl) {
    doc.font('Helvetica').fontSize(10)
       .text(t.qrUrl, left(), doc.y + 2, { width: wAll, align: 'center' });
  }
  if (t.chaveBPe) {
    doc.font('Helvetica').fontSize(10)
       .text(t.chaveBPe, left(), doc.y + 2, { width: wAll, align: 'center' });
  }

  doc.font('Helvetica').fontSize(11)
     .text('Protocolo de autorização: EMITIDO EM CONTINGÊNCIA', left(), doc.y + 4, { width: wAll, align: 'center' });

  // Sem rodapé — garante 1 página
  doc.end();
  await new Promise(r => stream.on('finish', r));
  return { path: outPath, filename: baseName };
};
