// PWA bootstrap — registra el service worker y expone helpers para el resto
// del código de la suite. Cargado desde el <head> de cada HTML; idempotente.
//
// Responsabilidades:
//  1. Registrar /sw.js con scope global.
//  2. Detectar si la página corre dentro del shell SPA (iframe) y exponerlo.
//  3. Capturar 'beforeinstallprompt' para que el shell pueda mostrar un
//     botón "Instalar app" cuando proceda.
(function () {
  'use strict';

  // ---- Service worker registration -----------------------------------------
  // Solo en https/localhost — file:// y http://… (excepto loopback) no soportan SW.
  var supportsSW = ('serviceWorker' in navigator)
    && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1');

  if (supportsSW) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then(function (reg) {
          reg.addEventListener('updatefound', function () {
            var nw = reg.installing;
            if (!nw) return;
            nw.addEventListener('statechange', function () {
              if (nw.state === 'installed' && navigator.serviceWorker.controller) {
                document.dispatchEvent(new CustomEvent('sincro-pwa-update-available'));
              }
            });
          });
        })
        .catch(function (err) {
          console.warn('[PWA] Registro de service worker falló:', err);
        });
    });
  }

  // ---- Embedded shell detection --------------------------------------------
  // El shell SPA (app.html, fase 2) marca window.name = 'sincro-shell-frame'
  // antes de navegar el iframe. Las páginas internas pueden añadir CSS sobre
  // <html class="in-shell"> para ocultar su propio topbar/header — el shell
  // ya provee chrome unificado.
  var inShell = false;
  try {
    inShell = (window.parent !== window) && /^sincro-shell/.test(window.name || '');
  } catch (e) {
    // Cross-origin throw — no aplica aquí porque todo es same-origin, pero
    // por si alguien embebe la app desde otro dominio (no soportado).
    inShell = false;
  }
  if (inShell) {
    document.documentElement.classList.add('in-shell');
    // Inyecta CSS para ocultar los topbars internos cuando la página corre
    // dentro del shell SPA (app.html) — el shell ya provee chrome unificado
    // y no queremos doble navegación. Selectores cubren los IDs/clases
    // existentes en cada HTML de la suite (#topbar en play.html,
    // #sat-topbar en gh-play/autostepper/gh-autostepper/test-pad,
    // header.topbar en index.html).
    var injectShellCSS = function () {
      if (document.getElementById('sincro-in-shell-css')) return;
      var s = document.createElement('style');
      s.id = 'sincro-in-shell-css';
      s.textContent =
        'html.in-shell #topbar,' +
        'html.in-shell #sat-topbar,' +
        'html.in-shell header.topbar,' +
        'html.in-shell .topbar:not(.shell-topbar) {' +
          'display:none !important;' +
        '}' +
        'html.in-shell body {' +
          'padding-top:0 !important;' +
          'margin-top:0 !important;' +
        '}';
      (document.head || document.documentElement).appendChild(s);
    };
    if (document.head) injectShellCSS();
    else document.addEventListener('DOMContentLoaded', injectShellCSS);
  }

  // ---- Install prompt capture ----------------------------------------------
  var deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    document.dispatchEvent(new CustomEvent('sincro-pwa-installable'));
  });
  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    document.dispatchEvent(new CustomEvent('sincro-pwa-installed'));
  });

  // ---- Public API ----------------------------------------------------------
  window.SincroPWA = {
    inShell: inShell,
    isInstalled: function () {
      return window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
    },
    canInstall: function () { return !!deferredPrompt; },
    promptInstall: function () {
      if (!deferredPrompt) return Promise.resolve({ outcome: 'unavailable' });
      var p = deferredPrompt;
      deferredPrompt = null;
      p.prompt();
      return p.userChoice;
    }
  };
})();
