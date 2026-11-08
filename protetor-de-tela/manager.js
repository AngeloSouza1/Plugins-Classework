// Protetor de tela: o app só gerencia (tempo, tecla de bloqueio, PIN, escolha do tema).
// Quem desenha são os temas, que rodam isolados num <iframe sandbox="allow-scripts"> e
// conversam por postMessage (ver theme-sdk.js e README.md).
//
// Preferências ficam em localStorage deste navegador. Sem build, sem bibliotecas.

(function () {
  "use strict";

  var STORAGE_KEY = "protetor_de_tela_prefs";
  var IDLE_OPTIONS = [1, 2, 5, 10, 15, 30, 60];
  var DEFAULT_HOTKEY = { ctrl: true, alt: true, shift: false, meta: false, code: "KeyL" };
  var ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "wheel"];
  var MODIFIER_CODES = ["ControlLeft", "ControlRight", "AltLeft", "AltRight", "ShiftLeft", "ShiftRight", "MetaLeft", "MetaRight"];
  var READY_TIMEOUT_MS = 4000;   // sem "ready" do tema nesse tempo, mostra o relógio de reserva
  var MAX_PIN_FAILS = 5;
  var PIN_LOCKOUT_MS = 15000;

  function $(id) { return document.getElementById(id); }

  // ---------- preferências ----------

  var DEFAULTS = {
    enabled: true,
    idleMinutes: 5,
    hotkey: DEFAULT_HOTKEY,
    themeId: "vanta-birds",
    pinHash: "",
    pinSalt: "",
    autoFullscreen: true,
    customThemes: [],
    themeOptions: {}   // { [idDoTema]: { [chave]: valor } }, valores validados antes de uso
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function isLocalHost(host) {
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  }

  // Aceita https:// (qualquer host) e http:// só em localhost.
  function validThemeUrl(raw) {
    try {
      var u = new URL(String(raw));
      if (u.protocol === "https:") return true;
      if (u.protocol === "http:" && isLocalHost(u.hostname)) return true;
    } catch (_) { /* url inválida */ }
    return false;
  }

  function loadPrefs() {
    var p = clone(DEFAULTS);
    try {
      var raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (raw && typeof raw === "object") {
        if (typeof raw.enabled === "boolean") p.enabled = raw.enabled;
        if (IDLE_OPTIONS.indexOf(Number(raw.idleMinutes)) >= 0) p.idleMinutes = Number(raw.idleMinutes);
        if (raw.hotkey && typeof raw.hotkey.code === "string") {
          p.hotkey = {
            ctrl: !!raw.hotkey.ctrl, alt: !!raw.hotkey.alt, shift: !!raw.hotkey.shift,
            meta: !!raw.hotkey.meta, code: raw.hotkey.code.slice(0, 20)
          };
        }
        if (typeof raw.themeId === "string") p.themeId = raw.themeId.slice(0, 60);
        if (typeof raw.pinHash === "string" && typeof raw.pinSalt === "string") {
          p.pinHash = raw.pinHash.slice(0, 128);
          p.pinSalt = raw.pinSalt.slice(0, 64);
        }
        if (typeof raw.autoFullscreen === "boolean") p.autoFullscreen = raw.autoFullscreen;
        if (Array.isArray(raw.customThemes)) {
          p.customThemes = raw.customThemes
            .filter(function (t) { return t && typeof t.id === "string" && typeof t.name === "string" && validThemeUrl(t.url); })
            .map(function (t) { return { id: t.id.slice(0, 40), name: t.name.slice(0, 40), url: String(t.url) }; })
            .slice(0, 20);
        }
        if (raw.themeOptions && typeof raw.themeOptions === "object") {
          Object.keys(raw.themeOptions).slice(0, 30).forEach(function (tid) {
            var src = raw.themeOptions[tid];
            if (!src || typeof src !== "object") return;
            var dst = {};
            Object.keys(src).slice(0, 40).forEach(function (k) {
              var v = src[k];
              if (typeof v === "string" && v.length <= 40) dst[k.slice(0, 40)] = v;
              else if (typeof v === "number" && isFinite(v)) dst[k.slice(0, 40)] = v;
              else if (typeof v === "boolean") dst[k.slice(0, 40)] = v;
            });
            p.themeOptions[tid.slice(0, 60)] = dst;
          });
        }
      }
    } catch (_) {
      // armazenamento indisponível ou corrompido: vale o padrão
    }
    return p;
  }

  var prefs = loadPrefs();

  function savePrefs() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch (_) {
      // sem armazenamento: vale até recarregar a página
    }
  }

  // ---------- PIN (hash com sal) ----------

  function toHex(buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  }

  function newSalt() {
    var bytes = new Uint8Array(8);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return toHex(bytes);
  }

  function hashPin(pin, salt) {
    var text = salt + ":" + pin;
    if (window.crypto && crypto.subtle && window.TextEncoder) {
      return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then(toHex);
    }
    // Contexto sem crypto.subtle (página aberta por http fora do localhost): hash simples.
    var h = 5381;
    for (var i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
    return Promise.resolve("x" + (h >>> 0).toString(16));
  }

  function verifyPin(pin) {
    if (!prefs.pinHash) return Promise.resolve(true);
    return hashPin(pin, prefs.pinSalt).then(function (h) { return h === prefs.pinHash; });
  }

  // ---------- tecla de bloqueio ----------

  function matchHotkey(e, h) {
    return e.code === h.code && e.ctrlKey === h.ctrl && e.altKey === h.alt && e.shiftKey === h.shift && e.metaKey === h.meta;
  }

  function codeLabel(code) {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit\d$/.test(code)) return code.slice(5);
    if (code === "Space") return "Espaço";
    return code.replace(/^Arrow/, "Seta ");
  }

  function formatHotkey(h) {
    var parts = [];
    if (h.ctrl) parts.push("Ctrl");
    if (h.alt) parts.push("Alt");
    if (h.shift) parts.push("Shift");
    if (h.meta) parts.push("Meta");
    parts.push(codeLabel(h.code));
    return parts.join("+");
  }

  var capturing = false;

  function setCapturing(on) {
    capturing = on;
    $("hotkey-view").classList.toggle("capturing", on);
    $("hotkey-view").textContent = on ? "Pressione as teclas…" : formatHotkey(prefs.hotkey);
    $("btn-hotkey").textContent = on ? "Cancelar" : "Alterar";
  }

  // ---------- temas ----------

  var builtinThemes = [];
  var hiddenThemes = []; // temas cujo arquivo exigido (ex.: um vídeo) não existe nesta cópia do plugin
  var themesLoaded = false; // vira true quando a lista de temas termina de carregar (com ou sem erro)

  // Um tema pode declarar "requires": ["caminho/do/arquivo"]. Se algum não existir (404), o tema
  // não aparece, em vez de listar uma animação que não vai tocar (ex.: vídeos fora do repositório).
  function themeAvailable(t) {
    var reqs = Array.isArray(t.requires) ? t.requires : [];
    return Promise.all(reqs.map(function (path) {
      return fetch(new URL(path, location.href).href, { method: "HEAD", cache: "no-store" })
        .then(function (r) { return r.ok; })
        .catch(function () { return false; });
    })).then(function (oks) { return oks.every(Boolean); });
  }

  function filterAvailable(list) {
    return Promise.all(list.map(themeAvailable)).then(function (flags) {
      var kept = [];
      var hidden = [];
      list.forEach(function (t, i) { (flags[i] ? kept : hidden).push(t); });
      return { kept: kept, hidden: hidden };
    });
  }

  function allThemes() {
    var list = builtinThemes.map(function (t) {
      return {
        id: t.id, name: t.name, description: t.description || "", url: new URL(t.path, location.href).href,
        custom: false, options: Array.isArray(t.options) ? t.options : []
      };
    });
    prefs.customThemes.forEach(function (t) {
      list.push({ id: t.id, name: t.name, description: t.url, url: t.url, custom: true, options: [] });
    });
    return list;
  }

  function findTheme(id) {
    var all = allThemes();
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return all[0] || null;
  }

  // ---------- painéis (modais empilháveis) ----------
  // Cada botão da tela inicial abre um painel. Painéis podem abrir por cima de outros (as opções de um
  // tema abrem por cima do painel de temas); Esc e o × fecham sempre o de cima.

  var modalStack = [];        // ids dos painéis abertos; o último é o do topo
  var modalReturnFocus = {};  // quem tinha o foco quando o painel abriu

  function syncModalLock() {
    document.documentElement.classList.toggle("modal-open", modalStack.length > 0);
  }

  function topModal() {
    return modalStack.length ? modalStack[modalStack.length - 1] : null;
  }

  function openModal(id) {
    var el = $(id);
    if (!el || modalStack.indexOf(id) >= 0) return;
    modalReturnFocus[id] = document.activeElement;
    modalStack.push(id);
    el.style.zIndex = String(50000 + modalStack.length);
    el.hidden = false;
    syncModalLock();
    var closeBtn = el.querySelector("[data-close-modal]");
    if (closeBtn) closeBtn.focus();
  }

  function closeModalEl(id) {
    var i = modalStack.indexOf(id);
    if (i < 0) return;
    modalStack.splice(i, 1);
    $(id).hidden = true;
    syncModalLock();
    if (id === "panel-time" && capturing) setCapturing(false); // não deixa a captura de tecla pendurada
    var back = modalReturnFocus[id];
    delete modalReturnFocus[id];
    if (back && document.contains(back) && typeof back.focus === "function") back.focus();
  }

  function closeTopModal() {
    var id = topModal();
    if (!id) return;
    if (id === "options-card") closeOptions();
    else closeModalEl(id);
  }

  // ---------- opções por tema ----------

  var previewEl = $("opt-preview");
  var previewThemeId = null;
  var optionsOpen = false; // o modal de opções só abre ao usar ou personalizar um tema que tenha opções

  function optionSchema(theme) {
    return theme && Array.isArray(theme.options) ? theme.options : [];
  }

  // Converte qualquer valor em um valor válido para a opção (nunca confia no que veio salvo).
  function coerceOption(opt, value) {
    if (opt.type === "color") {
      return /^#[0-9a-fA-F]{6}$/.test(String(value)) ? String(value).toLowerCase() : opt.default;
    }
    if (opt.type === "range") {
      var n = Number(value);
      if (!isFinite(n)) return opt.default;
      return Math.min(opt.max, Math.max(opt.min, n));
    }
    if (opt.type === "select") {
      var ok = (opt.choices || []).some(function (c) { return c.value === value; });
      return ok ? value : opt.default;
    }
    if (opt.type === "checkbox") return typeof value === "boolean" ? value : !!opt.default;
    return opt.default;
  }

  // Padrões do tema + o que o usuário salvou, já validado.
  function effectiveOptions(theme) {
    var saved = (theme && prefs.themeOptions[theme.id]) || {};
    var out = {};
    optionSchema(theme).forEach(function (o) {
      out[o.key] = coerceOption(o, Object.prototype.hasOwnProperty.call(saved, o.key) ? saved[o.key] : o.default);
    });
    return out;
  }

  function postPreview() {
    var win = previewEl.contentWindow;
    var theme = findTheme(prefs.themeId);
    if (!win || !theme || !optionSchema(theme).length) return;
    try {
      win.postMessage({ type: "screensaver:state", mode: "preview", now: new Date().toISOString(), options: effectiveOptions(theme) }, "*");
    } catch (_) {
      // prévia ainda carregando: o "ready" dela dispara de novo
    }
  }

  function setOption(theme, opt, raw) {
    var v = coerceOption(opt, raw);
    if (!prefs.themeOptions[theme.id]) prefs.themeOptions[theme.id] = {};
    prefs.themeOptions[theme.id][opt.key] = v;
    savePrefs();
    postPreview();
    if (overlay.open && overlay.theme && overlay.theme.id === theme.id) postState();
    return v;
  }

  function renderOptions() {
    var card = $("options-card");
    var theme = findTheme(prefs.themeId);
    var schema = optionSchema(theme);
    if (!theme || !schema.length || !optionsOpen) {
      closeModalEl("options-card");
      if (previewThemeId) {
        previewEl.src = "about:blank";
        previewThemeId = null;
      }
      return;
    }
    openModal("options-card");
    $("options-title").textContent = "Opções: " + theme.name;

    var box = $("options-controls");
    box.textContent = "";
    var values = effectiveOptions(theme);
    schema.forEach(function (o) {
      var row = document.createElement("label");
      row.className = "opt-row";
      var name = document.createElement("span");
      name.textContent = o.label || o.key;
      var input;
      if (o.type === "select") {
        input = document.createElement("select");
        (o.choices || []).forEach(function (c) {
          var op = document.createElement("option");
          op.value = c.value;
          op.textContent = c.label || c.value;
          input.appendChild(op);
        });
        input.value = values[o.key];
      } else if (o.type === "checkbox") {
        input = document.createElement("input");
        input.type = "checkbox";
        input.checked = !!values[o.key];
      } else {
        input = document.createElement("input");
        input.type = o.type === "color" ? "color" : "range";
        if (o.type === "range") {
          input.min = o.min;
          input.max = o.max;
          input.step = o.step || 1;
        }
        input.value = values[o.key];
      }
      var out = document.createElement("output");
      if (o.type === "range") out.textContent = String(values[o.key]);
      input.addEventListener(o.type === "range" || o.type === "color" ? "input" : "change", function () {
        var v = setOption(theme, o, o.type === "checkbox" ? input.checked : o.type === "range" ? Number(input.value) : input.value);
        if (o.type === "range") out.textContent = String(v);
      });
      row.appendChild(name);
      row.appendChild(input);
      row.appendChild(out);
      box.appendChild(row);
    });

    if (previewThemeId !== theme.id) {
      previewThemeId = theme.id;
      previewEl.src = theme.url; // ao carregar, o tema avisa "ready" e recebe as opções
    } else {
      postPreview();
    }
  }

  function hasOptions(theme) {
    return optionSchema(theme).length > 0;
  }

  function closeOptions() {
    optionsOpen = false;
    renderOptions();
  }

  function renderThemes() {
    var box = $("themes");
    box.textContent = "";
    var note = $("themes-note");
    if (hiddenThemes.length) {
      var names = hiddenThemes.map(function (t) { return t.name; }).join(" e ");
      note.textContent = names + (hiddenThemes.length > 1 ? " não aparecem" : " não aparece") + ": " +
        (hiddenThemes.length > 1 ? "os arquivos de vídeo não estão" : "o arquivo de vídeo não está") + " nesta cópia do plugin (veja o README).";
      note.hidden = false;
    } else {
      note.hidden = true;
    }
    var all = allThemes();
    if (!all.length) {
      var empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "Nenhum tema encontrado.";
      box.appendChild(empty);
      return;
    }
    var current = findTheme(prefs.themeId);
    all.forEach(function (t) {
      var card = document.createElement("div");
      card.className = "theme" + (current && current.id === t.id ? " selected" : "");
      card.setAttribute("role", "radio");
      card.setAttribute("aria-checked", current && current.id === t.id ? "true" : "false");

      var h = document.createElement("h4");
      h.textContent = t.name;
      var p = document.createElement("p");
      p.textContent = t.description;
      var tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = t.custom ? "Tema por endereço" : "Tema da pasta themes/";

      var buttons = document.createElement("div");
      buttons.className = "buttons";
      var use = document.createElement("button");
      use.type = "button";
      use.className = "primary";
      use.textContent = current && current.id === t.id ? "Em uso" : "Usar";
      use.disabled = !!(current && current.id === t.id);
      use.addEventListener("click", function () {
        prefs.themeId = t.id;
        optionsOpen = hasOptions(t);
        savePrefs();
        renderThemes();
        renderOptions();
        renderStatus();
      });
      var preview = document.createElement("button");
      preview.type = "button";
      preview.className = "ghost";
      preview.textContent = "Pré-visualizar";
      preview.addEventListener("click", function () { openOverlay("preview", t.id); });
      buttons.appendChild(use);
      buttons.appendChild(preview);
      if (t.options && t.options.length) {
        var customize = document.createElement("button");
        customize.type = "button";
        customize.className = "ghost";
        customize.textContent = "Personalizar";
        customize.addEventListener("click", function () {
          optionsOpen = true;
          if (prefs.themeId !== t.id) {
            prefs.themeId = t.id;
            savePrefs();
            renderThemes();
            renderStatus();
          }
          renderOptions();
        });
        buttons.appendChild(customize);
      }
      if (t.custom) {
        var rm = document.createElement("button");
        rm.type = "button";
        rm.className = "ghost";
        rm.textContent = "Remover";
        rm.addEventListener("click", function () {
          prefs.customThemes = prefs.customThemes.filter(function (c) { return c.id !== t.id; });
          if (prefs.themeId === t.id) prefs.themeId = (builtinThemes[0] && builtinThemes[0].id) || "";
          savePrefs();
          optionsOpen = false;
          renderThemes();
          renderOptions();
          renderStatus();
        });
        buttons.appendChild(rm);
      }

      card.appendChild(h);
      card.appendChild(p);
      card.appendChild(tag);
      card.appendChild(buttons);
      box.appendChild(card);
    });
  }

  // ---------- camada do protetor ----------

  var overlayEl = $("overlay");
  var frameEl = $("frame");
  var lockLayer = $("lock-layer");
  var overlay = { open: false, mode: "idle", ready: false, readyTimer: 0, enteredFullscreen: false, pinFails: 0, lockedUntil: 0, theme: null };
  var lastActivity = Date.now();

  var clockFmt = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
  var dateFmt = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" });

  function updateFallbackClock() {
    var now = new Date();
    $("fb-clock").textContent = clockFmt.format(now);
    $("fb-date").textContent = dateFmt.format(now);
  }

  function postState() {
    var win = frameEl.contentWindow;
    if (!win || frameEl.hidden) return;
    try {
      win.postMessage({
        type: "screensaver:state",
        mode: overlay.mode,
        now: new Date().toISOString(),
        options: overlay.theme ? effectiveOptions(overlay.theme) : {}
      }, "*");
    } catch (_) {
      // tema ainda não carregou: o próximo ready/load manda de novo
    }
  }

  function applyMode() {
    var locked = overlay.mode === "locked";
    lockLayer.hidden = !locked;
    $("preview-close").hidden = overlay.mode !== "preview";
    var hasPin = !!prefs.pinHash;
    $("lock-pin").hidden = !hasPin;
    $("lock-label").textContent = hasPin ? "Digite o PIN para desbloquear" : "Tela bloqueada";
    $("lock-error").textContent = "";
    $("lock-pin").value = "";
    if (locked) (hasPin ? $("lock-pin") : lockLayer.querySelector("button")).focus();
    postState();
  }

  function tryFullscreen() {
    var root = document.documentElement;
    if (!prefs.autoFullscreen || document.fullscreenElement || !root.requestFullscreen) return;
    root.requestFullscreen().then(function () { overlay.enteredFullscreen = true; }).catch(function () { /* o navegador pode negar sem gesto do usuário */ });
  }

  function leaveFullscreen() {
    if (overlay.enteredFullscreen && document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(function () { /* já saiu */ });
    }
    overlay.enteredFullscreen = false;
  }

  function openOverlay(mode, themeId) {
    if (overlay.open) {
      // Já aberto: só sobe para "bloqueado" (ex.: atalho durante o modo ocioso).
      if (mode === "locked" && overlay.mode !== "locked") {
        overlay.mode = "locked";
        applyMode();
      }
      return;
    }
    var theme = findTheme(themeId || prefs.themeId);
    overlay.theme = theme;
    overlay.open = true;
    overlay.mode = mode;
    overlay.ready = false;
    updateFallbackClock();
    overlayEl.hidden = false;
    document.documentElement.classList.add("overlay-open");
    frameEl.hidden = !theme;
    if (theme) frameEl.src = theme.url;
    clearTimeout(overlay.readyTimer);
    overlay.readyTimer = setTimeout(function () {
      if (!overlay.ready) frameEl.hidden = true; // tema não respondeu: fica o relógio de reserva
    }, READY_TIMEOUT_MS);
    applyMode();
    // Pré-visualização fica só dentro da janela do navegador; tela cheia é para o bloqueio de verdade.
    if (mode !== "preview") tryFullscreen();
  }

  function closeOverlay() {
    if (!overlay.open) return;
    overlay.open = false;
    clearTimeout(overlay.readyTimer);
    overlayEl.hidden = true;
    document.documentElement.classList.remove("overlay-open");
    frameEl.src = "about:blank";
    lockLayer.hidden = true;
    $("preview-close").hidden = true;
    leaveFullscreen();
    lastActivity = Date.now();
  }

  window.addEventListener("message", function (event) {
    // Prévia ao vivo do cartão de opções: só precisa receber o estado quando avisa "ready".
    if (event.source === previewEl.contentWindow) {
      if (event.data && event.data.type === "screensaver:ready") postPreview();
      return;
    }
    if (!overlay.open || event.source !== frameEl.contentWindow) return;
    var data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "screensaver:ready") {
      overlay.ready = true;
      frameEl.hidden = false;
      postState();
    } else if (data.type === "screensaver:wake" && overlay.mode !== "locked") {
      closeOverlay();
    }
  });

  $("preview-close").addEventListener("click", closeOverlay);

  frameEl.addEventListener("load", function () {
    if (overlay.open) postState();
  });

  // Desbloqueio: com PIN confere o hash; sem PIN, o botão basta.
  $("lock-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var now = Date.now();
    if (now < overlay.lockedUntil) {
      $("lock-error").textContent = "Muitas tentativas. Aguarde " + Math.ceil((overlay.lockedUntil - now) / 1000) + " s.";
      return;
    }
    verifyPin($("lock-pin").value).then(function (ok) {
      if (ok) {
        overlay.pinFails = 0;
        closeOverlay();
        return;
      }
      overlay.pinFails++;
      if (overlay.pinFails >= MAX_PIN_FAILS) {
        overlay.pinFails = 0;
        overlay.lockedUntil = Date.now() + PIN_LOCKOUT_MS;
        $("lock-error").textContent = "Muitas tentativas. Aguarde " + PIN_LOCKOUT_MS / 1000 + " s.";
      } else {
        $("lock-error").textContent = "PIN incorreto.";
      }
      $("lock-pin").value = "";
      $("lock-pin").focus();
    });
  });

  setInterval(function () {
    if (overlay.open) updateFallbackClock();
  }, 15000);

  // ---------- gatilhos: ociosidade, tecla e eventos ----------

  ACTIVITY_EVENTS.forEach(function (name) {
    window.addEventListener(name, function () { lastActivity = Date.now(); }, { passive: true });
  });

  setInterval(function () {
    if (!prefs.enabled || overlay.open) return;
    if (Date.now() - lastActivity < prefs.idleMinutes * 60 * 1000) return;
    openOverlay(prefs.pinHash ? "locked" : "idle");
  }, 1000);

  window.addEventListener("keydown", function (e) {
    // 0) Esc fecha o painel do topo (se não houver protetor aberto nem captura de tecla em andamento)
    if (e.code === "Escape" && modalStack.length && !overlay.open && !capturing) {
      e.preventDefault();
      closeTopModal();
      return;
    }
    // 1) captura de nova tecla de bloqueio
    if (capturing) {
      e.preventDefault();
      if (e.code === "Escape") { setCapturing(false); return; }
      if (MODIFIER_CODES.indexOf(e.code) >= 0) return; // espera a tecla principal
      var isFn = /^F([1-9]|1[0-2])$/.test(e.code);
      if (!(e.ctrlKey || e.altKey || e.metaKey || isFn)) {
        $("hotkey-help").textContent = "Use Ctrl, Alt ou Meta junto com uma tecla (ou uma tecla F1 a F12).";
        return;
      }
      prefs.hotkey = { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey, code: e.code };
      savePrefs();
      $("hotkey-help").textContent = "Atalho salvo.";
      setCapturing(false);
      renderStatus();
      return;
    }
    // 2) tecla de bloqueio
    if (matchHotkey(e, prefs.hotkey)) {
      e.preventDefault();
      openOverlay("locked");
      return;
    }
    // 3) com o protetor aberto (ocioso/pré-visualização), qualquer tecla fecha; bloqueado, não.
    if (overlay.open && overlay.mode !== "locked") closeOverlay();
  });

  window.addEventListener("pointerdown", function () {
    if (overlay.open && overlay.mode !== "locked") closeOverlay();
  });

  // ---------- interface ----------

  function renderStatus() {
    var hk = formatHotkey(prefs.hotkey);
    var pin = prefs.pinHash ? "com PIN" : "sem PIN";
    // resumos nos botões da tela inicial
    $("tile-time-sum").textContent = (prefs.enabled ? prefs.idleMinutes + (prefs.idleMinutes === 1 ? " minuto" : " minutos") + " sem uso" : "Automático desligado") + " · " + hk;
    $("tile-pin-sum").textContent = prefs.pinHash ? "PIN definido" : "Sem PIN";
    var cur = findTheme(prefs.themeId);
    $("tile-themes-sum").textContent = cur ? "Em uso: " + cur.name : (themesLoaded ? "Nenhum tema disponível" : "Carregando…");
    $("status").textContent = prefs.enabled
      ? "Ativo: protege após " + prefs.idleMinutes + " min sem uso (" + pin + "). Atalho: " + hk + "."
      : "Automático desligado. Bloqueie com o atalho " + hk + " ou pelo botão (" + pin + ").";
  }

  function renderPin() {
    var has = !!prefs.pinHash;
    $("pin-state").textContent = has ? "PIN definido." : "Nenhum PIN definido.";
    $("pin-current-wrap").hidden = !has;
    $("pin-remove").hidden = !has;
  }

  function setMsg(id, text, kind) {
    var el = $(id);
    el.textContent = text;
    el.className = "msg" + (kind ? " " + kind : "");
  }

  function init() {
    // Tempo
    var sel = $("idle-minutes");
    IDLE_OPTIONS.forEach(function (m) {
      var o = document.createElement("option");
      o.value = String(m);
      o.textContent = m === 60 ? "1 hora" : m === 1 ? "1 minuto" : m + " minutos";
      sel.appendChild(o);
    });
    sel.value = String(prefs.idleMinutes);
    sel.addEventListener("change", function () {
      prefs.idleMinutes = Number(sel.value);
      savePrefs();
      renderStatus();
    });

    $("enabled").checked = prefs.enabled;
    $("enabled").addEventListener("change", function () {
      prefs.enabled = $("enabled").checked;
      savePrefs();
      renderStatus();
    });

    $("auto-fullscreen").checked = prefs.autoFullscreen;
    $("auto-fullscreen").addEventListener("change", function () {
      prefs.autoFullscreen = $("auto-fullscreen").checked;
      savePrefs();
    });

    // Tecla de bloqueio
    setCapturing(false);
    $("btn-hotkey").addEventListener("click", function () {
      setCapturing(!capturing);
      $("hotkey-help").textContent = capturing ? "Pressione a combinação desejada. Esc cancela." : "Clique em Alterar e pressione a combinação (use Ctrl, Alt ou Shift com uma tecla).";
    });
    $("btn-hotkey-reset").addEventListener("click", function () {
      prefs.hotkey = clone(DEFAULT_HOTKEY);
      savePrefs();
      setCapturing(false);
      renderStatus();
    });

    // Botões do topo
    $("btn-lock").addEventListener("click", function () { openOverlay("locked"); });
    $("btn-fullscreen").addEventListener("click", function () {
      if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
      else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(function () {});
    });

    // PIN
    $("pin-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var next = $("pin-new").value;
      var confirm = $("pin-confirm").value;
      if (next.length < 4 || next.length > 12) { setMsg("pin-msg", "O PIN precisa ter de 4 a 12 caracteres.", "err"); return; }
      if (next !== confirm) { setMsg("pin-msg", "A confirmação não bate com o PIN.", "err"); return; }
      verifyPin($("pin-current").value).then(function (ok) {
        if (!ok) { setMsg("pin-msg", "PIN atual incorreto.", "err"); return; }
        var salt = newSalt();
        return hashPin(next, salt).then(function (hash) {
          prefs.pinSalt = salt;
          prefs.pinHash = hash;
          savePrefs();
          $("pin-form").reset();
          renderPin();
          renderStatus();
          setMsg("pin-msg", "PIN salvo.", "ok");
        });
      });
    });
    $("pin-remove").addEventListener("click", function () {
      verifyPin($("pin-current").value).then(function (ok) {
        if (!ok) { setMsg("pin-msg", "Informe o PIN atual para remover.", "err"); return; }
        prefs.pinHash = "";
        prefs.pinSalt = "";
        savePrefs();
        $("pin-form").reset();
        renderPin();
        renderStatus();
        setMsg("pin-msg", "PIN removido.", "ok");
      });
    });

    // Tema por endereço
    $("custom-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var name = $("custom-name").value.trim();
      var url = $("custom-url").value.trim();
      if (!name) { setMsg("custom-msg", "Informe um nome.", "err"); return; }
      if (!validThemeUrl(url)) { setMsg("custom-msg", "Use https:// (ou http://localhost).", "err"); return; }
      if (prefs.customThemes.length >= 20) { setMsg("custom-msg", "Limite de 20 temas por endereço.", "err"); return; }
      prefs.customThemes.push({ id: "custom-" + Date.now().toString(36), name: name, url: url });
      savePrefs();
      $("custom-form").reset();
      renderThemes();
      setMsg("custom-msg", "Tema adicionado.", "ok");
    });

    renderPin();
    renderStatus();

    // Botões da tela inicial abrem os painéis.
    Array.prototype.forEach.call(document.querySelectorAll("[data-open]"), function (btn) {
      btn.addEventListener("click", function () { openModal(btn.getAttribute("data-open")); });
    });
    // Cada painel fecha pelo ×, e pelo clique no fundo escuro quando é o do topo.
    Array.prototype.forEach.call(document.querySelectorAll(".modal"), function (el) {
      var closeBtn = el.querySelector("[data-close-modal]");
      if (closeBtn) closeBtn.addEventListener("click", function () {
        if (el.id === "options-card") closeOptions();
        else closeModalEl(el.id);
      });
      el.addEventListener("mousedown", function (e) {
        if (e.target === el && topModal() === el.id) closeTopModal();
      });
    });

    $("options-reset").addEventListener("click", function () {
      delete prefs.themeOptions[prefs.themeId];
      savePrefs();
      renderOptions();
      if (overlay.open && overlay.theme && overlay.theme.id === prefs.themeId) postState();
    });

    // Lista de temas da pasta themes/ (precisa de servidor local; fetch não funciona em file://).
    fetch("themes/themes.json", { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        var all = Array.isArray(data.themes) ? data.themes.filter(function (t) { return t && t.id && t.name && t.path; }) : [];
        return filterAvailable(all).then(function (r) {
          builtinThemes = r.kept;
          hiddenThemes = r.hidden;
        });
      })
      .catch(function () {
        setMsg("custom-msg", "Não consegui ler themes/themes.json. Abra o app por um servidor local (veja o README).", "err");
      })
      .then(function () {
        themesLoaded = true;
        renderThemes();
        renderOptions(); // fechado no início; abre ao usar ou personalizar
        renderStatus();  // atualiza o resumo do botão Temas, agora que a lista carregou
        // Atalhos de URL, úteis para testar: ?preview=<id do tema> e ?lock=1
        var params = new URLSearchParams(location.search);
        if (params.get("preview")) openOverlay("preview", params.get("preview"));
        else if (params.get("lock")) openOverlay("locked");
      });
  }

  init();
})();
