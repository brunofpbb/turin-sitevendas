// main.js — sidebar fixa + card central dinâmico + integração seats.js com coletor
document.addEventListener('DOMContentLoaded', () => {
  updateUserNav();

  // ===== Localidades (lista usada no autocomplete)
  const localities = [
    { id: 2,  descricao: 'Ouro Branco' },
    { id: 6,  descricao: 'Ouro Preto E/S' },
    { id: 24, descricao: 'Mariana' },
    { id: 23, descricao: 'Antonio Pereira – Ouro Preto E/S' },
    { id: 21, descricao: 'Mina Alegria' },
    { id: 20, descricao: 'Catas Altas E/S - Rua Felicio Alve' },
    { id: 19, descricao: 'Santa Bárbara E/S' },
    { id: 22, descricao: 'Cocais-Barão de Cocais' },
    { id: 26, descricao: 'Barão de Cocais E/S' },
    { id: 17, descricao: 'BR381/BR129–São Goncalo do R' },
    { id: 16, descricao: 'Joao Monlevade - Graal 5 Estrela' },
    { id: 28, descricao: 'BR381/AC.Nova Era–Nova Era' },
    { id: 15, descricao: 'Timoteo' },
    { id: 14, descricao: 'Coronel Fabriciano' },
    { id: 12, descricao: 'Ipatinga' }
  ];

  // ===== Elementos
  const $ = (q) => document.querySelector(q);
  const originInput = $('#origin');
  const destInput   = $('#destination');
  const dateInput   = $('#date');
  const retInput    = $('#return-date');
  const dlOrigin = $('#origin-suggestions');
  const dlDest   = $('#destination-suggestions');
  const content  = $('#content-root');

  // ===== Central começa vazio
  clearCentral();

  // ===== Sugestões (datalist com filtro ao digitar – começa com todas)
  function fillAll(dl){
    dl.innerHTML = '';
    localities.forEach(l => {
      const o = document.createElement('option'); o.value = l.descricao; dl.appendChild(o);
    });
  }
  function updateSuggestions(input, dl){
    const s = input.value.toLowerCase();
    dl.innerHTML = '';
    const list = s ? localities.filter(l => l.descricao.toLowerCase().includes(s)) : localities;
    list.forEach(l => {
      const o = document.createElement('option'); o.value = l.descricao; dl.appendChild(o);
    });
  }
  fillAll(dlOrigin); fillAll(dlDest);
  originInput.addEventListener('input', ()=> updateSuggestions(originInput, dlOrigin));
  destInput.addEventListener('input',   ()=> updateSuggestions(destInput,   dlDest));

  // ===== Datas mínimas
  [dateInput, retInput].forEach(inp=>{
    const d=new Date(), yyyy=d.getFullYear(), mm=String(d.getMonth()+1).padStart(2,'0'), dd=String(d.getDate()).padStart(2,'0');
    inp.min = `${yyyy}-${mm}-${dd}`;
  });

  // ===== Estado
  const state = { leg:'IDA', search:null, searchReturn:null, selected:[] };

  // ===== Submit (BUSCA)
  $('#search-form').addEventListener('submit', (e)=>{
    e.preventDefault();

    const originName = originInput.value.trim();
    const destName   = destInput.value.trim();
    const date       = dateInput.value;

    if (!originName || !destName || !date){
      alert('Preencha origem, destino e data da ida.');
      return;
    }

    const o = localities.find(l => l.descricao.toLowerCase() === originName.toLowerCase());
    const d = localities.find(l => l.descricao.toLowerCase() === destName.toLowerCase());
    if (!o || !d){
      alert('Origem/Destino inválidos. Selecione uma opção sugerida.');
      return;
    }

    state.leg = 'IDA';
    state.selected = [];
    state.search = { originId:o.id, originName:o.descricao, destinationId:d.id, destinationName:d.descricao, date };
    state.searchReturn = retInput.value
      ? { originId:d.id, originName:d.descricao, destinationId:o.id, destinationName:o.descricao, date: retInput.value }
      : null;

    // lista de IDA
    renderList(state.search, 'Viagens disponíveis (ida)', (schedule)=>{
      // guarda o horário escolhido
      state.selected = state.selected.filter(s => s.leg !== 'IDA');
      state.selected.push({ leg:'IDA', schedule });

      // abre poltronas da IDA
      renderSeatsPanel(schedule, 'Escolha suas poltronas (ida)', ()=>{
        // voltar pra lista da ida
        renderList(state.search, 'Viagens disponíveis (ida)', onSelectIda);
      });

      function onSelectIda(s2){
        state.selected = state.selected.filter(s => s.leg !== 'IDA');
        state.selected.push({ leg:'IDA', schedule:s2 });
        renderSeatsPanel(s2, 'Escolha suas poltronas (ida)', ()=> renderList(state.search, 'Viagens disponíveis (ida)', onSelectIda));
      }
    });
  });

  // ===== Render lista de horários
  function renderList(params, legend, onSelect){
    content.innerHTML = `
      <h2 class="step-title">${legend}</h2>
      <div id="schedule-list"></div>
      <div id="no-results" class="mute"></div>
    `;
    const list   = $('#schedule-list');
    const status = $('#no-results');
    status.textContent = 'Buscando viagens disponíveis...';

    fetch('/api/partidas', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({
        origemId:  params.originId,
        destinoId: params.destinationId,
        data:      params.date
      })
    })
    .then(r=>r.json())
    .then(data=>{
      status.textContent = '';
      list.innerHTML = '';

      let linhas = [];
      if (data && Array.isArray(data.ListaPartidas)) {
        linhas = data.ListaPartidas;
      } else if (data && data.PartidasXmlRetorno && data.PartidasXmlRetorno.Linhas) {
        const raw = data.PartidasXmlRetorno.Linhas;
        if (Array.isArray(raw)) linhas = raw;
        else if (Array.isArray(raw.Linha)) linhas = raw.Linha;
      }

      if (!linhas || !linhas.length){
        status.textContent = 'Nenhuma viagem encontrada para os critérios informados.';
        return;
      }

      const fmtHora=(h)=>{
        if (!h) return '';
        if (typeof h!=='string') return h;
        if (h.includes(':')) return h;
        if (h.length===4) return h.slice(0,2)+':'+h.slice(2);
        return h;
      };

      linhas.forEach(linha=>{
        let saida = linha.HorarioPartida || linha.HoraPartida || '';
        if (!saida && linha.ViagemTFO) {
          saida = linha.ViagemTFO.HorarioPartida || linha.ViagemTFO.HoraPartida ||
                  (linha.ViagemTFO.DataHoraInicio || linha.ViagemTFO.DataHoraEmbarque || '').split('T')[1]?.substring(0,5) || '';
        }
        if (!saida && typeof linha.DadosViagem === 'string') {
          const p = linha.DadosViagem.split(' - ');
          if (p.length>0) saida = p[0].trim();
        }
        saida = fmtHora(saida);

        let chegadaRaw = linha.HorarioChegada || linha.HoraChegada || linha.DtaHoraChegada || '';
        if (!chegadaRaw && linha.ViagemTFO) {
          chegadaRaw = linha.ViagemTFO.DtaHoraChegada || linha.ViagemTFO.DataHoraChegada || '';
        }
        let chegada = '';
        if (chegadaRaw) {
          if (typeof chegadaRaw==='string' && chegadaRaw.includes('T')) chegada = chegadaRaw.split('T')[1].substring(0,5);
          else chegada = fmtHora(chegadaRaw);
        }

        let tempo = linha.TempoViagem || linha.Duracao || linha.DuracaoViagem || '';
        if (!tempo && linha.ViagemTFO) tempo = linha.ViagemTFO.DuracaoViagem || linha.ViagemTFO.TempoViagem || '';

        const tarifaRaw =
          linha.Tarifa ?? linha.ValorTarifa ?? linha.VlTarifa ?? linha.VlTarifaAnterior ?? linha.ValorMaiorDesconto ?? 0;

        const idViagem      = linha.IdViagem || linha.CodViagem || 0;
        const idTipoVeiculo = linha.IdTipoVeiculo || linha.TipoVeiculo || linha.IdTipoOnibus || 0;
        const disponiveis   = linha.PoltronasDisponiveis || (linha.ViagemTFO && linha.ViagemTFO.PoltronasDisponiveis) || '';
        const tipoHorario   = linha.TipoHorario || (linha.ViagemTFO && linha.ViagemTFO.TipoHorario) || '';
        const icons         = tipoHorario && tipoHorario.toLowerCase().includes('execut') ? '❄️📶♿' : '';

        const card = document.createElement('div'); card.className='schedule-card';
        const header = document.createElement('div'); header.className='schedule-header';
        header.innerHTML = `
          <div><b>Saída:</b> ${saida || '00:00'}</div>
          <div><b>Chegada:</b> ${chegada || '--'}</div>
          <div><b>Tempo:</b> ${tempo || '--'}</div>
          <div><b>R$ ${isNaN(parseFloat(tarifaRaw)) ? '0,00' : parseFloat(tarifaRaw).toFixed(2)}</b></div>
        `;
        const body = document.createElement('div'); body.className='schedule-body';
        const parts=[];
        if (disponiveis) parts.push(`<div><b>Poltronas Disponíveis:</b> ${disponiveis} 💺</div>`);
        if (tipoHorario || icons) parts.push(`<div>${(tipoHorario||'')+' '+icons}</div>`);
        body.innerHTML = parts.join('');

        const actions = document.createElement('div'); actions.className='schedule-actions'; actions.style.gridRow='1 / -1';
        const btn = document.createElement('button'); btn.className='select-btn'; btn.textContent='Selecionar';
        btn.addEventListener('click', ()=>{
          const schedule = {
            idViagem,
            idTipoVeiculo,
            originId: params.originId,
            destinationId: params.destinationId,
            originName: params.originName,
            destinationName: params.destinationName,
            date: params.date,
            departureTime: saida,
            arrivalTime: chegada,
            travelTime: tempo,
            price: tarifaRaw,
            seatsAvailable: disponiveis || null,
            serviceType: tipoHorario || null
          };
          onSelect && onSelect(schedule);
        });
        actions.appendChild(btn);

        header.style.gridColumn='1 / 2'; actions.style.gridColumn='2 / 3'; body.style.gridColumn='1 / 2';
        card.appendChild(header); card.appendChild(actions); card.appendChild(body);
        list.appendChild(card);
      });
    })
    .catch(err=>{
      console.error(err);
      status.textContent = 'Falha ao buscar viagens. Tente novamente mais tarde.';
    });
  }

  // ===== Painel de poltronas (usa o coletor do seats.js)
  function renderSeatsPanel(schedule, legend, onBack){
    content.innerHTML = `
      <h2 class="step-title">${legend}</h2>
      <div id="seats-container"></div>
      <div class="actions">
        <button id="btn-back" class="btn btn-ghost">Voltar</button>
        <button id="btn-confirm" class="btn btn-primary">Confirmar seleção</button>
      </div>
    `;
    const sc = $('#seats-container');
    const back = $('#btn-back');
    const confirm = $('#btn-confirm');
    back.onclick = onBack;

    if (typeof window.renderSeats !== 'function'){
      sc.innerHTML = '<p class="mute">Componente de poltronas não carregado. Atualize o <code>seats.js</code> para expor <b>window.renderSeats</b>.</p>';
      return;
    }

    // desenha o mapa (o próprio seats.js mantém os dados digitados)
    window.renderSeats(sc, schedule, ()=>{});

    // confirma usando o coletor exposto pelo seats.js
    confirm.onclick = ()=>{
      const collect = sc.__sv_collect && sc.__sv_collect();
      if (!collect || !collect.ok) { alert(collect?.error || 'Selecione poltrona(s) e preencha os dados.'); return; }

      const payload = collect.payload;
      const legLabel = state.leg;
      const idx = state.selected.findIndex(s => s.leg === legLabel);
      if (idx >= 0) state.selected[idx] = { ...payload, leg: legLabel };
      else state.selected.push({ ...payload, leg: legLabel });

      // Se existe volta, passa para a volta
      if (legLabel === 'IDA' && state.searchReturn){
        state.leg = 'VOLTA';
        renderList(state.searchReturn, 'Viagens disponíveis (volta)', (schedule2)=>{
          state.selected = state.selected.filter(s => s.leg !== 'VOLTA');
          state.selected.push({ leg:'VOLTA', schedule: schedule2 });
          renderSeatsPanel(schedule2, 'Escolha suas poltronas (volta)', ()=>{
            renderList(state.searchReturn, 'Viagens disponíveis (volta)', (s2)=>{
              state.selected = state.selected.filter(s => s.leg !== 'VOLTA');
              state.selected.push({ leg:'VOLTA', schedule: s2 });
              renderSeatsPanel(s2, 'Escolha suas poltronas (volta)', ()=>renderList(state.searchReturn, 'Viagens disponíveis (volta)', ()=>{}));
            });
          });
        });
        return;
      }

      // Fim do fluxo → pagamento
      const user = JSON.parse(localStorage.getItem('user') || 'null');

      // compõe legs para salvar (ida e possivelmente volta)
      const toSave = state.selected.map(s => ({
        id: Date.now() + Math.floor(Math.random()*1000),
        schedule: s.schedule,
        seats: s.seats,
        passengers: s.passengers,
        price: (Number(String(s.schedule.price).replace(',', '.'))||0) * (s.seats?.length||0),
        date: s.schedule.date,
        paid: false
      }));

      if (!user){
        localStorage.setItem('pendingPurchase', JSON.stringify({ legs: toSave }));
        localStorage.setItem('postLoginRedirect', 'payment.html');
        location.href = 'login.html';
        return;
      }

      // limpa não pagas antigas e salva apenas as novas + pagas existentes
      const old = JSON.parse(localStorage.getItem('bookings') || '[]');
      const onlyPaid = old.filter(b => b.paid === true);
      localStorage.setItem('bookings', JSON.stringify([...onlyPaid, ...toSave]));
      localStorage.removeItem('pendingPurchase');
      location.href = 'payment.html';
    };
  }

  // ===== Util
  function clearCentral(){ content.innerHTML = ''; }
});

/* ===== Nav usuário (igual ao seu) ===== */
function updateUserNav(){
  const nav = document.getElementById('user-nav');
  if (!nav) return;
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  nav.innerHTML = '';
  if (user){
    const a = document.createElement('a'); a.href='profile.html';
    a.textContent = `Minhas viagens (${user.name || user.email})`;
    nav.appendChild(a);

    const s = document.createElement('a'); s.href='#'; s.style.marginLeft='12px'; s.textContent='Sair';
    s.addEventListener('click', ()=>{ localStorage.removeItem('user'); updateUserNav(); location.href='index.html'; });
    nav.appendChild(s);
  } else {
    const a = document.createElement('a'); a.href='login.html'; a.textContent='Entrar';
    a.addEventListener('click', ()=>{
      const href = location.href;
      const path = href.substring(href.lastIndexOf('/') + 1);
      localStorage.setItem('postLoginRedirect', path);
    });
    nav.appendChild(a);
  }
}
