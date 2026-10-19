// app.js — UI da calculadora (script clássico, sem import/export).
(function () {
"use strict";

const {
  tryEvaluate,
  price,
  sac,
  paymentCapacity,
  rentVsBuy,
  rentalYield,
  acquisitionCosts,
  pricePerM2,
  compareByM2,
  capitalGain,
} = window.Calc;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ---------- Formatadores pt-BR ----------

function formatBR(n) {
  if (!isFinite(n)) return "—";
  const rounded = Math.round(n * 1e10) / 1e10;
  let str;
  if (Number.isInteger(rounded) && Math.abs(rounded) < 1e15) {
    str = String(rounded);
  } else {
    str = rounded.toFixed(10).replace(/\.?0+$/, "");
  }
  const neg = str.startsWith("-");
  if (neg) str = str.slice(1);
  const parts = str.split(".");
  const int = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return (neg ? "-" : "") + int + (parts[1] ? "," + parts[1] : "");
}

function brl(n) {
  const v = Math.round(n * 100) / 100;
  const neg = v < 0;
  const a = Math.abs(v).toFixed(2).split(".");
  const int = a[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return (neg ? "-" : "") + int + "," + a[1];
}

function money(n) {
  return "R$ " + brl(n);
}

function pct(n) {
  return brl(n) + "%";
}

function years(n) {
  const v = Math.round(n * 10) / 10;
  return String(v).replace(".", ",") + " anos";
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

// ---------- Parsers de entrada ----------

function parseMoney(str) {
  const s = String(str ?? "").trim();
  if (!s) return NaN;
  const cleaned = s.replace(/[^\d,.-]/g, "");
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let intPart;
  let decPart;
  if (lastComma >= 0 && lastComma >= lastDot) {
    intPart = cleaned.slice(0, lastComma).replace(/\D/g, "");
    decPart = cleaned.slice(lastComma + 1).replace(/\D/g, "");
  } else if (lastDot >= 0) {
    intPart = cleaned.slice(0, lastDot).replace(/\D/g, "");
    decPart = cleaned.slice(lastDot + 1).replace(/\D/g, "");
  } else {
    intPart = cleaned.replace(/\D/g, "");
    decPart = "";
  }
  return parseFloat((intPart || "0") + "." + (decPart || "0"));
}

function readMoney(input) {
  return parseMoney(input.value);
}

function readInt(input) {
  const v = parseInt(input.value.replace(/\D/g, "") || "0", 10);
  return v;
}

function moneyOrZero(input) {
  const v = readMoney(input);
  return isNaN(v) ? 0 : v;
}

// ---------- Estado da calculadora ----------

const FUNC_NAMES = ["sqrt", "sin", "cos", "tan", "log", "ln", "abs"];

const calc = {
  expression: "",
  result: null,
  error: null,
  angleMode: "deg",
  history: [],
  justEvaluated: false,
};

let historyOpen = false;
let currentFinancing = null;

const exprEls = $$(".display-expr");
const resultEls = $$(".display-result");
const historyEls = $$(".history");
const historyLists = $$(".history-list");

// ---------- Renderização ----------

function renderExpr(expr) {
  return expr
    .replace(/sqrt\(/g, "√(")
    .replace(/\*/g, "×")
    .replace(/\//g, "÷")
    .replace(/-/g, "−")
    .replace(/\./g, ",")
    .replace(/pi/g, "π");
}

function refresh() {
  const exprText = renderExpr(calc.expression) || "\u00a0";
  exprEls.forEach((el) => {
    el.textContent = exprText;
  });

  let text = "0";
  let isError = false;
  if (calc.error) {
    text = calc.error;
    isError = true;
  } else if (calc.result !== null) {
    text = formatBR(calc.result);
  }
  resultEls.forEach((el) => {
    el.textContent = text;
    el.classList.toggle("error", isError);
    el.classList.toggle("small", !isError && text.length > 14);
    el.classList.toggle("xsmall", !isError && text.length > 22);
  });

  const items = calc.history.slice().reverse();
  const html = items
    .map((h, i) => {
      const realIndex = calc.history.length - 1 - i;
      return `<li data-index="${realIndex}" role="button" tabindex="0">
        <span class="h-expr">${esc(renderExpr(h.expr))}</span>
        <span class="h-result">${esc(formatBR(h.value))}</span>
      </li>`;
    })
    .join("");
  historyLists.forEach((ul) => {
    ul.innerHTML = html;
  });
}

// ---------- Entrada ----------

function startsNewValue(ch) {
  return /^[\d.]/.test(ch) || FUNC_NAMES.includes(ch) || ch === "pi" || ch === "e";
}

function resetIfNeeded(ch) {
  if (calc.justEvaluated) {
    if (startsNewValue(ch)) {
      calc.expression = "";
      calc.result = null;
      calc.error = null;
    } else if (calc.result !== null) {
      calc.expression = String(calc.result);
    }
    calc.justEvaluated = false;
  } else if (calc.error && startsNewValue(ch)) {
    calc.expression = "";
    calc.result = null;
    calc.error = null;
  }
}

function inputChar(ch) {
  resetIfNeeded(ch);
  if (ch === ".") {
    const last = calc.expression.slice(-1);
    if (last === "") {
      calc.expression = "0.";
      return;
    }
    if (/[+\-*/%^(]/.test(last)) {
      calc.expression += "0.";
      return;
    }
    if (!/\d/.test(last)) return;
    const m = calc.expression.match(/(\d*\.?\d*)$/);
    if (m && m[1].includes(".")) return;
    calc.expression += ".";
    return;
  }
  calc.expression += ch;
}

function inputFunc(name) {
  resetIfNeeded(name);
  calc.expression += name + "(";
}

function inputOperator(op) {
  if (calc.error) calc.error = null;
  if (calc.justEvaluated) {
    if (calc.result !== null) calc.expression = String(calc.result);
    calc.justEvaluated = false;
  }
  if (calc.expression === "") {
    if (op === "-") calc.expression = "-";
    return;
  }
  const last = calc.expression.slice(-1);
  if (/[+\-*/%^]/.test(last)) {
    if (op === "-" && last !== "-") {
      calc.expression += "-";
    } else {
      calc.expression = calc.expression.slice(0, -1) + op;
    }
  } else {
    calc.expression += op;
  }
}

function negate() {
  if (calc.error) calc.error = null;
  if (calc.justEvaluated && calc.result !== null) {
    calc.expression = String(-calc.result);
    calc.result = null;
    calc.justEvaluated = false;
    return;
  }
  if (calc.expression === "") return;
  const r = tryEvaluate(calc.expression, { angleMode: calc.angleMode });
  if (r.ok) {
    calc.expression = String(-r.value);
    calc.result = null;
    calc.error = null;
  }
}

function backspace() {
  if (calc.justEvaluated) calc.justEvaluated = false;
  const e = calc.expression;
  const tokens = ["sqrt", "sin", "cos", "tan", "log", "ln", "abs", "pi"];
  for (const t of tokens) {
    if (e.endsWith(t)) {
      calc.expression = e.slice(0, -t.length);
      return;
    }
  }
  calc.expression = e.slice(0, -1);
}

function clearAll() {
  calc.expression = "";
  calc.result = null;
  calc.error = null;
  calc.justEvaluated = false;
}

function evaluateNow() {
  if (calc.expression === "") return;
  let expr = calc.expression;
  const opens = (expr.match(/\(/g) || []).length;
  const closes = (expr.match(/\)/g) || []).length;
  if (opens > closes) expr += ")".repeat(opens - closes);
  const r = tryEvaluate(expr, { angleMode: calc.angleMode });
  if (r.ok) {
    calc.expression = expr;
    calc.result = r.value;
    calc.error = null;
    calc.history.push({ expr, value: r.value });
    if (calc.history.length > 30) calc.history.shift();
    calc.justEvaluated = true;
  } else {
    calc.error = r.error;
    calc.result = null;
  }
}

function handleKey(key) {
  if (/^[0-9]$/.test(key)) inputChar(key);
  else if (key === "decimal") inputChar(".");
  else if (key === "plus") inputOperator("+");
  else if (key === "minus") inputOperator("-");
  else if (key === "times") inputOperator("*");
  else if (key === "divide") inputOperator("/");
  else if (key === "percent") inputChar("%");
  else if (key === "lparen") inputChar("(");
  else if (key === "rparen") inputChar(")");
  else if (key === "sqrt") inputFunc("sqrt");
  else if (key === "sin") inputFunc("sin");
  else if (key === "cos") inputFunc("cos");
  else if (key === "tan") inputFunc("tan");
  else if (key === "log") inputFunc("log");
  else if (key === "ln") inputFunc("ln");
  else if (key === "abs") inputFunc("abs");
  else if (key === "sq") inputChar("^2");
  else if (key === "pow") inputChar("^");
  else if (key === "inv") inputChar("^(-1)");
  else if (key === "pi") inputChar("pi");
  else if (key === "euler") inputChar("e");
  else if (key === "fact") inputChar("!");
  else if (key === "negate") negate();
  else if (key === "clear") clearAll();
  else if (key === "backspace") backspace();
  else if (key === "equals") evaluateNow();
  refresh();
}

// ---------- Ações da barra ----------

async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch (e) {
    // bloqueado no sandbox; tenta fallback
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand && document.execCommand("copy");
    document.body.removeChild(ta);
    if (ok) return;
  } catch (e) {
    // sem clipboard: não faz nada visível
  }
}

function copyResult() {
  if (calc.result === null) return;
  copyText(formatBR(calc.result));
}

function toggleHistory() {
  historyOpen = !historyOpen;
  historyEls.forEach((el) => {
    el.hidden = !historyOpen;
  });
}

function clearHistory() {
  calc.history = [];
  refresh();
}

// ---------- Abas ----------

const TAB_ORDER = ["basica", "cientifica", "imobiliaria"];
const panels = {
  basica: $("#panel-basica"),
  cientifica: $("#panel-cientifica"),
  imobiliaria: $("#panel-imobiliaria"),
};
const tabs = $$(".tab");
let activeTab = "basica";

function setTab(id) {
  activeTab = id;
  tabs.forEach((t) => {
    const selected = t.id === "tab-" + id;
    t.setAttribute("aria-selected", selected ? "true" : "false");
    t.tabIndex = selected ? 0 : -1;
  });
  TAB_ORDER.forEach((k) => {
    panels[k].hidden = k !== id;
  });
}

// ---------- Máscaras ----------

function clearError(input) {
  input.classList.remove("invalid");
  const err = input.parentElement && input.parentElement.querySelector(".field-error");
  if (err) err.remove();
}

function setError(input, msg) {
  input.classList.add("invalid");
  let err = input.parentElement && input.parentElement.querySelector(".field-error");
  if (!err) {
    err = document.createElement("span");
    err.className = "field-error";
    input.insertAdjacentElement("afterend", err);
  }
  err.textContent = msg;
}

function clearAllErrors(fields) {
  fields.forEach((f) => {
    if (f.tagName === "INPUT") clearError(f);
  });
}

function moneyMask(el) {
  const apply = () => {
    clearError(el);
    let v = el.value.replace(/[^\d,]/g, "");
    const idx = v.indexOf(",");
    let int = idx >= 0 ? v.slice(0, idx) : v;
    let dec = idx >= 0 ? v.slice(idx + 1) : "";
    int = int.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    dec = dec.slice(0, 2);
    el.value = idx >= 0 ? int + "," + dec : int;
  };
  el.addEventListener("input", apply);
  el.addEventListener("blur", () => {
    apply();
    const v = el.value;
    if (!v) return;
    if (!v.includes(",")) el.value = v + ",00";
    else if (v.endsWith(",")) el.value = v + "00";
  });
}

function decimalMask(el) {
  el.addEventListener("input", () => {
    clearError(el);
    let v = el.value.replace(/[^\d,]/g, "");
    const idx = v.indexOf(",");
    let int = idx >= 0 ? v.slice(0, idx) : v;
    let dec = idx >= 0 ? v.slice(idx + 1) : "";
    int = int.replace(/^0+(?=\d)/, "");
    dec = dec.slice(0, 4);
    el.value = idx >= 0 ? int + "," + dec : int;
  });
}

function intMask(el) {
  el.addEventListener("input", () => {
    clearError(el);
    el.value = el.value.replace(/\D/g, "");
  });
}

function bindMasks() {
  $$("input[data-type='money']").forEach(moneyMask);
  $$("input[data-type='percent']").forEach(decimalMask);
  $$("input[data-type='num']").forEach(decimalMask);
  $$("input[data-type='int']").forEach(intMask);
}

// ---------- Imobiliária: tabela ----------

function scheduleTable(schedule) {
  const rows = schedule
    .map(
      (r) =>
        `<tr><td>${r.month}</td><td>${brl(r.payment)}</td><td>${brl(r.interest)}</td><td>${brl(r.principal)}</td><td>${brl(r.balance)}</td></tr>`
    )
    .join("");
  return `<table>
    <thead><tr><th>Mês</th><th>Parcela</th><th>Juros</th><th>Amortização</th><th>Saldo</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function scheduleCSV(schedule) {
  const header = "Mês;Parcela;Juros;Amortização;Saldo";
  const lines = schedule.map((r) =>
    [
      r.month,
      r.payment.toFixed(2).replace(".", ","),
      r.interest.toFixed(2).replace(".", ","),
      r.principal.toFixed(2).replace(".", ","),
      r.balance.toFixed(2).replace(".", ","),
    ].join(";")
  );
  return [header, ...lines].join("\n");
}

// ---------- Imobiliária: calculadoras ----------

function runFinancing() {
  const fields = $$("[data-calc-field='financing']");
  const get = (n) => fields.find((i) => i.name === n);
  const resultsEl = $("[data-results='financing']");
  clearAllErrors(fields);

  const prop = readMoney(get("propertyValue"));
  const entry = moneyOrZero(get("entry"));
  const entryMode = get("entryMode").value;
  const months = readInt(get("months"));
  const annualRatePct = readMoney(get("annualRate"));
  const monthlyFee = moneyOrZero(get("monthlyFee"));

  let ok = true;
  if (!(prop > 0)) {
    ok = false;
    setError(get("propertyValue"), "Informe um valor maior que zero.");
  }
  if (isNaN(entry)) {
    ok = false;
    setError(get("entry"), "Entrada inválida.");
  }
  if (!(months > 0)) {
    ok = false;
    setError(get("months"), "Prazo em meses maior que zero.");
  }
  if (!(annualRatePct >= 0) || isNaN(annualRatePct)) {
    ok = false;
    setError(get("annualRate"), "Taxa inválida.");
  }
  if (!ok) {
    resultsEl.innerHTML = "";
    return;
  }

  const downPayment = entryMode === "percent" ? (prop * entry) / 100 : entry;
  const financed = prop - downPayment;
  if (financed <= 0) {
    setError(get("entry"), "Entrada maior ou igual ao valor do imóvel.");
    resultsEl.innerHTML = "";
    return;
  }

  const annualRate = annualRatePct / 100;
  const p = price(financed, annualRate, months, monthlyFee);
  const s = sac(financed, annualRate, months, monthlyFee);
  currentFinancing = { price: p, sac: s };

  const card = (title, data) => `
    <div class="card">
      <h4>${title}</h4>
      <div class="big">${money(data.firstPayment)}</div>
      <div class="row"><span>1ª parcela</span><span class="val">${brl(data.firstPayment)}</span></div>
      <div class="row"><span>Última parcela</span><span class="val">${brl(data.lastPayment)}</span></div>
      <div class="row"><span>Total pago</span><span class="val">${brl(data.totalPaid)}</span></div>
      <div class="row"><span>Total de juros</span><span class="val">${brl(data.totalInterest)}</span></div>
    </div>`;

  resultsEl.innerHTML = `
    <div class="cards">
      ${card("Price", p)}
      ${card("SAC", s)}
    </div>
    <div class="cards one">
      <div class="card">
        <div class="row"><span>Valor financiado</span><span class="val">${brl(financed)}</span></div>
        <div class="row"><span>Diferença de juros (SAC − Price)</span><span class="val">${brl(s.totalInterest - p.totalInterest)}</span></div>
      </div>
    </div>
    <div class="amort">
      <div class="amort-head">
        <h4>Tabela de amortização</h4>
        <div class="segmented">
          <button class="seg active" type="button" data-scheme="price">Price</button>
          <button class="seg" type="button" data-scheme="sac">SAC</button>
        </div>
        <button class="btn ghost small" type="button" data-export>Exportar CSV</button>
      </div>
      <div class="table-scroll">${scheduleTable(p.schedule)}</div>
    </div>`;
}

function runCapacity() {
  const fields = $$("[data-calc-field='capacity']");
  const get = (n) => fields.find((i) => i.name === n);
  const resultsEl = $("[data-results='capacity']");
  clearAllErrors(fields);

  const grossIncome = readMoney(get("grossIncome"));
  const commitmentPct = readMoney(get("commitmentPct"));
  const months = readInt(get("months"));
  const annualRatePct = readMoney(get("annualRate"));
  const entry = moneyOrZero(get("entry"));

  let ok = true;
  if (!(grossIncome > 0)) {
    ok = false;
    setError(get("grossIncome"), "Informe a renda.");
  }
  if (!(commitmentPct > 0) || isNaN(commitmentPct)) {
    ok = false;
    setError(get("commitmentPct"), "Percentual inválido.");
  }
  if (!(months > 0)) {
    ok = false;
    setError(get("months"), "Prazo inválido.");
  }
  if (!(annualRatePct >= 0) || isNaN(annualRatePct)) {
    ok = false;
    setError(get("annualRate"), "Taxa inválida.");
  }
  if (!ok) {
    resultsEl.innerHTML = "";
    return;
  }

  const cap = paymentCapacity(grossIncome, commitmentPct, annualRatePct / 100, months);
  const estimated = cap.maxFinanced + entry;
  resultsEl.innerHTML = `
    <div class="cards one">
      <div class="card">
        <div class="row"><span>Parcela máxima</span><span class="val">${brl(cap.maxPayment)}</span></div>
        <div class="row"><span>Valor máximo financiável</span><span class="val">${brl(cap.maxFinanced)}</span></div>
        <div class="row"><span>Valor estimado do imóvel (com entrada)</span><span class="val">${brl(estimated)}</span></div>
      </div>
    </div>`;
}

function runRentBuy() {
  const fields = $$("[data-calc-field='rentbuy']");
  const get = (n) => fields.find((i) => i.name === n);
  const resultsEl = $("[data-results='rentbuy']");
  clearAllErrors(fields);

  const propertyValue = readMoney(get("propertyValue"));
  const monthlyRent = readMoney(get("monthlyRent"));
  const monthlyYieldRate = readMoney(get("monthlyYieldRate"));
  const annualAppreciation = readMoney(get("annualAppreciation"));
  const annualRentAdjustment = readMoney(get("annualRentAdjustment"));
  const horizonYears = readInt(get("horizonYears"));

  let ok = true;
  if (!(propertyValue > 0)) {
    ok = false;
    setError(get("propertyValue"), "Informe o valor do imóvel.");
  }
  if (!(monthlyRent > 0)) {
    ok = false;
    setError(get("monthlyRent"), "Informe o aluguel.");
  }
  if (!(monthlyYieldRate >= 0) || isNaN(monthlyYieldRate)) {
    ok = false;
    setError(get("monthlyYieldRate"), "Taxa inválida.");
  }
  if (!(annualAppreciation >= 0) || isNaN(annualAppreciation)) {
    ok = false;
    setError(get("annualAppreciation"), "Taxa inválida.");
  }
  if (!(annualRentAdjustment >= 0) || isNaN(annualRentAdjustment)) {
    ok = false;
    setError(get("annualRentAdjustment"), "Taxa inválida.");
  }
  if (!(horizonYears > 0)) {
    ok = false;
    setError(get("horizonYears"), "Horizonte inválido.");
  }
  if (!ok) {
    resultsEl.innerHTML = "";
    return;
  }

  const r = rentVsBuy({
    propertyValue,
    monthlyRent,
    monthlyYieldRate: monthlyYieldRate / 100,
    annualAppreciation: annualAppreciation / 100,
    annualRentAdjustment: annualRentAdjustment / 100,
    horizonYears,
  });

  const winnerText =
    r.winner === "compra"
      ? "Comprar é mais vantajoso"
      : r.winner === "aluguel"
        ? "Alugar e investir é mais vantajoso"
        : "Empate";
  const cls = r.winner === "compra" ? "winner" : r.winner === "aluguel" ? "loser" : "";

  resultsEl.innerHTML = `
    <div class="cards">
      <div class="card">
        <h4>Patrimônio comprando</h4>
        <div class="big">${brl(r.buyPatrimony)}</div>
      </div>
      <div class="card">
        <h4>Patrimônio alugando + investindo</h4>
        <div class="big">${brl(r.rentPatrimony)}</div>
      </div>
    </div>
    <div class="cards one">
      <div class="card">
        <div class="row"><span>Resultado</span><span class="val ${cls}">${winnerText}</span></div>
        <div class="row"><span>Diferença em R$</span><span class="val">${brl(r.difference)}</span></div>
      </div>
    </div>`;
}

function runRental() {
  const fields = $$("[data-calc-field='rental']");
  const get = (n) => fields.find((i) => i.name === n);
  const resultsEl = $("[data-results='rental']");
  clearAllErrors(fields);

  const priceVal = readMoney(get("price"));
  const monthlyRent = readMoney(get("monthlyRent"));
  const condo = moneyOrZero(get("condo"));
  const iptu = moneyOrZero(get("iptu"));
  const maintenance = moneyOrZero(get("maintenance"));
  const vacancyPct = moneyOrZero(get("vacancyPct"));

  let ok = true;
  if (!(priceVal > 0)) {
    ok = false;
    setError(get("price"), "Informe o preço de compra.");
  }
  if (!(monthlyRent > 0)) {
    ok = false;
    setError(get("monthlyRent"), "Informe o aluguel.");
  }
  if (!(vacancyPct >= 0 && vacancyPct <= 100)) {
    ok = false;
    setError(get("vacancyPct"), "Entre 0 e 100.");
  }
  if (!ok) {
    resultsEl.innerHTML = "";
    return;
  }

  const monthlyCosts = condo + iptu / 12 + maintenance;
  const r = rentalYield({ price: priceVal, monthlyRent, monthlyCosts, vacancyPct });

  resultsEl.innerHTML = `
    <div class="cards one">
      <div class="card">
        <div class="row"><span>Renda bruta anual</span><span class="val">${brl(r.grossAnnual)}</span></div>
        <div class="row"><span>Renda líquida anual</span><span class="val">${brl(r.netAnnual)}</span></div>
        <div class="row"><span>Yield bruto (a.a.)</span><span class="val">${pct(r.grossYield * 100)}</span></div>
        <div class="row"><span>Yield líquido (a.a.)</span><span class="val">${pct(r.netYield * 100)}</span></div>
        <div class="row"><span>Payback</span><span class="val">${r.payback === null ? "—" : years(r.payback)}</span></div>
      </div>
    </div>`;
}

function runAcq() {
  const fields = $$("[data-calc-field='acq']");
  const get = (n) => fields.find((i) => i.name === n);
  const resultsEl = $("[data-results='acq']");
  clearAllErrors(fields);

  const priceVal = readMoney(get("price"));
  const itbiPct = moneyOrZero(get("itbiPct"));
  const registroPct = moneyOrZero(get("registroPct"));
  const appraisalFee = moneyOrZero(get("appraisalFee"));

  let ok = true;
  if (!(priceVal > 0)) {
    ok = false;
    setError(get("price"), "Informe o valor do imóvel.");
  }
  if (!ok) {
    resultsEl.innerHTML = "";
    return;
  }

  const c = acquisitionCosts({ price: priceVal, itbiPct, registroPct, appraisalFee });
  resultsEl.innerHTML = `
    <div class="cards one">
      <div class="card">
        <div class="row"><span>ITBI</span><span class="val">${brl(c.itbi)}</span></div>
        <div class="row"><span>Registro/escritura</span><span class="val">${brl(c.registro)}</span></div>
        <div class="row"><span>Avaliação bancária</span><span class="val">${brl(c.appraisalFee)}</span></div>
        <div class="row"><span>Total de custos</span><span class="val">${brl(c.total)}</span></div>
        <div class="row"><span>% sobre o imóvel</span><span class="val">${pct(c.pct)}</span></div>
      </div>
    </div>`;
}

function runM2() {
  const fields = $$("[data-calc-field='m2']");
  const get = (n) => fields.find((i) => i.name === n);
  const resultsEl = $("[data-results='m2']");
  clearAllErrors(fields);

  const priceInput = get("price");
  const areaInput = get("area");
  const priceM2Input = get("priceM2");

  const priceVal = readMoney(priceInput);
  const areaVal = readMoney(areaInput);
  const priceM2Val = readMoney(priceM2Input);

  const filled = [priceVal, areaVal, priceM2Val].filter((v) => isFinite(v)).length;
  if (filled < 2) {
    resultsEl.innerHTML = `<p class="hint">Preencha ao menos dois valores para converter.</p>`;
    return;
  }

  let outKey;
  if (isNaN(priceM2Val)) outKey = "priceM2";
  else if (isNaN(priceVal)) outKey = "price";
  else if (isNaN(areaVal)) outKey = "area";
  else outKey = "priceM2";

  let price = priceVal;
  let area = areaVal;
  let priceM2 = priceM2Val;

  if (outKey === "priceM2") {
    if (!(area > 0)) {
      setError(areaInput, "Área maior que zero.");
      resultsEl.innerHTML = "";
      return;
    }
    priceM2 = pricePerM2(price, area);
  } else if (outKey === "price") {
    price = priceM2Val * areaVal;
  } else {
    if (!(priceM2Val > 0)) {
      setError(priceM2Input, "Preço/m² maior que zero.");
      resultsEl.innerHTML = "";
      return;
    }
    area = priceVal / priceM2Val;
  }

  if (outKey === "priceM2") priceM2Input.value = brl(priceM2);
  else if (outKey === "price") priceInput.value = brl(price);
  else areaInput.value = formatBR(area);

  resultsEl.innerHTML = `
    <div class="cards one">
      <div class="card">
        <div class="row"><span>Preço total</span><span class="val">${brl(price)}</span></div>
        <div class="row"><span>Área</span><span class="val">${formatBR(area)} m²</span></div>
        <div class="row"><span>Preço por m²</span><span class="val">${brl(priceM2)}</span></div>
      </div>
    </div>`;
}

function runCompare() {
  const fields = $$("[data-calc-field='compare']");
  const get = (n) => fields.find((i) => i.name === n);
  const resultsEl = $("[data-results='compare']");
  clearAllErrors(fields);

  const priceA = readMoney(get("priceA"));
  const areaA = readMoney(get("areaA"));
  const priceB = readMoney(get("priceB"));
  const areaB = readMoney(get("areaB"));

  let ok = true;
  if (!(priceA > 0)) {
    ok = false;
    setError(get("priceA"), "Informe o preço.");
  }
  if (!(areaA > 0)) {
    ok = false;
    setError(get("areaA"), "Informe a área.");
  }
  if (!(priceB > 0)) {
    ok = false;
    setError(get("priceB"), "Informe o preço.");
  }
  if (!(areaB > 0)) {
    ok = false;
    setError(get("areaB"), "Informe a área.");
  }
  if (!ok) {
    resultsEl.innerHTML = "";
    return;
  }

  const cmp = compareByM2({ priceA, areaA, priceB, areaB });
  const cheaper = cmp.diffPct >= 0 ? "A" : "B";
  resultsEl.innerHTML = `
    <div class="cards">
      <div class="card">
        <h4>Imóvel A — preço/m²</h4>
        <div class="big">${brl(cmp.m2a)}</div>
      </div>
      <div class="card">
        <h4>Imóvel B — preço/m²</h4>
        <div class="big">${brl(cmp.m2b)}</div>
      </div>
    </div>
    <div class="cards one">
      <div class="card">
        <div class="row"><span>Diferença (B vs A)</span><span class="val">${pct(Math.abs(cmp.diffPct))}</span></div>
        <div class="row"><span>Mais barato por m²</span><span class="val">Imóvel ${cheaper}</span></div>
      </div>
    </div>`;
}

function runGain() {
  const fields = $$("[data-calc-field='gain']");
  const get = (n) => fields.find((i) => i.name === n);
  const resultsEl = $("[data-results='gain']");
  clearAllErrors(fields);

  const buyPrice = moneyOrZero(get("buyPrice"));
  const costs = moneyOrZero(get("costs"));
  const sellPrice = moneyOrZero(get("sellPrice"));
  const irPct = moneyOrZero(get("irPct"));

  if (!(sellPrice >= 0)) {
    setError(get("sellPrice"), "Valor inválido.");
    resultsEl.innerHTML = "";
    return;
  }

  const g = capitalGain({ buyPrice, costs, sellPrice, irPct });
  const hasGain = g.gain > 0;
  resultsEl.innerHTML = `
    <div class="cards one">
      <div class="card">
        <div class="row"><span>Ganho de capital</span><span class="val ${hasGain ? "winner" : "loser"}">${hasGain ? brl(g.gain) : "Sem ganho"}</span></div>
        <div class="row"><span>IR (${pct(irPct)})</span><span class="val">${brl(g.tax)}</span></div>
        <div class="row"><span>Ganho líquido</span><span class="val">${brl(g.net)}</span></div>
      </div>
    </div>`;
}

const runners = {
  financing: runFinancing,
  capacity: runCapacity,
  rentbuy: runRentBuy,
  rental: runRental,
  acq: runAcq,
  m2: runM2,
  compare: runCompare,
  gain: runGain,
};

// ---------- Inicialização ----------

function init() {
  setTab("basica");
  bindMasks();
  refresh();

  $$(".key").forEach((btn) => {
    btn.addEventListener("click", () => handleKey(btn.dataset.key));
  });

  tabs.forEach((t) => {
    t.addEventListener("click", () => setTab(t.id.replace("tab-", "")));
    t.addEventListener("keydown", (e) => {
      const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
      if (!keys.includes(e.key)) return;
      e.preventDefault();
      let i = TAB_ORDER.indexOf(activeTab);
      if (e.key === "ArrowRight") i = (i + 1) % TAB_ORDER.length;
      else if (e.key === "ArrowLeft") i = (i - 1 + TAB_ORDER.length) % TAB_ORDER.length;
      else if (e.key === "Home") i = 0;
      else if (e.key === "End") i = TAB_ORDER.length - 1;
      setTab(TAB_ORDER[i]);
      $("#tab-" + TAB_ORDER[i]).focus();
    });
  });

  $$("[data-calc-run]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const runner = runners[btn.dataset.calcRun];
      if (runner) runner();
    });
  });

  document.addEventListener("click", (e) => {
    const actionEl = e.target.closest("[data-action]");
    if (actionEl) {
      const action = actionEl.dataset.action;
      if (action === "history") toggleHistory();
      else if (action === "copy") copyResult();
      else if (action === "clear-history") clearHistory();
    }

    const histItem = e.target.closest(".history-list li");
    if (histItem) {
      const h = calc.history[Number(histItem.dataset.index)];
      if (h) {
        calc.expression = String(h.value);
        calc.result = h.value;
        calc.error = null;
        calc.justEvaluated = true;
        refresh();
      }
    }

    const angleBtn = e.target.closest("[data-angle]");
    if (angleBtn) {
      calc.angleMode = angleBtn.dataset.angle;
      $$("[data-angle]").forEach((b) => b.classList.toggle("active", b.dataset.angle === calc.angleMode));
    }

    const schemeBtn = e.target.closest("[data-scheme]");
    if (schemeBtn) {
      const scheme = schemeBtn.dataset.scheme;
      const segs = schemeBtn.closest(".segmented").querySelectorAll(".seg");
      segs.forEach((s) => s.classList.toggle("active", s === schemeBtn));
      const container = schemeBtn.closest(".amort").querySelector(".table-scroll");
      if (container && currentFinancing) container.innerHTML = scheduleTable(currentFinancing[scheme].schedule);
    }

    const exportBtn = e.target.closest("[data-export]");
    if (exportBtn) {
      const active = exportBtn.closest(".amort").querySelector(".seg.active");
      const scheme = active ? active.dataset.scheme : "price";
      if (currentFinancing) copyText(scheduleCSV(currentFinancing[scheme].schedule));
    }
  });

  document.addEventListener("keydown", (e) => {
    if (activeTab === "imobiliaria") return;
    if (e.target && e.target.closest && e.target.closest("input, textarea, select")) return;
    const k = e.key;
    if (k >= "0" && k <= "9") {
      e.preventDefault();
      handleKey(k);
      return;
    }
    const map = {
      ".": "decimal",
      ",": "decimal",
      "+": "plus",
      "-": "minus",
      "*": "times",
      "/": "divide",
      "%": "percent",
      "(": "lparen",
      ")": "rparen",
      "^": "pow",
      "!": "fact",
      Enter: "equals",
      "=": "equals",
      Backspace: "backspace",
      Escape: "clear",
    };
    if (map[k]) {
      e.preventDefault();
      handleKey(map[k]);
    }
  });
}

init();

})();
