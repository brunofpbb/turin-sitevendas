// services/ticket/pdf.js — rev6 (fix valores vazios, caminho do logo, bloco QR)
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

// Helpers
function formatEmissaoBR(iso, tzOffsetMin = -180) {
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
  let s = String((text || '')); // <-- aceita '' mas cai no fallback lá no value()
  if (!s) return '';
  if (doc.widthOfString(s) <= w) return s;
  while (s.length && doc.widthOfString(s + ell) > w) s = s.slice(0,-1);
  return s + ell;
}
function safeName(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^A-Za-z0-9_-]+/g,'_').replace(/_+/g,'_').replace(/^_+|_+$/g,'');
}

exports.generateTicketPdf = async (t, outDir) => {
  await fs.promises.mkdir(outDir, { recursive: true });

  const baseName = `bpe_${safeName(t.nomeCliente)}_${safeName((t.dataViagem||'').replace(/\D/g,''))}_${safeName((t.horaPartida||'').replace(/\D/g,''))}_${safeName(t.numPassagem) || 'boleto'}.pdf`;
  const outPath = path.join(outDir, baseName);

  const qrDataURL = await QRCode.toDataURL(t.qrUrl || t.urlQrBPe || '', { margin: 1, scale: 6 });

  const doc = new PDFDocument({ size: 'A4', margins: { top: 36, left: 36, right: 36, bottom: 42 } });
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  const pageW = () => (doc.page.width - doc.page.margins.left - doc.page.margins.right);
  const left = () => doc.page.margins.left;
  const centerX = () => left() + pageW()/2;
  const HR = (y) => {
    doc.save()
      .moveTo(left(), y)
      .lineTo(left()+pageW(), y)
      .lineWidth(0.7)
      .strokeColor('#bbb')
      .stroke()
      .restore();
  };

  // Título
  doc.font('Helvetica-Bold').fontSize(14)
     .text('DABP-e - Documento Auxiliar do Bilhete de Passagem Eletrônico', left(), doc.y, { width: pageW(), align:'center' });
  let y = doc.y + 8; HR(y); doc.y = y + 10;

  // ===== Empresa (logo + textos)
  (function renderEmpresa() {
    // 1) procura na raiz /img, 2) fallback /sitevendas/img
    const logoCandidates = [
      path.join(__dirname, '..', '..', 'img', 'Logo Nova ISO2.jpg'),
      path.join(__dirname, '..', '..', 'sitevendas', 'img', 'Logo Nova ISO2.jpg'),
    ];
    const logoPath = logoCandidates.find(p => { try { return fs.existsSync(p); } catch { return false; } });

    if (logoPath) {
      const startY = doc.y;
      const imgW = 90;
      const gap  = 10;
      const textX = left() + imgW + gap;
      const textW = pageW() - imgW - gap;

      doc.image(logoPath, left(), startY, { width: imgW });

      doc.font('Helvetica-Bold').fontSize(11).fillColor('#000')
         .text(t.empresa || 'TURIN TRANSPORTES LTDA', textX, startY, { width: textW, align:'left' });

      doc.font('Helvetica').fontSize(9).fillColor('#000');
      const l1 = [];
      if (t.cnpjEmpresa) l1.push(`CNPJ: ${t.cnpjEmpresa}`);
      if (t.ie)          l1.push(`IE.: ${t.ie}`);
      if (t.im)          l1.push(`IM.: ${t.im}`);
      if (l1.length) doc.text(l1.join('    '), { width: textW, align:'left' });

      const l2 = [];
      if (t.enderecoEmpresa) l2.push(t.enderecoEmpresa);
      if (t.bairroEmpresa)   l2.push(`- ${t.bairroEmpresa}`);
      if (l2.length) doc.text(l2.join(' '), { width: textW, align:'left' });

      const l3 = [];
      if (t.cidadeEmpresa)   l3.push(t.cidadeEmpresa);
      if (t.telefoneEmpresa) l3.push(`Telefone: ${t.telefoneEmpresa}`);
      if (l3.length) doc.text(l3.join(' - '), { width: textW, align:'left' });

      const afterY = Math.max(startY + 52, doc.y);
      HR(afterY);
      doc.y = afterY + 8;
    } else {
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#000')
         .text(t.empresa || 'TURIN TRANSPORTES LTDA', { width: pageW(), align:'center' });
      doc.font('Helvetica').fontSize(9).fillColor('#000');
      const l1 = [];
      if (t.cnpjEmpresa) l1.push(`CNPJ: ${t.cnpjEmpresa}`);
      if (t.ie)          l1.push(`IE.: ${t.ie}`);
      if (t.im)          l1.push(`IM.: ${t.im}`);
      if (l1.length) doc.text(l1.join('    '), { width: pageW(), align:'center' });
      if (t.enderecoEmpresa) doc.text(t.enderecoEmpresa, { width: pageW(), align:'center' });
      const l3 = [];
      if (t.cidadeEmpresa)   l3.push(t.cidadeEmpresa);
      if (t.telefoneEmpresa) l3.push(`Telefone: ${t.telefoneEmpresa}`);
      if (l3.length) doc.text(l3.join(' - '), { width: pageW(), align:'center' });
      HR(doc.y); doc.y += 8;
    }
  })();

  // ===== Bloco “Detalhes da viagem”
  const w = pageW();
  const colW = Math.floor(w/3) - 12;
  const x0 = left(), x1 = x0 + colW + 18, x2 = x1 + colW + 18;
  const gridStartY = doc.y;
  const rowH = 26;

  const label = (txt, x, yy) => doc.font('Helvetica').fontSize(9).fillColor('#555').text(txt, x, yy, { width: colW, lineBreak:false });
  const value = (txt, x, yy, bold=true) => {
    const val = (txt || '—');                  // <-- aqui corrige string vazia
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(11).fillColor('#111');
    doc.text(fit(doc, val, colW), x, yy, { width: colW, lineBreak:false });
  };
  const cell = (x, lbl, val, row) => {
    const yy = gridStartY + row*rowH;
    label(lbl, x, yy);
    value(val, x, yy + 11);
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

  const afterGrid = gridStartY + 4*rowH + 10;
  HR(afterGrid);

  // ===== Linha Passageiro / Documento
  const yPD = afterGrid + 10;
  const half = Math.floor(w/2) - 10;
  doc.font('Helvetica').fontSize(9).fillColor('#555').text('Passageiro:', x0, yPD, { width: 70, lineBreak:false });
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#111')
     .text(fit(doc, (t.nomeCliente || '—'), half - 80), x0 + 70, yPD, { width: half-80, lineBreak:false });

  doc.font('Helvetica').fontSize(9).fillColor('#555').text('Documento:', x0 + half + 20, yPD, { width: 80, lineBreak:false });
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#111')
     .text(fit(doc, (t.documento || '—'), half - 100), x0 + half + 20 + 80, yPD, { width: half-100, lineBreak:false });

  const yPDLine = yPD + 18;
  HR(yPDLine);

  // ===== Totais (2 colunas)
  const yVals = yPDLine + 10;
  const halfW = Math.floor(w/2) - 12;
  const colRightX = x0 + halfW + 24;

  let yL = yVals;
  const moneyL = (lbl, val) => {
    doc.font('Helvetica').fontSize(9).fillColor('#555').text(lbl, x0, yL, { width: halfW, lineBreak:false });
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#111').text(String(val || 'R$ 0,00'), x0, yL + 11, { width: halfW, lineBreak:false });
    yL += 28;
  };
  moneyL('Tarifa', t.tarifa);
  moneyL('Taxa de Embarque', t.taxaEmbarque);
  moneyL('Outros', t.outros);

  let yR = yVals;
  const moneyR = (lbl, val, big=false) => {
    doc.font('Helvetica').fontSize(9).fillColor('#555').text(lbl, colRightX, yR, { width: halfW, lineBreak:false });
    doc.font('Helvetica-Bold').fontSize(big?12:11).fillColor('#111').text(String(val || '—'), colRightX, yR + 11, { width: halfW, lineBreak:false });
    yR += 28;
  };
  moneyR('Forma de Pagamento', t.formaPagamento || '—');
  moneyR('Valor Pago', t.valorTotalFmt, true);

  // ===== BLOCO DO QR (ordem solicitada)
  const yBeforeQR = Math.max(yL, yR) + 6;
  HR(yBeforeQR);
  doc.y = yBeforeQR;
  doc.moveDown(2.4); // respiro

  // 1) Consulta via chave de acesso
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000')
     .text('Consulta via chave de acesso', left(), doc.y, { width: pageW(), align:'center' });

// 2) URL oficial
doc.moveDown(0.3);
doc.font('Helvetica').fontSize(10).fillColor('#000')
   .text(t.urlConsultaAcesso || 'https://bpe.fazenda.mg.gov.br/bpe/services/BPeConsultaDFe',
     left(), doc.y, { width: pageW(), align:'center' });

// 3) Chave logo abaixo da URL (sempre reserva a linha)
doc.moveDown(0.2);
doc.font('Helvetica').fontSize(9).fillColor('#000')
   .text(t.chaveBPe ? t.chaveBPe : ' ', left(), doc.y, { width: pageW(), align:'center' });


  // 4) Título do QR
  doc.moveDown(0.9);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000')
     .text('Consulta via leitor de QR Code', left(), doc.y, { width: pageW(), align:'center' });

  // 5) QR centralizado
  const qrSize = 110;
  const qrX = centerX() - qrSize/2;
  const qrY = doc.y + 6;
  doc.image(qrDataURL, qrX, qrY, { width: qrSize, height: qrSize });
  doc.y = qrY + qrSize + 10;

  // 6) Emissão
  doc.font('Helvetica').fontSize(9).fillColor('#000')
     .text(`Emissão: ${formatEmissaoBR(t.emissaoISO, -180)}`, left(), doc.y, { width: pageW(), align:'center' });

  // 7) Protocolo
  doc.moveDown(0.2);
  doc.font('Helvetica').fontSize(10).fillColor('#000')
     .text('Protocolo de autorização: EMITIDO EM CONTINGÊNCIA', left(), doc.y, { width: pageW(), align:'center' });

  doc.end();
  await new Promise(r => stream.on('finish', r));
  return { path: outPath, filename: baseName };
};
