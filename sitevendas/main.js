// main.js - inicializa navegação e lida com pesquisa de viagens
document.addEventListener('DOMContentLoaded', () => {
  // Atualiza o menu do usuário (login/logout)
  updateUserNav();

  // Lista de localidades (id e descrição) que servirão para as sugestões.
  // Essa lista foi extraída a partir da planilha fornecida pelo usuário e
  // representa um sentido da linha. Caso existam outras localidades, basta
  // adicionar novos objetos ao array.
  const localities = [
    { id: 2, descricao: 'Ouro Branco' },
    { id: 6, descricao: 'Ouro Preto E/S' },
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

  // Referências aos inputs e listas de sugestões
  const originInput = document.getElementById('origin');
  const destInput = document.getElementById('destination');
  const originList = document.getElementById('origin-suggestions');
  const destList = document.getElementById('destination-suggestions');

  /**
   * Atualiza a lista de opções de um datalist de acordo com o texto digitado.
   * @param {HTMLInputElement} input Campo de texto que dispara a atualização
   * @param {HTMLDataListElement} datalist Lista de opções associada ao campo
   */
  function updateSuggestions(input, datalist) {
    const search = input.value.toLowerCase();
    // Remove todas as opções atuais
    datalist.innerHTML = '';
    if (!search) return;
    // Filtra localidades que começam com o texto digitado
    const filtered = localities.filter(loc => loc.descricao.toLowerCase().startsWith(search));
    filtered.forEach(loc => {
      const option = document.createElement('option');
      option.value = loc.descricao;
      option.dataset.id = loc.id;
      datalist.appendChild(option);
    });
  }

  // Event listeners para atualizar as sugestões enquanto o usuário digita
  if (originInput && originList) {
    originInput.addEventListener('input', () => updateSuggestions(originInput, originList));
  }
  if (destInput && destList) {
    destInput.addEventListener('input', () => updateSuggestions(destInput, destList));
  }

  const searchForm = document.getElementById('search-form');
  if (searchForm) {
    searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const originName = originInput.value.trim();
      const destinationName = destInput.value.trim();
      const date = document.getElementById('date').value;
      if (!originName || !destinationName || !date) {
        alert('Por favor, preencha todos os campos.');
        return;
      }
      // Encontra os IDs correspondentes às descrições informadas
      const originObj = localities.find(loc => loc.descricao.toLowerCase() === originName.toLowerCase());
      const destObj = localities.find(loc => loc.descricao.toLowerCase() === destinationName.toLowerCase());
      if (!originObj || !destObj) {
        alert('Origem ou destino inválido. Selecione uma opção sugerida.');
        return;
      }
      const searchParams = {
        originId: originObj.id,
        originName: originObj.descricao,
        destinationId: destObj.id,
        destinationName: destObj.descricao,
        date
      };
      // salva os parâmetros de pesquisa no localStorage
      localStorage.setItem('searchParams', JSON.stringify(searchParams));
      // redireciona para a página de horários
      window.location.href = 'schedules.html';
    });
  }

  // Impede seleção de datas anteriores à atual
  const dateInput = document.getElementById('date');
  if (dateInput) {
    const today = new Date();
    // Formata data no padrão YYYY-MM-DD considerando fuso horário local
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const minDate = `${yyyy}-${mm}-${dd}`;
    dateInput.setAttribute('min', minDate);
  }
});

function updateUserNav() {
  const nav = document.getElementById('user-nav');
  if (!nav) return;
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  nav.innerHTML = '';
  if (user) {
    const profileLink = document.createElement('a');
    profileLink.href = 'profile.html';
    // Usa nome ou email como identificador do usuário
    const identifier = user.name ? user.name : user.email;
    profileLink.textContent = `Minhas viagens (${identifier})`;
    nav.appendChild(profileLink);

    const logoutLink = document.createElement('a');
    logoutLink.href = '#';
    logoutLink.textContent = 'Sair';
    logoutLink.addEventListener('click', () => {
      localStorage.removeItem('user');
      updateUserNav();
      window.location.href = 'index.html';
    });
    nav.appendChild(logoutLink);
  } else {
    const loginLink = document.createElement('a');
    loginLink.href = 'login.html';
    loginLink.textContent = 'Entrar';
    loginLink.addEventListener('click', () => {
      // Armazena a página atual para redirecionar após o login
      const href = window.location.href;
      const path = href.substring(href.lastIndexOf('/') + 1);
      localStorage.setItem('postLoginRedirect', path);
    });
    nav.appendChild(loginLink);
  }
}