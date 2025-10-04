const express = require('express');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from the sitevendas directory
app.use(express.static('sitevendas'));
app.use(express.json());

/**
 * Proxy endpoint to log in to Praxio and list departures.
 * The frontend should POST an object with keys:
 *   origemId: number
 *   destinoId: number
 *   data: string (YYYY-MM-DD)
 *
 * This endpoint performs the login using credentials stored in
 * environment variables and then calls the Praxio Partidas API.
 */
app.post('/api/partidas', async (req, res) => {
  try {
    const { origemId, destinoId, data } = req.body;

    // Build login payload using environment variables
    const loginBody = {
      Nome: process.env.PRAXIO_USER,
      Senha: process.env.PRAXIO_PASS,
      Sistema: 'WINVR.EXE',
      TipoBD: 0,
      Empresa: process.env.PRAXIO_EMP,
      Cliente: process.env.PRAXIO_CLIENT,
      TipoAplicacao: 0,
    };

    // Authenticate and obtain a session ID
    const loginResp = await fetch(
      'https://oci-parceiros2.praxioluna.com.br/Autumn/Login/efetualogin',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginBody),
      },
    );
    const loginData = await loginResp.json();
    const idSessaoOp = loginData.IdSessaoOp;
    // Some accounts return establishment info in EstabelecimentoXml
    const idEstabelecimento =
      (loginData.EstabelecimentoXml &&
        loginData.EstabelecimentoXml.IDEstabelecimento) ||
      loginData.IDEstabelecimento ||
      1;

    // Build request body for Partidas API
    // To mirror the n8n payload exactly, send certain fields as strings and fix
    // IdEstabelecimento to "1" instead of using the value returned from login.
    const partidasBody = {
      IdSessaoOp: idSessaoOp,
      LocalidadeOrigem: origemId,
      LocalidadeDestino: destinoId,
      DataPartida: data,
      SugestaoPassagem: "1",
      ListarTodas: "1",
      SomenteExtra: "0",
      TempoPartida: 1,
      IdEstabelecimento: "1",
      DescontoAutomatico: 0,
    };

    const partResp = await fetch(
      'https://oci-parceiros2.praxioluna.com.br/Autumn/Partidas/Partidas',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partidasBody),
      },
    );
    const partData = await partResp.json();
    // Return only the data from Praxio; the frontend is responsible for parsing it
    res.json(partData);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao consultar partidas' });
  }
});

/**
 * Proxy endpoint to retrieve seat map for a given trip.
 * The frontend should POST an object with keys:
 *   idViagem: number
 *   idTipoVeiculo: number
 *   idLocOrigem: number
 *   idLocDestino: number
 *
 * This endpoint logs in to Praxio to obtain a session and then
 * calls the RetornaPoltronas API to fetch the seat layout.
 */
app.post('/api/poltronas', async (req, res) => {
  try {
    const { idViagem, idTipoVeiculo, idLocOrigem, idLocDestino } = req.body;

    // Authenticate again (each call must provide a session)
    const loginBody = {
      Nome: process.env.PRAXIO_USER,
      Senha: process.env.PRAXIO_PASS,
      Sistema: 'WINVR.EXE',
      TipoBD: 0,
      Empresa: process.env.PRAXIO_EMP,
      Cliente: process.env.PRAXIO_CLIENT,
      TipoAplicacao: 0,
    };
    const loginResp = await fetch(
      'https://oci-parceiros2.praxioluna.com.br/Autumn/Login/efetualogin',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginBody),
      },
    );
    const loginData = await loginResp.json();
    const idSessaoOp = loginData.IdSessaoOp;

    const seatBody = {
      IdSessaoOp: idSessaoOp,
      IdViagem: idViagem,
      IdTipoVeiculo: idTipoVeiculo,
      IdLocOrigem: idLocOrigem,
      IdLocdestino: idLocDestino,
      VerificarSugestao: 1,
    };

    const seatResp = await fetch(
      'https://oci-parceiros2.praxioluna.com.br/Autumn/Poltrona/RetornaPoltronas',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(seatBody),
      },
    );
    const seatData = await seatResp.json();
    res.json(seatData);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao consultar poltronas' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
