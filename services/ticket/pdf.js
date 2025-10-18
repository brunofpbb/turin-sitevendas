const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const { sanitizeFile } = require('./utils');

/**
 * Gera um PDF no estilo do DA BPe (Documento Auxiliar), sem o código de barras vertical.
 * Usa o QR oficial da SEFAZ: https://bpe.fazenda.mg.gov.br/portalbpe/sistema/qrcode.xhtml?chBPe=<chave>&tpAmb=1
 * Mostra “EMITIDO EM CONTINGÊNCIA” no lugar do protocolo.
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

  // QR a partir da URL oficial
  const qrDataURL = await QRCode.toDataURL(t.qrUrl, { margin: 1, scale: 6 });

  // Documento em A5 retrato para caber bastante informação (meio de A4)
  const doc = new PDFDocument({
    size: 'A5',
    margins: { top: 18, left: 18, right: 18, bottom: 18 }
  });
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  // helpers
  const line = () => doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor('#d0d0d0').lineWidth(0.6).stroke();
  const label = (s) => doc.font('Helvetica').fontSize(8).fillColor('#444').text(s, { continued: false });
  const text  = (s, b=false) => { doc.font(b ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor('#111').text(s); };
  const kv = (k,v) => { label(k); text(v); };

  // borda geral
  doc.roundedRect(12, 12, doc.page.width-24, doc.page.height-24, 6).strokeColor('#c9c9c9').lineWidth(0.8).stroke();

  // título
  doc.moveDown(0.3);
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#333').text('Via Do Passageiro', { align: 'center' });
  doc.moveDown(0.25);
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#000')
     .text('DOCUMENTO AUXILIAR DE BILHETE DE PASSAGEM ELETRÔNICO', { align: 'center' });

  doc.moveDown(0.6);
  line();
  doc.moveDown(0.4);

  // Bloco Emitentes / Empresa
  const c1x = doc.x, c1w = (doc.page.width - doc.page.margins.left - doc.page.margins.right);
  // Coluna esquerda: Sindicato/Consórcio (se houver). Como não temos, mostramos a emitente principal apenas.
  doc.fontSize(9).font('Helvetica-Bold').text(t.empresa || 'Emitente');
  doc.font('Helvetica').fontSize(8).fillColor('#333');
  if (t.cnpjEmpresa) doc.text(`CNPJ: ${t.cnpjEmpresa}`);
  if (t.enderecoEmpresa) doc.text(t.enderecoEmpresa);
  if (t.cidadeEmpresa) doc.text(t.cidadeEmpresa);
  if (t.im) doc.text(`IM: ${t.im}`);
  if (t.ie) doc.text(`IE: ${t.ie}`);
  if (t.mensagem) doc.text(`SAC: ${t.mensagem.replace(/^SAC[:\s]*/i,'')}`);

  doc.fillColor('#000');
  doc.moveDown(0.3);
  line();
  doc.moveDown(0.3);

  // Grid resumão (3 colunas)
  const x0 = doc.x, w = c1w;
  const col = (i) => x0 + (i * (w/3));

  doc.font('Helvetica-Bold').fontSize(10).text(`Empresa: ${t.empresa}`, x0, doc.y, { width: w });
  doc.moveDown(0.2);

  const yGridTop = doc.y;

  // col 1
  doc.fontSize(8).font('Helvetica').fillColor('#444');
  doc.text('Origem:', col(0), doc.y, { continued: true });  doc.font('Helvetica-Bold').fillColor('#000').text(` ${t.origem}`);
  doc.font('Helvetica').fillColor('#444').text('Destino:', col(0), doc.y, { continued: true }); doc.font('Helvetica-Bold').fillColor('#000').text(` ${t.destino}`);
  doc.font('Helvetica').fillColor('#444').text('Data:',   col(0), doc.y, { continued: true });  doc.font('Helvetica-Bold').fillColor('#000').text(` ${t.dataViagem || '—'}`);

  // col 2
  doc.font('Helvetica').fillColor('#444').text('Horário:', col(1), yGridTop, { continued: true });  doc.font('Helvetica-Bold').fillColor('#000').text(` ${t.horaPartida || '—'}`);
  doc.font('Helvetica').fillColor('#444').text('Poltrona:', col(1), doc.y, { continued: true });    doc.font('Helvetica-Bold').fillColor('#000').text(` ${t.poltrona || '—'}`);
  doc.font('Helvetica').fillColor('#444').text('Linha:', col(1), doc.y, { continued: true });       doc.font('Helvetica-Bold').fillColor('#000').text(` ${t.codigoLinha || '—'}`);

  // col 3
  const classeTipo = [t.classe, t.tipo].filter(Boolean).join(' • ');
  doc.font('Helvetica').fillColor('#444').text('Classe:', col(2), yGridTop, { continued: true });    doc.font('Helvetica-Bold').fillColor('#000').text(` ${classeTipo || '—'}`);
  doc.font('Helvetica').fillColor('#444').text('Bilhete:', col(2), doc.y, { continued: true });      doc.font('Helvetica-Bold').fillColor('#000').text(` ${t.numPassagem || '—'}`);
  doc.font('Helvetica').fillColor('#444').text('Série:', col(2), doc.y, { continued: true });        doc.font('Helvetica-Bold').fillColor('#000').text(` ${t.serie || '—'}`);

  doc.moveDown(0.4);
  line();
  doc.moveDown(0.3);

  // Passageiro
  doc.font('Helvetica').fontSize(8).fillColor('#444').text('Passageiro:', x0, doc.y, { continued: true });
  doc.font('Helvetica-Bold').fillColor('#000').fontSize(10).text(` ${t.nomeCliente || '—'}`);
  doc.font('Helvetica').fontSize(8).fillColor('#444').text('Documento:', x0, doc.y, { continued: true });
  doc.font('Helvetica-Bold').fillColor('#000').fontSize(10).text(` ${t.documento || '—'}`);

  doc.moveDown(0.2);
  line();
  doc.moveDown(0.3);

  // Valores
  const yVals = doc.y;
  const boxW = (w/2) - 6;

  const drawKV = (k, v, x, y) => {
    doc.font('Helvetica').fontSize(8).fillColor('#444').text(k, x, y);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#000').text(v, x, doc.y);
  };

  drawKV('Tarifa:',      t.tarifa || 'R$ 0,00', x0, yVals);
  drawKV('Pedágio:',     t.pedagio || 'R$ 0,00', x0, doc.y);
  drawKV('Taxa De Embarque:', t.taxaEmbarque || 'R$ 0,00', x0, doc.y);
  drawKV('Outros:',      t.outros || 'R$ 0,00', x0, doc.y);

  // Coluna direita (forma pgto/total)
  const xRight = x0 + boxW + 12;
  drawKV('Forma De Pagamento:', t.formaPgto || '—', xRight, yVals);
  drawKV('Valor Pago:', t.valorTotalFmt || '—', xRight, doc.y);

  doc.moveDown(0.4);
  line();
  doc.moveDown(0.2);

  // BPe + Série + QR
  const yQrTop = doc.y + 4;
  const qrSize = 130;
  const qrX = doc.page.width - doc.page.margins.right - qrSize;

  doc.font('Helvetica').fontSize(9).fillColor('#000')
    .text(`BPe-nº: ${t.bpeNumeroCurto || (t.chaveBPe ? t.chaveBPe.slice(-12) : '—')}`, x0, yQrTop);
  doc.font('Helvetica').fontSize(9).fillColor('#000')
    .text(`Série: ${t.serie || '—'}`, x0 + 130, yQrTop);

  // “EMITIDO EM CONTINGÊNCIA”
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#b00000')
    .text('EMITIDO EM CONTINGÊNCIA', x0, yQrTop + 16);

  // QR
  doc.image(qrDataURL, qrX, yQrTop, { fit: [qrSize, qrSize] });

  // Link/URL do QR
  doc.font('Helvetica').fontSize(8).fillColor('#000');
  doc.text('Consulte online pela chave de acesso em:', x0, yQrTop + qrSize + 6);
  doc.font('Helvetica').fontSize(8).fillColor('#17457a')
     .text(t.urlQrBPe, { link: t.qrUrl, underline: false });
  if (t.chaveBPe) {
    doc.font('Helvetica').fontSize(8).fillColor('#000')
       .text(t.chaveBPe);
  }

  doc.moveDown(0.8);
  // Tributos (se tiver base e aliquotas; se não, deixa texto padrão)
  doc.font('Helvetica').fontSize(8).fillColor('#444')
     .text('Tributos Totais Incidentes (Lei Federal 12.741/2012): informe aproximado conforme regras vigentes.');

  doc.end();
  await new Promise((r) => stream.on('finish', r));
  return { path: outPath, filename: baseName };
};
