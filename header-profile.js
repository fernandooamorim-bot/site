(function () {
  'use strict';

  var SELECTORS = [
    {
      header: '.global-header',
      actions: '.global-header-actions',
      trigger: '.global-header-user',
      logout: '.global-header-logout',
      name: '.global-header-name'
    },
    {
      header: '.header',
      actions: '.header-right',
      trigger: '.header-user',
      logout: '.header-logout',
      name: '.header-user-name'
    },
    {
      header: '.header',
      actions: '.header-right',
      trigger: '.user-chip',
      logout: '.header-logout',
      name: '.user-name'
    },
    {
      header: '.header',
      actions: '.right',
      trigger: '.user',
      logout: '.logout',
      name: '.nm'
    }
  ];

  function mapearPerfil(valor) {
    var perfil = String(valor || '').trim().toLowerCase();
    var mapa = {
      proprietario: 'Proprietário',
      'proprietário': 'Proprietário',
      administrador: 'Administrador',
      socio_administrador: 'Sócio-administrador',
      'sócio-administrador': 'Sócio-administrador',
      producao: 'Produção',
      'produção': 'Produção',
      consulta: 'Consulta'
    };
    return mapa[perfil] || valor || 'Usuário';
  }

  function obterNome(config, trigger) {
    var node = trigger.querySelector(config.name);
    var texto = node && String(node.textContent || '').trim();
    if (texto && !/^(carregando|usuário|usuario|--|\.\.\.)$/i.test(texto)) return texto;
    return localStorage.getItem('auth_nome') || 'Usuário';
  }

  function fecharMenu(menu, trigger) {
    menu.classList.remove('open');
    menu.setAttribute('aria-hidden', 'true');
    trigger.setAttribute('aria-expanded', 'false');
  }

  function abrirConfiguracoes() {
    window.location.href = './configuracoes.html';
  }

  function sairDoSistema() {
    if (window.Auth && typeof Auth.logout === 'function') Auth.logout();
  }

  function criarMenu(config, actions, trigger) {
    var menu = document.createElement('div');
    menu.className = 'fa-profile-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-hidden', 'true');

    var head = document.createElement('div');
    head.className = 'fa-profile-menu-head';

    var name = document.createElement('div');
    name.className = 'fa-profile-menu-name';

    var role = document.createElement('div');
    role.className = 'fa-profile-menu-role';
    role.textContent = mapearPerfil(localStorage.getItem('auth_perfil'));

    head.append(name, role);

    var settings = document.createElement('button');
    settings.className = 'fa-profile-menu-action';
    settings.type = 'button';
    settings.setAttribute('role', 'menuitem');
    settings.innerHTML = '<i data-lucide="settings"></i><span>Configurações</span>';
    settings.addEventListener('click', abrirConfiguracoes);

    var logout = document.createElement('button');
    logout.className = 'fa-profile-menu-action danger';
    logout.type = 'button';
    logout.setAttribute('role', 'menuitem');
    logout.innerHTML = '<i data-lucide="log-out"></i><span>Sair do sistema</span>';
    logout.addEventListener('click', sairDoSistema);

    menu.append(head, settings, logout);
    actions.appendChild(menu);

    function sincronizarNome() {
      name.textContent = localStorage.getItem('auth_nome') || obterNome(config, trigger);
    }

    sincronizarNome();
    var sourceName = trigger.querySelector(config.name);
    if (sourceName && window.MutationObserver) {
      new MutationObserver(sincronizarNome).observe(sourceName, {
        childList: true,
        characterData: true,
        subtree: true
      });
    }

    trigger.addEventListener('click', function (event) {
      event.stopPropagation();
      var abrir = !menu.classList.contains('open');
      document.querySelectorAll('.fa-profile-menu.open').forEach(function (outro) {
        outro.classList.remove('open');
        outro.setAttribute('aria-hidden', 'true');
      });
      menu.classList.toggle('open', abrir);
      menu.setAttribute('aria-hidden', String(!abrir));
      trigger.setAttribute('aria-expanded', String(abrir));
    });

    trigger.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        trigger.click();
      }
    });

    document.addEventListener('click', function (event) {
      if (!actions.contains(event.target)) fecharMenu(menu, trigger);
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && menu.classList.contains('open')) {
        fecharMenu(menu, trigger);
        trigger.focus();
      }
    });

    if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
  }

  function iniciar() {
    var config = SELECTORS.find(function (item) {
      return document.querySelector(item.header + ' ' + item.trigger);
    });
    if (!config) return;

    var header = document.querySelector(config.header);
    var actions = header && header.querySelector(config.actions);
    var trigger = actions && actions.querySelector(config.trigger);
    var logout = actions && actions.querySelector(config.logout);
    if (!header || !actions || !trigger || trigger.classList.contains('fa-profile-trigger')) return;

    header.classList.add('fa-system-header');
    actions.classList.add('fa-header-actions');
    trigger.classList.add('fa-profile-trigger');
    trigger.setAttribute('role', 'button');
    trigger.setAttribute('tabindex', '0');
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', 'Abrir opções do perfil');

    var chevron = document.createElement('i');
    chevron.className = 'fa-profile-chevron';
    chevron.setAttribute('data-lucide', 'chevron-down');
    chevron.setAttribute('aria-hidden', 'true');
    trigger.appendChild(chevron);

    if (logout) logout.classList.add('fa-legacy-logout');
    criarMenu(config, actions, trigger);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar, { once: true });
  } else {
    iniciar();
  }
})();
