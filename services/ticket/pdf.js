const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const { sanitizeFile } = require('./utils');

exports.generateTicketPdf = async (ticket, outDir) => {
  await fs.promises.mkdir(outDir, { recursive: true });

  const baseName = [
    'bilhete',
    sanitizeFile(ticket.nomeCliente || 'cliente'),
    sanitizeFile(ticket.dataViagem || ''),
    sanitizeFile(ticket.horaPartida || ''),
    sanitizeFile(ticket.numPassagem || '')
  ].filter(Boolean).join('_') + '.pdf';

  const outPath = path.join(outDir, baseName);
  const qrDataURL = await QRCode.toDataURL(ticket.qrPayload, { margin: 1, scale: 6 });

  const doc = new PDFDocument({ size: 'A6', margins: { top: 20, left: 18, right: 18, bottom: 18 } });
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  doc.fontSize(12).font('Helvetica-Bold').text(ticket.empresa, { align: 'left' });
  if (ticket.cnpjEmpresa) doc.fontSize(9).font('Helvetica').text(`CNPJ: ${ticket.cnpjEmpresa}`);
  doc.moveDown(0.6);

  doc.fontSize(10).font('Helvetica-Bold').text(ticket.nomeLinha || `${ticket.origem} → ${ticket.destino}`);
  doc.moveDown(0.2);
  doc.font('Helvetica').text(`Origem: ${ticket.origem}`);
  doc.text(`Destino: ${ticket.destino}`);
  doc.text(`Saída: ${ticket.dataViagem} às ${ticket.horaPartida}`);
  doc.moveDown(0.3);

  doc.font('Helvetica-Bold').text(`Passageiro: ${ticket.nomeCliente}`);
  if (ticket.documento) doc.font('Helvetica').text(`Doc/CPF: ${ticket.documento}`);
  doc.text(`Poltrona: ${ticket.poltrona}`);
  doc.moveDown(0.3);

  doc.text(`Valor: ${ticket.valor}`);
  doc.text(`Nº Passagem: ${ticket.numPassagem}   Série: ${ticket.serie}`);
  if (ticket.codigoLinha) doc.text(`Cód. Linha: ${ticket.codigoLinha}`);
  if (ticket.agencia) doc.text(`Agência: ${ticket.agencia}`);
  if (ticket.formaPgto) doc.text(`Forma de pagamento: ${ticket.formaPgto}`);

  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').text(`BPe: ${ticket.bpeNumero || ticket.chaveBPe?.slice(-12) || '—'}`);

  doc.moveDown(0.4);
  const qrSize = 110;
  const qrX = doc.page.width - qrSize - 18;
  const qrY = doc.y;
  doc.image(qrDataURL, qrX, qrY, { fit: [qrSize, qrSize] });

  doc.fontSize(8).font('Helvetica').text(
    'Guarde este bilhete. Apresente no embarque. Sujeito às regras de transporte vigentes.',
    18, qrY + qrSize + 6, { width: doc.page.width - 36 }
  );

  doc.moveDown(0.6);
  doc.fontSize(8).fillColor('#666').text('© Turin Transportes – www.turintransportes.com', { align: 'center' });

  doc.end();
  await new Promise((r) => stream.on('finish', r));
  return { path: outPath, filename: baseName };
};
