// SDK opcional para temas do Protetor de tela.
//
// O app só gerencia (tempo, tecla de bloqueio, PIN); quem desenha é o tema. Um tema é
// uma página HTML que roda dentro de um <iframe sandbox="allow-scripts"> (sem acesso
// aos dados do app) e conversa com ele por postMessage. Este arquivo cuida disso.
//
// Uso mínimo num tema:
//   <script src="../../theme-sdk.js"></script>
//   <script>
//     ScreensaverTheme.init({
//       autoWake: true,                       // clique/toque/tecla fecha (menos se bloqueado)
//       onState: function (s) { /* s.mode: "idle" | "locked" | "preview"; s.now */ }
//     });
//   </script>
//
// Sem o SDK, o protocolo é simples:
//   app -> tema:  { type: "screensaver:state", mode, now }   (ao carregar e quando muda)
//   tema -> app:  { type: "screensaver:ready" }              (ao iniciar)
//                 { type: "screensaver:wake" }               (pedido para fechar; ignorado se bloqueado)

(function (global) {
  "use strict";

  var inFrame = global.parent !== global;
  var state = { mode: "preview", now: null, options: {} };
  var handlers = [];

  function post(type) {
    if (!inFrame) return;
    try {
      global.parent.postMessage({ type: type }, "*");
    } catch (_) {
      // janela do app indisponível: nada a fazer
    }
  }

  function onMessage(event) {
    // Só aceita mensagens da janela que hospeda o tema.
    if (!inFrame || event.source !== global.parent) return;
    var msg = event.data;
    if (!msg || (msg.type !== "screensaver:state" && msg.type !== "descorde:screensaver")) return;
    if (msg.mode === "idle" || msg.mode === "locked" || msg.mode === "preview") state.mode = msg.mode;
    if (msg.now) state.now = msg.now;
    // Opções do tema (cores, quantidades…) escolhidas pelo usuário no app.
    if (msg.options && typeof msg.options === "object") state.options = msg.options;
    for (var i = 0; i < handlers.length; i++) {
      try { handlers[i]({ mode: state.mode, now: state.now, options: state.options }); } catch (_) { /* tema com erro não derruba o SDK */ }
    }
  }

  global.ScreensaverTheme = {
    // true se o tema está dentro do app (e não aberto direto no navegador).
    embedded: inFrame,

    mode: function () {
      return state.mode;
    },

    // Últimas opções recebidas do app (objeto vazio se o tema não declara opções).
    options: function () {
      return state.options;
    },

    // Pede ao app para fechar o protetor. Em "locked" nunca fecha.
    wake: function () {
      if (state.mode === "locked") return;
      post("screensaver:wake");
    },

    init: function (opts) {
      opts = opts || {};
      if (typeof opts.onState === "function") handlers.push(opts.onState);
      global.addEventListener("message", onMessage);
      if (opts.autoWake) {
        global.addEventListener("pointerdown", function () { global.ScreensaverTheme.wake(); });
        global.addEventListener("keydown", function () { global.ScreensaverTheme.wake(); });
      }
      post("screensaver:ready");
    }
  };
})(window);
