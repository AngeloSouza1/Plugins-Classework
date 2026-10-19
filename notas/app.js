// app.js — notas rápidas (script clássico, sem import/export).
// Lê/escreve as mesmas notas da Minha Página via escopos notes:read e notes:write.
(function () {
"use strict";

var $ = function (id) { return document.getElementById(id); };
var listEl = $("list");
var statusEl = $("status");
var form = $("add-form");
var input = $("add-input");
var addBtn = $("add-btn");
var clearBtn = $("clear-done");
var countEl = $("count");

var dc = DescordePlugin.init();
var notes = [];
var filter = "all";
var editingId = null;
var canWrite = false;

function setStatus(text, isError) {
  statusEl.textContent = text || "";
  statusEl.className = "status" + (isError ? " err" : "");
  statusEl.hidden = !text;
}

function fail(e) {
  setStatus(e && e.code === "REVOKED_OR_SCOPE" ? "Sem permissão. Reabra o plugin para autorizar de novo." : (e && e.message) || "Erro", true);
}

function visible() {
  return notes.filter(function (n) {
    return filter === "all" || (filter === "done" ? n.done : !n.done);
  });
}

function render() {
  listEl.textContent = "";
  var items = visible();
  items.forEach(function (n) { listEl.appendChild(renderItem(n)); });
  var open = notes.filter(function (n) { return !n.done; }).length;
  countEl.textContent = notes.length ? open + " pendente" + (open === 1 ? "" : "s") + " de " + notes.length : "";
  clearBtn.hidden = !canWrite || !notes.some(function (n) { return n.done; });
  if (!items.length && statusEl.hidden) {
    var empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = notes.length ? "Nenhuma nota neste filtro." : "Nenhuma nota ainda.";
    listEl.appendChild(empty);
  }
}

function renderItem(n) {
  var row = document.createElement("div");
  row.className = "item" + (n.done ? " done" : "");

  var box = document.createElement("input");
  box.type = "checkbox";
  box.checked = n.done;
  box.disabled = !canWrite;
  box.setAttribute("aria-label", "Concluir nota");
  box.addEventListener("change", function () { save(n, { done: box.checked }); });
  row.appendChild(box);

  if (editingId === n.id) {
    var edit = document.createElement("input");
    edit.className = "item-edit";
    edit.type = "text";
    edit.maxLength = 300;
    edit.value = n.text;
    var finished = false;
    var finish = function (commit) {
      if (finished) return;
      finished = true;
      editingId = null;
      var text = edit.value.trim();
      if (commit && text && text !== n.text) save(n, { text: text }); else render();
    };
    edit.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") finish(true);
      else if (ev.key === "Escape") finish(false);
    });
    edit.addEventListener("blur", function () { finish(true); });
    row.appendChild(edit);
    setTimeout(function () { edit.focus(); edit.select(); }, 0);
  } else {
    var text = document.createElement("span");
    text.className = "item-text";
    text.textContent = n.text; // textContent: nunca interpreta HTML
    text.title = canWrite ? "Clique duas vezes para editar" : "";
    if (canWrite) text.addEventListener("dblclick", function () { editingId = n.id; render(); });
    row.appendChild(text);
  }

  if (canWrite) {
    var del = document.createElement("button");
    del.type = "button";
    del.className = "item-del";
    del.title = "Apagar nota";
    del.setAttribute("aria-label", "Apagar nota");
    del.textContent = "×";
    del.addEventListener("click", function () { remove(n); });
    row.appendChild(del);
  }
  return row;
}

function save(n, patch) {
  return dc.updateNote(n.id, patch).then(function (updated) {
    notes = notes.map(function (x) { return x.id === updated.id ? updated : x; });
    render();
  }).catch(function (e) { fail(e); load(); });
}

function remove(n) {
  return dc.deleteNote(n.id).then(function () {
    notes = notes.filter(function (x) { return x.id !== n.id; });
    render();
  }).catch(function (e) { fail(e); load(); });
}

function load() {
  return dc.notes().then(function (list) {
    notes = list;
    setStatus("");
    render();
  }).catch(fail);
}

form.addEventListener("submit", function (ev) {
  ev.preventDefault();
  var text = input.value.trim();
  if (!text || !canWrite) return;
  addBtn.disabled = true;
  dc.createNote(text).then(function (created) {
    notes.push(created);
    input.value = "";
    setStatus("");
    render();
  }).catch(fail).then(function () { addBtn.disabled = false; input.focus(); });
});

Array.prototype.forEach.call(document.querySelectorAll(".chip"), function (chip) {
  chip.addEventListener("click", function () {
    filter = chip.getAttribute("data-filter");
    Array.prototype.forEach.call(document.querySelectorAll(".chip"), function (c) {
      c.setAttribute("aria-pressed", String(c === chip));
    });
    render();
  });
});

clearBtn.addEventListener("click", function () {
  var done = notes.filter(function (n) { return n.done; });
  if (!done.length || !window.confirm("Apagar " + done.length + " nota(s) concluída(s)?")) return;
  Promise.all(done.map(function (n) { return dc.deleteNote(n.id); })).catch(fail).then(load);
});

dc.ready().then(function (session) {
  var scopes = session.scopes || [];
  if (!session.token || scopes.indexOf("notes:read") === -1) {
    setStatus("Este plugin precisa do escopo notes:read (e notes:write para editar). Peça ao administrador para cadastrá-los.", true);
    return;
  }
  canWrite = scopes.indexOf("notes:write") !== -1;
  input.disabled = addBtn.disabled = !canWrite;
  if (!canWrite) input.placeholder = "Somente leitura (sem permissão de escrita)";
  load().then(function () { if (canWrite) input.focus(); });
}).catch(function (e) {
  setStatus("Sem sessão do DESCORDE (abra este plugin dentro do app): " + e.message, true);
});
})();
