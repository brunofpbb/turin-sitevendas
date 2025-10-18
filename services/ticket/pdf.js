// services/ticket/pdf.js
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const { sanitizeFile } = require('./utils');

// formata ISO para "DD/MM/AAAA HH:mm -03:00"
function formatEmissaoBR(iso, tzOffsetMin = -180) {
  const src = new Date(iso || Date.now());
  const local = new Date(src.getTime() + (tzOffsetMin + src.getTimezoneOffset()) * 60000);
  const pad = (n)=> String(n).padStart(2,'0');
  const y = local.getFullYear();
  const m = pad(local.getMonth()+1);
  const d = pad(local.getDate());
  const hh = pad(local.getHours());
  const mm = pad(local.getMinutes());
  const sgn = tzOffsetMin <= 0 ? '-' : '+';
  const oh = pad(Math.floor(Math.abs(tzOffsetMin)/60));
  const om = pad(Math.abs(tzOffsetMin)%60);
  return `${d}/${m}/${y} ${hh}:${mm} ${sgn}${oh}:${om}`;
}

exports.generateTicketPdf = async (t, outDir) => {
  await fs.promises.mkdir(outDir, { recursive: true });

  const baseName = [
    'bpe',
    sanitizeFile(t.nomeCliente || 'passageiro'),
    sanitizeFile((t.dataViagem || '').replaceAll('/','')),
    sanitizeFile((t.horaPartida || '').replace(':','')),
    sanitizeFile(t.numPassagem || '')
  ].filter(Boolean).join('_') + '.pdf';

  const outPath = path.join(outDir, baseName);

  const qrDataURL = await QRCode.toDataURL(t.qrUrl, { margin: 1, scale: 5 });

  const doc = new PDFDocument({
    size: 'A5',
    margins: { top: 16, left: 16, right: 16, bottom: 16 }
  });
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  const fullW = () => (doc.page.width - doc.page.margins.left - doc.page.margins.right);
  const centerX = () => (doc.page.margins.left + fullW()/2);
  const HR = (y) => {
    doc.moveTo(doc.page.margins.left, y)
       .lineTo(doc.page.width - doc.page.margins.right, y)
       .strokeColor('#d0d0d0').lineWidth(0.6).stroke();
  };

  // ===== Cabeçalho opcional com imagem
  try {
    const headerPath = path.join(__dirname, '..', '..', 'sitevendas', 'img', 'bpe-header.png');
    if (fs.existsSync(headerPath)) {
      doc.image(headerPath, doc.page.margins.left, doc.y, { fit: [fullW(), 44] });
      doc.moveDown(0.3);
    }
  } catch(_) {}

  // Título
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#000')
     .text('DABP-e - Documento Auxiliar do Bilhete de Passagem Eletrônico', { align: 'center', width: fullW() });

  let y = doc.y + 6;
  HR(y);
  doc.y = y + 6;

  // ===== Empresa (centralizado)
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#000')
     .text(t.empresa || 'TURIN TRANSPORTES LTDA', { align:'center', width: fullW() });
  doc.font('Helvetica').fontSize(9).fillColor('#000');
  const parts2 = [];
  if (t.cnpjEmpresa) parts2.push(`CNPJ: ${t.cnpjEmpresa}`);
  if (t.ie) parts2.push(`IE.: ${t.ie}`);
  doc.text(parts2.join('    '), { align:'center', width: fullW() });

  const parts3 = [];
  if (t.enderecoEmpresa) parts3.push(`${t.enderecoEmpresa}`);
  if (t.bairroEmpresa)   parts3.push(`- ${t.bairroEmpresa}`);
  doc.text(parts3.join(' '), { align:'center', width: fullW() });

  const parts4 = [];
  if (t.cidadeEmpresa)   parts4.push(t.cidadeEmpresa);
  if (t.telefoneEmpresa) parts4.push(`Telefone: ${t.telefoneEmpresa}`);
  doc.text(parts4.join('  -  '), { align:'center', width: fullW() });

  y = doc.y + 6;
  HR(y);
  doc.y = y + 6;

  // ===== GRID: 3 colunas alinhadas por coordenada (evita sobreposição)
  const w = fullW();
  const colW = Math.floor(w / 3) - 4;   // largura segura por coluna
  const x0 = doc.page.margins.left;
  const x1 = x0 + colW + 14;            // empurra um pouco à direita
  const x2 = x1 + colW + 14;

  const yStart = doc.y;
  const lh = 14;
  const label = (txt, x, y) => {
    doc.font('Helvetica').fontSize(8).fillColor('#555').text(txt, x, y, { width: colW, height: lh, lineBreak: false });
  };
  const value = (txt, x, y, big=false) => {
    doc.font('Helvetica-Bold').fontSize(big ? 10.5 : 10).fillColor('#111').text(String(txt || '—'), x, y, { width: colW, height: lh, lineBreak: false });
  };
  const row = (i, setters) => setters.forEach(fn => fn(yStart + i*lh));

  // linha 0
  row(0, [
    y => { label('Empresa:', x0, y); value(t.empresa, x0, y); },
    y => { label('Horário:', x1, y); value(t.horaPartida, x1, y); },
    y => { label('Classe:', x2, y);  value(t.classe, x2, y); }
  ]);
  // linha 1
  row(1, [
    y => { label('Origem:', x0, y);  value(t.origem, x0, y); },
    y => { label('Poltrona:', x1, y); value(t.poltrona, x1, y); },
    y => { label('Bilhete:', x2, y); value(t.numPassagem, x2, y); }
  ]);
  // linha 2
  row(2, [
    y => { label('Destino:', x0, y); value(t.destino, x0, y); },
    y => { label('Linha:', x1, y);    value(t.nomeLinha, x1, y); },
    y => { label('Série:', x2, y);    value(t.serie, x2, y); }
  ]);
  // linha 3
  row(3, [
    y => { label('Data:', x0, y);    value(t.dataViagem, x0, y); },
    y => { label('Prefixo:', x1, y); value(t.codigoLinha, x1, y); }
  ]);

  // separador exatamente após o grid
  const yAfterGrid = yStart + 4*lh + 6;
  HR(yAfterGrid);
  doc.y = yAfterGrid + 6;

  // ===== Passageiro (1 linha): nome à esquerda, documento à direita
  const yPD = doc.y;
  doc.font('Helvetica').fontSize(8).fillColor('#555').text('Passageiro:', x0, yPD);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#111').text(String(t.nomeCliente || '—'), x0 + 60, yPD, { width: (w/2) - 70, lineBreak: false });

  doc.font('Helvetica').fontSize(8).fillColor('#555').text('Documento:', x2 - 40, yPD);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#111').text(String(t.documento || '—'), x2 + 30, yPD, { width: colW, lineBreak: false });

  y = Math.max(yPD + lh, doc.y) + 4;
  HR(y);
  doc.y = y + 6;

  // ===== Valores (sem Pedágio); Valor Pago com destaque; linha após o MAIOR y
  const leftX = x0, rightX = x1 + 10;
  const vLabel = (txt, x, y) => doc.font('Helvetica').fontSize(8).fillColor('#555').text(txt, x, y);
  const vValue = (txt, x, y, big=false) => doc.font('Helvetica-Bold').fontSize(big ? 12 : 10).fillColor('#000').text(String(txt || '—'), x, y);

  const yL0 = doc.y;
  vLabel('Tarifa:', leftX, yL0);            vValue(t.tarifa, leftX, doc.y);
  const yL1 = doc.y; vLabel('Taxa De Embarque:', leftX, yL1); vValue(t.taxaEmbarque, leftX, doc.y);
  const yL2 = doc.y; vLabel('Outros:', leftX, yL2);           vValue(t.outros, leftX, doc.y);

  const yR0 = yL0; vLabel('Forma De Pagamento:', rightX, yR0); vValue(t.formaPgto, rightX, doc.y);
  const yR1 = doc.y; vLabel('Valor Pago:', rightX, yR1);       vValue(t.valorTotalFmt, rightX, doc.y, true);

  const yAfterVals = Math.max(doc.y, yL2 + lh, yR1 + lh) + 6;
  HR(yAfterVals);
  doc.y = yAfterVals + 6;

  // ===== QR centralizado e textos ABAIXO do QR
  const qrSize = 110;
  const qrX = centerX() - (qrSize/2);
  const qrY = doc.y;
  doc.image(qrDataURL, qrX, qrY, { fit: [qrSize, qrSize] });

  // força o cursor PARA BAIXO do QR
  const yAfterQR = qrY + qrSize + 8;
  doc.y = yAfterQR;

  // Emissão (UTC−3), URL, chave e protocolo (centralizados)
  const emissaoBR = formatEmissaoBR(t.emissaoISO, -180);
  doc.font('Helvetica').fontSize(9).fillColor('#000')
     .text(`Emissão: ${emissaoBR}`, { align:'center', width: fullW() });

  doc.font('Helvetica').fontSize(9).fillColor('#000')
     .text(t.qrUrl, { align:'center', width: fullW() });

  if (t.chaveBPe) {
    doc.font('Helvetica').fontSize(9).fillColor('#000')
       .text(t.chaveBPe, { align:'center', width: fullW() });
  }

  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(10).fillColor('#000')
     .text('Protocolo de autorização: EMITIDO EM CONTINGÊNCIA', { align:'center', width: fullW() });

  doc.end();
  await new Promise((r) => stream.on('finish', r));
  return { path: outPath, filename: baseName };
};
