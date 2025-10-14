// Poltronas sobre a imagem bus-blank.png dentro do card da direita
export function renderSeats(container, schedule, onConfirm){
  container.innerHTML = '';

  const info = document.createElement('div');
  info.style.marginBottom = '8px';
  const origin = schedule.originName || schedule.origin || '';
  const dest   = schedule.destinationName || schedule.destino || '';
  const [y,m,d] = String(schedule.date||'').split('-');
  const dataBR = (d && m && y) ? `${d}/${m}/${y}` : (schedule.date || '');
  info.innerHTML = `<b>${origin}</b> &rarr; <b>${dest}</b> — ${dataBR} às ${schedule.departureTime || ''}`;
  container.appendChild(info);

  const wrap = document.createElement('div');
  wrap.className = 'bus-wrap';

  const bus = document.createElement('div');
  bus.className = 'bus-bg'; // usa bus-blank.png definido no CSS

  const grid = document.createElement('div');
  grid.className = 'seat-grid';
  bus.appendChild(grid);
  wrap.appendChild(bus);

  const legend = document.createElement('div');
  legend.className = 'legend';
  legend.innerHTML = `
    <span><i class="dot"></i>Disponível</span>
    <span><i class="dot sel"></i>Selecionado</span>
    <span><i class="dot occ"></i>Ocupado</span>
  `;
  wrap.appendChild(legend);

  const selectedP = document.createElement('p');
  selectedP.style.margin = '6px 0 10px';

  const paxBox = document.createElement('div');
  paxBox.id = 'passenger-container';

  const actions = document.createElement('div');
  actions.className = 'actions';
  const confirm = document.createElement('button');
  confirm.className = 'btn btn-primary';
  confirm.textContent = 'Confirmar seleção';
  actions.appendChild(confirm);

  container.appendChild(wrap);
  container.appendChild(selectedP);
  container.appendChild(paxBox);
  container.appendChild(actions);

  const selectedSeats = new Set();
  const maxSelected = 6;

  async function loadSeats() {
    if (Array.isArray(schedule.seats) && schedule.seats.length) return true;
    try {
      const resp = await fetch('/api/poltronas', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({
          idViagem: schedule.idViagem,
          idTipoVeiculo: schedule.idTipoVeiculo,
          idLocOrigem: schedule.originId,
          idLocDestino: schedule.destinationId
        })
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const raw = await resp.json();
      const data = Array.isArray(raw) ? (raw[0]||{}) : raw;

      let poltronas = [];
      if (data?.PoltronaXmlRetorno) {
        const p = data.PoltronaXmlRetorno;
        poltronas = Array.isArray(p) ? p : (Array.isArray(p?.Poltrona) ? p.Poltrona : [p]);
      } else if (data?.LaypoltronaXml?.PoltronaXmlRetorno) {
        poltronas = data.LaypoltronaXml.PoltronaXmlRetorno;
      }

      const seats = (poltronas||[]).map(p=>{
        const number = parseInt(p.Caption || p.caption || p.Numero || p.NumeroPoltrona || p.Poltrona, 10);
        const situacao = parseInt(p.Situacao ?? p.situacao ?? 0, 10);
        return { number, situacao, occupied: situacao !== 0 };
      }).filter(s => Number.isFinite(s.number) && s.number>=1 && s.number<=42);

      if (!seats.length) throw new Error('Mapa vazio');
      schedule.seats = seats;
      return true;
    } catch (e){
      console.error('Erro poltronas:', e);
      grid.innerHTML = `<div class="seat-error" style="padding:16px;background:#fff7f7;border:1px solid #f2c7c7;border-radius:8px;color:#8a1f1f;text-align:center">
        Não foi possível carregar o mapa de poltronas. Tente novamente mais tarde.
      </div>`;
      confirm.disabled = true;
      return false;
    }
  }

  function draw(){
    grid.innerHTML = '';
    paxBox.innerHTML = '';
    selectedP.textContent = '';

    const rows = [
      [3,7,11,15,19,23,27,31,35,39,null],
      [4,8,12,16,20,24,28,32,36,40,null],
      [null,null,null,null,null,null,null,null,null,null,null],
      [2,6,10,14,18,22,26,30,34,38,42],
      [1,5,9,13,17,21,25,29,33,37,41]
    ];

    rows.forEach(row=>{
      row.forEach(cell=>{
        if (cell===null){
          const w=document.createElement('div');
          w.className='walkway';
          grid.appendChild(w);
          return;
        }
        const el=document.createElement('div');
        el.className='seat';
        el.textContent=cell;
        el.dataset.seat=String(cell);

        const s = (schedule.seats||[]).find(x=>Number(x.number)===cell);
        const isForced=(cell===1||cell===2);
        const isInactive = s?.situacao===3;
        const isOcc = !!s?.occupied;
        const isMissing = !s;
        const isUnavailable = isForced || isInactive || isOcc || isMissing;

        if (isUnavailable){
          el.classList.add('occupied');
          el.setAttribute('aria-disabled','true');
        } else {
          el.addEventListener('click', ()=>{
            if (selectedSeats.has(cell)){
              selectedSeats.delete(cell);
              el.classList.remove('selected');
            } else {
              if (selectedSeats.size>=maxSelected){
                alert(`É possível selecionar no máximo ${maxSelected} poltronas por compra.`);
                return;
              }
              selectedSeats.add(cell);
              el.classList.add('selected');
            }
            renderPassengers();
          });
        }

        grid.appendChild(el);
      });
    });
  }

  function renderPassengers(){
    paxBox.innerHTML='';
    const seats = [...selectedSeats];
    selectedP.textContent = seats.length ? `Poltronas selecionadas: ${seats.join(', ')}` : '';
    seats.forEach(n=>{
      const row = document.createElement('div');
      row.className = 'passenger-row';
      row.dataset.seatNumber = String(n);
      row.innerHTML = `
        <span class="seat-label">Pol ${n}:</span>
        <input type="text" name="name"  placeholder="Nome" required />
        <input type="text" name="cpf"   placeholder="CPF" required />
        <input type="tel"  name="phone" placeholder="Telefone" required />
      `;
      paxBox.appendChild(row);
    });
  }

  document.addEventListener('keydown', (e)=>{
    if (e.key === 'Escape' && selectedP.textContent) {
      // limpa seleção rápida com ESC
      selectedP.textContent = '';
      paxBox.innerHTML = '';
      Array.from(grid.querySelectorAll('.seat.selected')).forEach(s=>s.classList.remove('selected'));
      selectedSeats.clear();
    }
  });

  const confirm = container.querySelector('.btn.btn-primary');
  confirm.addEventListener('click', ()=>{
    const seats = [...selectedSeats];
    if (!seats.length){ alert('Primeiro selecione uma poltrona.'); return; }

    const rows = paxBox.querySelectorAll('.passenger-row');
    const passengers = [];
    let ok = true;
    rows.forEach(r=>{
      const name  = r.querySelector('input[name="name"]')?.value.trim();
      const cpf   = r.querySelector('input[name="cpf"]')?.value.trim();
      const phone = r.querySelector('input[name="phone"]')?.value.trim();
      const seatNumber = parseInt(r.dataset.seatNumber,10);
      if (!name || !cpf || !phone) ok = false;
      passengers.push({ seatNumber, name, cpf, phone });
    });
    if (!ok){ alert('Preencha todos os dados dos passageiros.'); return; }

    onConfirm && onConfirm({ schedule, seats, passengers });
  });

  (async ()=>{ const ok = await loadSeats(); if (ok) draw(); })();
}
