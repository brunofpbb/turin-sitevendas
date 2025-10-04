fetch('/api/partidas', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    origemId: searchParams.originId,
    destinoId: searchParams.destinationId,
    data: dateIso,
  }),
})

/*
// schedules.js - exibe horários disponíveis com base na pesquisa
document.addEventListener('DOMContentLoaded', () => {
  updateUserNav();
  const params = JSON.parse(localStorage.getItem('searchParams') || 'null');
  const busList = document.getElementById('bus-list');
  const noResults = document.getElementById('no-results');
  const backBtn = document.getElementById('back-btn');
  backBtn.addEventListener('click', () => {
    window.location.href = 'index.html';
  });
  if (!params) {
    noResults.style.display = 'block';
    noResults.textContent = 'Dados de pesquisa ausentes.';
    return;
  }

  // Mostra mensagem de carregamento enquanto consulta o serviço
  noResults.style.display = 'block';
  noResults.textContent = 'Buscando viagens disponíveis...';

  // Converte a data selecionada para o formato ISO aceito pela API (YYYY-MM-DD)
  // As chamadas da Praxio podem aceitar apenas a data sem horário.
  const dateIso = params.date;

  // Função assíncrona que efetua o login e busca as partidas.
  async function fetchSchedules() {
    try {
      // Primeiro efetua login para obter a IdSessaoOp
      const loginPayload = {
        Nome: 'bot_bruno',
        Senha: '201020',
        Sistema: 'WINVR.EXE',
        TipoBD: 0,
        Empresa: 'TURIN',
        Cliente: 'TURIN_VR',
        TipoAplicacao: 0
      };
      const loginRes = await fetch('https://oci-parceiros2.praxioluna.com.br/Autumn/Login/efetualogin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginPayload)
      });
      if (!loginRes.ok) throw new Error('Erro ao efetuar login');
      const loginData = await loginRes.json();
      const idSessaoOp = loginData.IdSessaoOp;
      const idEstabelecimento = loginData.EstabelecimentoXml?.IDEstabelecimento || 1;

      // Monta o corpo da requisição de partidas
      const partidasPayload = {
        IdSessaoOp: idSessaoOp,
        LocalidadeOrigem: params.originId,
        LocalidadeDestino: params.destinationId,
        DataPartida: dateIso,
        SugestaoPassagem: 1,
        ListarTodas: 1,
        SomenteExtra: 0,
        TempoPartida: 1,
        IdEstabelecimento: idEstabelecimento,
        DescontoAutomatico: 0
      };
      const partidasRes = await fetch('https://oci-parceiros2.praxioluna.com.br/Autumn/Partidas/Partidas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partidasPayload)
      });
      if (!partidasRes.ok) throw new Error('Erro ao listar partidas');
      const partidasData = await partidasRes.json();
      const lista = partidasData.ListaPartidas || partidasData.listaPartidas || [];

      // Oculta a mensagem de carregamento
      noResults.style.display = 'none';

      if (!Array.isArray(lista) || lista.length === 0) {
        noResults.style.display = 'block';
        noResults.textContent = 'Nenhuma viagem encontrada.';
        return;
      }
      // Para cada viagem, cria um item na lista
      lista.forEach(partida => {
        const li = document.createElement('li');
        li.className = 'bus-item';
        // Extrai dados principais
        const horaPartida = partida.HoraPartida || partida.DataHoraInicio || partida.DataHoraEmbarque || '';
        const dataChegada = partida.DtaHoraChegada || partida.DataHoraChegada || '';
        const duracao = partida.TempoViagem || partida.TempoEstinado || '';
        const tarifa = partida.Tarifa || partida.ValorTarifa || partida.ValorMaiorDesconto || 0;
        li.innerHTML = `<div>
          <strong>Saída:</strong> ${horaPartida} &nbsp; | &nbsp;
          <strong>Chegada:</strong> ${dataChegada}<br>
          <span>Duração: ${duracao}</span>
          <br><span>Tarifa: R$ ${Number(tarifa).toFixed(2)}</span>
        </div>`;
        const btn = document.createElement('button');
        btn.textContent = 'Selecionar';
        btn.addEventListener('click', () => {
          // Salva a viagem selecionada no localStorage, incluindo informações necessárias para poltronas
          const schedule = {
            idViagem: partida.IdViagem || partida.IdRota,
            idTipoVeiculo: partida.IdTipoVeiculo,
            originName: params.originName,
            destinationName: params.destinationName,
            date: params.date,
            departureTime: horaPartida,
            arrivalTime: dataChegada,
            duration: duracao,
            price: tarifa,
            // salva ids de origem e destino para consulta de poltronas
            originId: params.originId,
            destinationId: params.destinationId
          };
          localStorage.setItem('selectedSchedule', JSON.stringify(schedule));
          // Armazena também o idSessaoOp e idEstabelecimento para consulta de poltronas
          localStorage.setItem('sessionInfo', JSON.stringify({ idSessaoOp, idEstabelecimento }));
          window.location.href = 'seats.html';
        });
        li.appendChild(btn);
        busList.appendChild(li);
      });
    } catch (err) {
      console.error(err);
      noResults.style.display = 'block';
      noResults.textContent = 'Falha ao buscar viagens. Tente novamente mais tarde.';
    }
  }

  // Chama a função para buscar as partidas
  fetchSchedules();
});

// As funções generateSchedules e generateSeatMap foram removidas porque os horários
// agora são buscados diretamente na API da Praxio. Caso deseje simular dados,
// recupere uma cópia anterior destas funções.

*/
