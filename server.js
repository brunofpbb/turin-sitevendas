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
 */
app.post('/api/partidas', async (req, res) => {
  try {
    const { origemId, destinoId, data } = req.body;
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
    const idEstabelecimento =
      (loginData.EstabelecimentoXml &&
        loginData.EstabelecimentoXml.IDEstabelecimento) ||
      loginData.IDEstabelecimento ||
      1;
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
    res.json(partData);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao consultar partidas' });
  }
});

/**
 * Proxy endpoint to retrieve seat map for a given trip.
 * Expects: idViagem, idTipoVeiculo, idLocOrigem, idLocDestino.
 */
app.post('/api/poltronas', async (req, res) => {
  try {
    const { idViagem, idTipoVeiculo, idLocOrigem, idLocDestino } = req.body;
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
