const express = require('express');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from the sitevendas directory
app.use(express.static('sitevendas'));
app.use(express.json());

// Proxy endpoint to log in to Praxio and list departures
app.post('/api/partidas', async (req, res) => {
  try {
    const { origemId, destinoId, data } = req.body;

    // Login credentials from environment variables
    const loginBody = {
      Nome: process.env.PRAXIO_USER,
      Senha: process.env.PRAXIO_PASS,
      Sistema: 'WINVR.EXE',
      TipoBD: 0,
      Empresa: process.env.PRAXIO_EMP,
      Cliente: process.env.PRAXIO_CLIENT,
      TipoAplicacao: 0
    };

    const loginResp = await fetch('https://oci-parceiros2.praxioluna.com.br/Autumn/Login/efetualogin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loginBody)
    });
    const loginData = await loginResp.json();
    const idSessaoOp = loginData.IdSessaoOp;
    const idEstabelecimento = loginData.EstabelecimentoXml?.IDEstabelecimento;

    // Body for listing departures
    const partidasBody = {
      IdSessaoOp: idSessaoOp,
      LocalidadeOrigem: origemId,
      LocalidadeDestino: destinoId,
      DataPartida: data,
      SugestaoPassagem: 1,
      ListarTodas: 1,
      SomenteExtra: 0,
      TempoPartida: 1,
      IdEstabelecimento: idEstabelecimento,
      DescontoAutomatico: 0
    };

    const partResp = await fetch('https://oci-parceiros2.praxioluna.com.br/Autumn/Partidas/Partidas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(partidasBody)
    });
    const partData = await partResp.json();
    res.json(partData);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao consultar partidas' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
