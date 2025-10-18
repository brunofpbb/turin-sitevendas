const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const { sanitizeFile } = require('./utils');

/**
 * Gera um PDF no estilo DA BPe com:
 * - Cabeçalho com logo (opcional) + dados da TURIN
 * - Dados da empresa centralizado
 * - "Linha" = descrição; "Prefixo" = código
 * - QR centralizado usando a MESMA URL impressa
 * - Abaixo do QR: URL, CHAVE e "Protocolo de autorização: EMITIDO EM CONTINGÊNCIA"
 */
exports.generateTicketPdf = async (t, outDir) => {
  await fs.promises.mkdir(outDir, { recursive: true });

  const baseName =
    [
      'bpe',
      sanitizeFile(t.nomeCliente || 'passageiro'),
      sanitizeFile((t.dataViagem || '').replaceAll('/','')),
      sanitizeFile((t.horaPartida || '').replace(':','')),
      sanitizeFile(t.numPassagem || '')
    ]
      .filter(Boolean)
      .join('_') + '.pdf';

  const outPath = path.join(outDir, baseName);

  // QR a partir da URL oficial (mesma que vamos imprimir)
  const qrDataURL = await QRCode.toDataURL(t.qrUrl, { margin: 1, scale: 6 });

  // Documento A5 para caber o layout confortável
  const doc = new PDFDocument({
    size: 'A5',
    margins: { top: 16, left: 16, right: 16, bottom: 16 }
  });
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  // helpers
  const fullWidth = () => (doc.page.width - doc.page.margins.left - doc.page.margins.right);
  const centerX = () => (doc.page.margins.left + fullWidth()/2);
  const hr = () => {
    const y = doc.y + 2;
    doc.moveTo(doc.page.margins.left, y)
       .lineTo(doc.page.width - doc.page.margins.right, y)
       .strokeColor('#d0d0d0').lineWidth(0.6).stroke();
    doc.moveDown(0.4);
  };
  const L = (s) => doc.font('Helvetica').fontSize(8).fillColor('#555').text(s);
  const V = (s,b=true) => doc.font(b ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor('#111').text(s);

  // ====== CABEÇALHO (logo + razão social)
  // Tente usar arquivo de cabeçalho se existir (coloque a imagem em "sitevendas/img/bpe-header.png")
  try {
    const headerPath = path.join(__dirname, '..', '..', 'sitevendas', 'img', 'bpe-header.png');
    if (fs.existsSync(headerPath)) {
      const w = fullWidth();
      const h = 44; // altura fixa (imagem deve ser larga)
      doc.image(headerPath, doc.page.margins.left, doc.y, { fit: [w, h] });
      doc.moveDown(0.2);
    }
  } catch (_) {}

  // Título (backup caso não tenha imagem)
  if (doc.y < 24) doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#000')
     .text('DABP-e - Documento Auxiliar do Bilhete de Passagem Eletrônico', { align: 'center' });
  doc.moveDown(0.4);
  hr();

  // ====== BLOCO EMPRESA (centralizado)
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#000')
     .text(t.empresa || 'TURIN TRANSPORTES LTDA', { align: 'center' });
  doc.font('Helvetica').fontSize(9).fillColor('#000');
  const linha2 = [];
  if (t.cnpjEmpresa) linha2.push(`CNPJ: ${t.cnpjEmpresa}`);
  if (t.ie) linha2.push(`IE.: ${t.ie}`);
  doc.text(linha2.join('    '), { align: 'center' });

  const linha3 = [];
  if (t.enderecoEmpresa) linha3.push(`${t.enderecoEmpresa}`);
  if (t.bairroEmpresa) linha3.push(`- ${t.bairroEmpresa}`);
  doc.text(linha3.join(' '), { align: 'center' });

  const linha4 = [];
  if (t.cidadeEmpresa) linha4.push(t.cidadeEmpresa);
  if (t.telefoneEmpresa) linha4.push(`Telefone: ${t.telefoneEmpresa}`);
  doc.text(linha4.join('  -  '), { align: 'center' });
  doc.moveDown(0.4);
  hr();

  // ====== GRID PRINCIPAL
  const w = fullWidth();
  const colW = w / 3;
  const x0 = doc.page.margins.left;

  const yStart = doc.y;
  // Coluna 1
  doc.text('', x0, yStart);
  L('Empresa:'); V(t.empresa || '—');
  L('Origem:');  V(t.origem || '—');
  L('Destino:'); V(t.destino || '—');
  L('Data:');    V(t.dataViagem || '—');

  // Coluna 2
  const x1 = x0 + colW;
  doc.text('', x1, yStart);
  L('Horário:'); V(t.horaPartida || '—');
  L('Poltrona:');V(t.poltrona || '—');
  L('Linha:');   V(t.nomeLinha || '—');       // descrição
  L('Prefixo:'); V(t.codigoLinha || '—');     // código

  // Coluna 3
  const x2 = x1 + colW;
  doc.text('', x2, yStart);
  L('Classe:'); V(t.classe || '—');
  L('Bilhete:');V(t.numPassagem || '—');
  L('Série:');  V(t.serie || '—');
  if (t.localizador) { L('Localizador:'); V(t.localizador || '—'); }

  doc.moveDown(0.4);
  hr();

  // ====== PASSAGEIRO
  L('Passageiro:'); V(t.nomeCliente || '—');
  L('Documento:'); V(t.documento || '—');
  doc.moveDown(0.2);
  hr();

  // ====== VALORES (duas colunas)
  const yVals = doc.y;
  const halfW = (w / 2) - 8;

  const drawKV = (k, v, x, y) => {
    doc.font('Helvetica').fontSize(8).fillColor('#555').text(k, x, y);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#000').text(v, x, doc.y);
  };

  drawKV('Tarifa:', t.tarifa || 'R$ 0,00', x0, yVals);
  drawKV('Pedágio:', t.pedagio || 'R$ 0,00', x0, doc.y);
  drawKV('Taxa De Embarque:', t.taxaEmbarque || 'R$ 0,00', x0, doc.y);
  drawKV('Outros:', t.outros || 'R$ 0,00', x0, doc.y);

  const xR = x0 + halfW + 16;
  const yR = yVals;
  drawKV('Forma De Pagamento:', t.formaPgto || '—', xR, yR);
  drawKV('Valor Pago:', t.valorTotalFmt || '—', xR, doc.y);

  doc.moveDown(0.4);
  hr();

  // ====== QR CENTRALIZADO + TEXTOS
  const qrSize = 132;
  const qrX = centerX() - (qrSize / 2);
  const qrY = doc.y + 4;
  doc.image(qrDataURL, qrX, qrY, { fit: [qrSize, qrSize] });

  // Texto abaixo do QR: URL, CHAVE e Protocolo/Contingência
  const yAfterQR = qrY + qrSize + 8;
  doc.font('Helvetica').fontSize(9).fillColor('#000').text(t.qrUrl, { align: 'center' });
  if (t.chaveBPe) {
    doc.font('Helvetica').fontSize(9).fillColor('#000').text(t.chaveBPe, { align: 'center' });
  }
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#b00000')
     .text('Protocolo de autorização: EMITIDO EM CONTINGÊNCIA', { align: 'center' });

  // Fim
  doc.end();
  await new Promise((r) => stream.on('finish', r));
  return { path: outPath, filename: baseName };
};
