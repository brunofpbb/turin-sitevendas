// services/ticket/pdf.js (rev2)
// Gera o DABP-e com layout estável (sem sobreposição) e melhor aproveitamento da folha.
// Ajustes principais nesta revisão:
// 1) Página A4 com margens confortáveis.
// 2) Grid com coordenadas fixas e largura segura, sem quebra de linha (lineBreak:false).
// 3) Títulos abaixo do QR centralizados corretamente.
// 4) Pequenos utilitários para cortar texto que excede a largura (evita escrever por cima).

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

// corta string para caber em largura 'w' no fontSize corrente, adicionando "…"
function fit(doc, text, w) {
  const ell = '…';
  let s = String(text ?? '');
  if (!s) return '';
  if (doc.widthOfString(s) <= w) return s;
  while (s.length && doc.widthOfString(s + ell) > w) {
    s = s.slice(0, -1);
  }
  return s + ell;
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

  const qrDataURL = await QRCode.toDataURL(t.qrUrl, { margin: 1, scale: 6 });

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 36, left: 36, right: 36, bottom: 48 }
  });
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  const fullW = () => (doc.page.width - doc.page.margins.left - doc.page.margins.right);
  const centerX = () => (doc.page.margins.left + fullW()/2);
  const HR = (y) => {
    doc.save()
      .moveTo(doc.page.margins.left, y)
      .lineTo(doc.page.margins.left + fullW(), y)
      .lineWidth(0.5)
      .strokeColor('#999')
      .stroke()
      .restore();
  };

  // ===== Cabeçalho opcional com imagem
  try {
    const headerPath = path.join(__dirname, '..', '..', 'sitevendas', 'img', 'bpe-header.png');
    if (fs.existsSync(headerPath)) {
      doc.image(headerPath, doc.page.margins.left, doc.y, { fit: [fullW(), 54] });
      doc.moveDown(0.4);
    }
  } catch(_) {}

  // Título
  doc.font('Helvetica-Bold').fontSize(14).fillColor('#000')
     .text('DABP-e - Documento Auxiliar do Bilhete de Passagem Eletrônico', { align: 'center', width: fullW() });

  let y = doc.y + 8;
  HR(y);
  doc.y = y + 10;

  // ===== Empresa (centralizado)
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#000')
     .text(t.empresa || 'TURIN TRANSPORTES LTDA', { align:'center', width: fullW() });
  doc.font('Helvetica').fontSize(10).fillColor('#000');

  const parts2 = [];
  if (t.cnpjEmpresa) parts2.push(`CNPJ: ${t.cnpjEmpresa}`);
  if (t.ie) parts2.push(`IE.: ${t.ie}`);
  if (t.im) parts2.push(`IM.: ${t.im}`);
  doc.text(parts2.join('    '), { align:'center', width: fullW() });

  const parts3 = [];
  if (t.enderecoEmpresa) parts3.push(`${t.enderecoEmpresa}`);
  if (t.bairroEmpresa)   parts3.push(`- ${t.bairroEmpresa}`);
  doc.text(parts3.join(' '), { align:'center', width: fullW() });

  const parts4 = [];
  if (t.cidadeEmpresa)   parts4.push(t.cidadeEmpresa);
  if (t.telefoneEmpresa) parts4.push(`Telefone: ${t.telefoneEmpresa}`);
  doc.text(parts4.join('  -  '), { align:'center', width: fullW() });

  y = doc.y + 10;
  HR(y);
  doc.y = y + 12;

  // ===== GRID SUPERIOR (3 colunas x 3 linhas) alinhado por coordenadas
  // Para evitar sobreposição, todos os valores usam lineBreak:false + corte por largura.
  const w = fullW();
  const colW = Math.floor(w / 3) - 8;   // largura segura por coluna
  const x0 = doc.page.margins.left;
  const x1 = x0 + colW + 16;            // espaçamento entre colunas
  const x2 = x1 + colW + 16;
  const yStart = doc.y;
  const lh = 18;

  const label = (txt, x, y) => {
    doc.font('Helvetica').fontSize(9).fillColor('#555')
       .text(txt, x, y, { width: colW, lineBreak: false });
  };
  const value = (txt, x, y, big=false) => {
    doc.font('Helvetica-Bold').fontSize(big ? 11 : 10).fillColor('#111');
    const fitted = fit(doc, String(txt || '—'), colW);
    doc.text(fitted, x, y, { width: colW, lineBreak: false });
  };
  const row = (i, setters) => setters.forEach(fn => fn(yStart + i*lh));

  // linha 0
  row(0, [
    y => { label('Empresa:', x0, y); value(t.empresa, x0, y, true); },
    y => { label('Horário:', x1, y); value(t.horaPartida, x1, y, true); },
    y => { label('Classe:',  x2, y); value(t.classe, x2, y, true); }
  ]);
  // linha 1
  row(1, [
    y => { label('Origem:',   x0, y); value(t.origem, x0, y); },
    y => { label('Poltrona:', x1, y); value(t.poltrona, x1, y); },
    y => { label('Bilhete:',  x2, y); value(t.numPassagem, x2, y); }
  ]);
  // linha 2
  row(2, [
    y => { label('Destino:', x0, y); value(t.destino, x0, y); },
    y => { label('Linha:',   x1, y); value(t.nomeLinha, x1, y); },
    y => { label('Série:',   x2, y); value(t.serie, x2, y); }
  ]);
  // linha 3
  row(3, [
    y => { label('Data:',    x0, y); value(t.dataViagem, x0, y); },
    y => { label('Prefixo:', x1, y); value(t.codigoLinha, x1, y); }
  ]);

  // separador exatamente após o grid
  const yAfterGrid = yStart + 4*lh + 8;
  HR(yAfterGrid);
  doc.y = yAfterGrid + 12;

  // ===== Passageiro (1 linha): nome à esquerda, documento à direita
  const yPD = doc.y;
  const half = Math.floor(w / 2) - 10;

  doc.font('Helvetica').fontSize(9).fillColor('#555').text('Passageiro:', x0, yPD, { width: 60, lineBreak:false });
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#111')
     .text(fit(doc, String(t.nomeCliente || '—'), half - 70), x0 + 60, yPD, { width: (half - 70), lineBreak: false });

  doc.font('Helvetica').fontSize(9).fillColor('#555').text('Documento:', x0 + half + 20, yPD, { width: 70, lineBreak:false });
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#111')
     .text(fit(doc, String(t.documento || '—'), half - 80), x0 + half + 20 + 70, yPD, { width: (half - 80), lineBreak:false });

  doc.y = yPD + lh + 6;

  // ===== Totais (4 colunas)
  const cW = Math.floor(w / 4) - 8;
  const cx = (i) => doc.page.margins.left + i*(cW + 12);

  const moneyBox = (labelTxt, valueTxt, i, big=false) => {
    const xx = cx(i);
    doc.font('Helvetica').fontSize(9).fillColor('#555')
       .text(labelTxt, xx, doc.y, { width: cW, lineBreak:false });
    doc.font('Helvetica-Bold').fontSize(big ? 12 : 11).fillColor('#111')
       .text(String(valueTxt || 'R$ 0,00'), xx, doc.y, { width: cW, lineBreak:false });
  };

  moneyBox('Tarifa:', t.tarifa, 0);
  moneyBox('Taxa De Embarque:', t.taxaEmbarque, 1);
  moneyBox('Outros:', t.outros, 2);
  moneyBox('Valor Pago:', t.valorTotalFmt, 3, true);

  doc.moveDown(1.2);
  HR(doc.y);
  doc.moveDown(1.0);

  // ===== QR centralizado e textos ABAIXO do QR
  const qrSize = 150;
  const qrX = centerX() - (qrSize/2);
  const qrY = doc.y;
  doc.image(qrDataURL, qrX, qrY, { fit: [qrSize, qrSize] });

  // força o cursor PARA BAIXO do QR
  const yAfterQR = qrY + qrSize + 10;
  doc.y = yAfterQR;

  // Emissão (UTC−3), URL, chave e protocolo (centralizados)
  const emissaoBR = formatEmissaoBR(t.emissaoISO, -180);
  doc.font('Helvetica').fontSize(10).fillColor('#000')
     .text(`Emissão: ${emissaoBR}`, { align:'center', width: fullW() });

  doc.font('Helvetica').fontSize(10).fillColor('#000')
     .text(t.qrUrl, { align:'center', width: fullW() });

  if (t.chaveBPe) {
    doc.font('Helvetica').fontSize(10).fillColor('#000')
       .text(t.chaveBPe, { align:'center', width: fullW() });
  }

  doc.moveDown(0.4);
  doc.font('Helvetica').fontSize(11).fillColor('#000')
     .text('Protocolo de autorização: EMITIDO EM CONTINGÊNCIA', { align:'center', width: fullW() });

  // Rodapé © sempre centralizado no fim da página
  doc.font('Helvetica').fontSize(9).fillColor('#666');
  doc.text(`© ${new Date().getFullYear()} Turin Transportes`, doc.page.margins.left, doc.page.height - doc.page.margins.bottom + 16, {
    align: 'center',
    width: fullW()
  });

  doc.end();
  await new Promise((r) => stream.on('finish', r));
  return { path: outPath, filename: baseName };
};
