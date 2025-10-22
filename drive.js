// drive.js
const { google } = require('googleapis');
const { Readable } = require('stream');

function getDrive() {
  // A chave vem em JSON na env GDRIVE_SA_KEY (inteira, multiline mesmo)
  const key = JSON.parse(process.env.GDRIVE_SA_KEY || '{}');
  if (!key.client_email || !key.private_key) {
    throw new Error('GDRIVE_SA_KEY ausente ou inválida');
  }
  const auth = new google.auth.JWT(
    key.client_email,
    null,
    key.private_key,
    ['https://www.googleapis.com/auth/drive.file']
  );
  return google.drive({ version: 'v3', auth });
}

async function uploadPdfToDrive({ buffer, filename, folderId }) {
  const drive = getDrive();

  const fileMetadata = { name: filename, parents: [folderId] };
  const media = { mimeType: 'application/pdf', body: Readable.from(buffer) };

  const create = await drive.files.create({
    requestBody: fileMetadata,
    media,
    fields: 'id,name,webViewLink,webContentLink',
  });

  const fileId = create.data.id;

  // Deixa "qualquer pessoa com o link" como leitor (opcional, mas prático)
  await drive.permissions.create({
    fileId,
    requestBody: { role: 'reader', type: 'anyone' },
  });

  const get = await drive.files.get({
    fileId,
    fields: 'id,name,webViewLink,webContentLink',
  });

  return {
    id: fileId,
    name: get.data.name,
    webViewLink: get.data.webViewLink,
    webContentLink: get.data.webContentLink,
  };
}

module.exports = { uploadPdfToDrive };
