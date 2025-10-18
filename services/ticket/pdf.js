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

/**
 * DA BPe:
 *  - 3 colunas com tabulação ajustada (sem sobreposição)
 *  - Linha de separação abaixo de "Data/Prefixo"
 *  - Passageiro + Documento em uma linha
 *  - Remove Pedágio
 *  - Valor Pago em destaque
 *  - QR menor e centralizado; abaixo: data/hora de emissão (-03:00), URL, chave, e protocolo (em preto)
 */
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

  const qrDataURL = await QRCode.toDataURL(t.qrUrl, { margin: 1, scale: 5 }); // menor

  const doc = new PDFDocument({
    size: 'A5',
    margins: { top: 16, left: 16, right: 16, bottom: 16 }
  });
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  const fullW = () => (doc.page.width - doc.page.margins.left - doc.page.margins.right);
  const centerX = () => (doc.page.margins.left + fullW()/2);
  const hr = () => {
    const y = doc.y + 2;
    doc.moveTo(doc.page.margins.left, y)
       .lineTo(doc.page.width - doc.page.margins.right, y)
       .strokeColor('#d0d0d0').lineWidth(0.6).stroke();
    doc.moveDown(0.4);
  };
  const L = (s) => doc.font('Helvetica').fontSize(8).fillColor('#555').text(s, { continued:false });
  const V = (s,b=true) => doc.font(b ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor('#111').text(s, { continued:false });

  // ===== Cabeçalho com imagem (opcional) =====
  try {
    const headerPath = path.join(__dirname, '..', '..', 'sitevendas', 'img', 'bpe-header.png');
    if (fs.existsSync(headerPath)) {
      doc.image(headerPath, doc.page.margins.left, doc.y, { fit: [fullW(), 44] });
      doc.moveDown(0.2);
    }
  } catch(_) {}

  // Título
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#000')
     .text('DABP-e - Documento Auxiliar do Bilhete de Passagem Eletrônico', { align: 'center' });
  doc.moveDown(0.4);
  hr();

  // ===== Empresa (centralizado)
  doc.font('Helvetica-Bold').fontSize(11).text(t.empresa || 'TURIN TRANSPORTES LTDA', { align:'center' });
  doc.font('Helvetica').fontSize(9);
  const line2 = [];
  if (t.cnpjEmpresa) line2.push(`CNPJ: ${t.cnpjEmpresa}`);
  if (t.ie) line2.push(`IE.: ${t.ie}`);
  doc.text(line2.join('    '), { align:'center' });

  const line3 = [];
  if (t.enderecoEmpresa) line3.push(`${t.enderecoEmpresa}`);
  if (t.bairroEmpresa) line3.push(`- ${t.bairroEmpresa}`);
  doc.text(line3.join(' '), { align:'center' });

  const line4 = [];
  if (t.cidadeEmpresa) line4.push(t.cidadeEmpresa);
  if (t.telefoneEmpresa) line4.push(`Telefone: ${t.telefoneEmpresa}`);
  doc.text(line4.join('  -  '), { align:'center' });

  doc.moveDown(0.4);
  hr();

  // ===== GRID PRINCIPAL (3 colunas com tabulação à direita)
  const w = fullW();
  // colunas mais à direita pra evitar sobreposição
  const colW = w / 3;
  const x0 = doc.page.margins.left;
  const x1 = x0 + colW + 8;    // deslocadas
  const x2 = x1 + colW + 8;

  const yStart = doc.y;
  // Coluna 1
  doc.text('', x0, yStart);
  L('Empresa:'); V(t.empresa || '—');
  L('Origem:');  V(t.origem || '—');
  L('Destino:'); V(t.destino || '—');
  L('Data:');    V(t.dataViagem || '—');

  // Coluna 2
  doc.text('', x1, yStart);
  L('Horário:');  V(t.horaPartida || '—');
  L('Poltrona:'); V(t.poltrona || '—');
  L('Linha:');    V(t.nomeLinha || '—');        // descrição
  L('Prefixo:');  V(t.codigoLinha || '—');      // código

  // Coluna 3
  doc.text('', x2, yStart);
  L('Classe:');   V(t.classe || '—');
  L('Bilhete:');  V(t.numPassagem || '—');
  L('Série:');    V(t.serie || '—');

  // linha de separação logo após Data/Prefixo
  doc.moveDown(0.2);
  hr();

  // ===== Passageiro + Documento em 1 linha
  doc.font('Helvetica').fontSize(8).fillColor('#555').text('Passageiro:', { continued: true });
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#111').text(` ${t.nomeCliente || '—'}   `, { continued: true });
  doc.font('Helvetica').fontSize(8).fillColor('#555').text('Documento:', { continued: true });
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#111').text(` ${t.documento || '—'}`);
  doc.moveDown(0.2);
  hr();

  // ===== Valores (sem Pedágio) — valor pago em destaque
  const yVals = doc.y;
  const half = (w/2) - 10;

  const drawKV = (k, v, x, y, big=false) => {
    doc.font('Helvetica').fontSize(8).fillColor('#555').text(k, x, y);
    doc.font('Helvetica-Bold').fontSize(big ? 12 : 10).fillColor('#000').text(v, x, doc.y);
  };

  drawKV('Tarifa:', t.tarifa || 'R$ 0,00', x0, yVals);
  // remove pedágio
  drawKV('Taxa De Embarque:', t.taxaEmbarque || 'R$ 0,00', x0, doc.y);
  drawKV('Outros:', t.outros || 'R$ 0,00', x0, doc.y);

  const xR = x0 + half + 20;
  drawKV('Forma De Pagamento:', t.formaPgto || '—', xR, yVals);
  drawKV('Valor Pago:', t.valorTotalFmt || '—', xR, doc.y, true); // destaque

  doc.moveDown(0.4);
  hr();

  // ===== QR centralizado + informações
  const qrSize = 110; // menor
  const qrX = centerX() - (qrSize/2);
  const qrY = doc.y + 4;
  doc.image(qrDataURL, qrX, qrY, { fit: [qrSize, qrSize] });

  const yAfter = qrY + qrSize + 8;

  // Data/hora de emissão (-03:00)
  const emissaoBR = formatEmissaoBR(t.emissaoISO, -180);
  doc.font('Helvetica').fontSize(9).fillColor('#000').text(`Emissão: ${emissaoBR}`, { align:'center' });

  // URL (mesma do QR) e chave
  doc.font('Helvetica').fontSize(9).fillColor('#000').text(t.qrUrl, { align: 'center' });
  if (t.chaveBPe) doc.font('Helvetica').fontSize(9).fillColor('#000').text(t.chaveBPe, { align:'center' });

  doc.moveDown(0.4);
  // Protocolo (preto, sem destaque extra)
  doc.font('Helvetica').fontSize(10).fillColor('#000')
     .text('Protocolo de autorização: EMITIDO EM CONTINGÊNCIA', { align:'center' });

  doc.end();
  await new Promise((r) => stream.on('finish', r));
  return { path: outPath, filename: baseName };
};
