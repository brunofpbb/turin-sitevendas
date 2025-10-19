// ===== BLOCO DO QR (ordem solicitada) — rev5.1
// desce ~5 linhas antes de começar
doc.moveDown(1.8);
doc.moveDown(1.8);

doc.font('Helvetica-Bold').fontSize(10).fillColor('#000')
   .text('Consulta via chave de acesso', left(), doc.y, { width: pageW(), align:'center' });

// URL oficial
doc.moveDown(0.2);
doc.font('Helvetica').fontSize(10).fillColor('#000')
   .text(t.urlConsultaAcesso || 'https://bpe.fazenda.mg.gov.br/bpe/services/BPeConsultaDFe',
     left(), doc.y, { width: pageW(), align:'center' });

// CHAVE logo abaixo da URL (sempre que houver)
if (t.chaveBPe) {
  doc.moveDown(0.1);
  doc.font('Helvetica').fontSize(9).fillColor('#000')
     .text(t.chaveBPe, left(), doc.y, { width: pageW(), align:'center' });
}

// título do bloco do QR
doc.moveDown(0.8);
doc.font('Helvetica-Bold').fontSize(10).fillColor('#000')
   .text('Consulta via leitor de QR Code', left(), doc.y, { width: pageW(), align:'center' });

// QR centralizado
const qrSize = 110;
const qrX = centerX() - qrSize/2;
const qrY = doc.y + 6;
doc.image(qrDataURL, qrX, qrY, { width: qrSize, height: qrSize });
doc.y = qrY + qrSize + 10;

// Emissão e protocolo
doc.font('Helvetica').fontSize(9).fillColor('#000')
   .text(`Emissão: ${formatEmissaoBR(t.emissaoISO, -180)}`, left(), doc.y, { width: pageW(), align:'center' });

doc.moveDown(0.2);
doc.font('Helvetica').fontSize(10).fillColor('#000')
   .text('Protocolo de autorização: EMITIDO EM CONTINGÊNCIA', left(), doc.y, { width: pageW(), align:'center' });
