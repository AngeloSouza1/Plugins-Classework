// SDK de plugins do DESCORDE — esconde o handshake/renovação do token.
// Uso: <script src="/plugin-sdk.js"></script> e depois:
//   const dc = DescordePlugin.init();
//   await dc.ready();
//   const me = await dc.me();
// Aceita só mensagens vindas da janela pai (window.parent) com type "descorde:session".
(function () {
  "use strict";

  var session = null; // { token, apiBase, expiresAt, scopes }
  var sessionWaiters = [];
  var onSessionHandlers = [];

  function setSession(next) {
    session = next;
    sessionWaiters.forEach(function (resolve) { resolve(next); });
    sessionWaiters = [];
    onSessionHandlers.forEach(function (fn) { fn(next); });
  }

  function makeError(status, message, code) {
    var err = new Error(message);
    if (status !== undefined) err.status = status;
    if (code) err.code = code;
    return err;
  }

  // Aguarda a próxima sessão; com timeout, remove o próprio waiter e rejeita.
  function waitSession(timeoutMs, timeoutMessage, timeoutCode) {
    return new Promise(function (resolve, reject) {
      var timer = null;
      var waiter = function (next) {
        if (timer) clearTimeout(timer);
        resolve(next);
      };
      if (timeoutMs) {
        timer = setTimeout(function () {
          var idx = sessionWaiters.indexOf(waiter);
          if (idx !== -1) sessionWaiters.splice(idx, 1);
          reject(makeError(undefined, timeoutMessage, timeoutCode));
        }, timeoutMs);
      }
      sessionWaiters.push(waiter);
    });
  }

  function ready() {
    return session
      ? Promise.resolve(session)
      : waitSession(10000, "Não chegou sessão do DESCORDE (timeout de 10s)");
  }

  // Chama um endpoint com token. Em 401, pede refresh no máximo UMA vez por chamada.
  function request(path, params) {
    return ready().then(function () {
      if (!session || !session.token) {
        return Promise.reject(new Error("Este plugin não tem escopos e não pode chamar a API"));
      }
      function doFetch(retried) {
        var url = session.apiBase + path + (params ? "?" + new URLSearchParams(params) : "");
        return fetch(url, { headers: { Authorization: "Bearer " + session.token } }).then(function (res) {
          if (res.status === 403) {
            return Promise.reject(makeError(403, "Acesso revogado ou escopo insuficiente", "REVOKED_OR_SCOPE"));
          }
          if (res.status === 401) {
            if (retried) {
              return Promise.reject(makeError(401, "Não autorizado", "UNAUTHORIZED"));
            }
            window.parent.postMessage({ type: "descorde:refresh" }, "*");
            return waitSession(10000, "Não chegou nova sessão do DESCORDE (timeout de 10s)", "SESSION_TIMEOUT").then(function () {
              return doFetch(true);
            });
          }
          if (!res.ok) {
            return res
              .json()
              .catch(function () { return null; })
              .then(function (body) {
                return Promise.reject(makeError(res.status, (body && body.error) ? body.error : "Erro " + res.status));
              });
          }
          return res.json();
        });
      }
      return doFetch(false);
    });
  }

  window.addEventListener("message", function (event) {
    // Segurança: só aceita a mensagem da janela pai, e só a de sessão.
    if (event.source !== window.parent) return;
    var data = event.data;
    if (!data || data.type !== "descorde:session") return;
    setSession(data);
  });

  window.DescordePlugin = {
    init: function () {
      window.parent.postMessage({ type: "descorde:ready" }, "*");
      var instance = {
        onSession: function (fn) { onSessionHandlers.push(fn); return instance; },
        ready: ready,
        me: function () { return request("/me"); },
        servers: function () { return request("/servers").then(function (r) { return r.servers; }); },
        tasks: function (opts) { return request("/tasks", opts).then(function (r) { return r.tasks; }); },
      };
      return instance;
    },
  };
})();
