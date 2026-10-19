import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("./calc.js", import.meta.url)), "utf8");
const ctx = vm.createContext({});
vm.runInContext(src, ctx);

const {
  evaluate,
  tryEvaluate,
  monthlyRate,
  price,
  sac,
  paymentCapacity,
  rentalYield,
  acquisitionCosts,
  pricePerM2,
  compareByM2,
  capitalGain,
} = ctx.Calc;

function approx(actual, expected, eps = 1e-9, msg) {
  assert.ok(Math.abs(actual - expected) < eps, `${msg || ""} esperado ${expected}, obtido ${actual}`);
}

function ev(input, opts) {
  const r = tryEvaluate(input, opts);
  assert.ok(r.ok, `esperava sucesso para "${input}": ${r.error}`);
  return r.value;
}

function evError(input) {
  const r = tryEvaluate(input);
  assert.ok(!r.ok, `esperava erro para "${input}"`);
  return r.error;
}

// ---------- Expressões ----------

test("precedência: 2+3*4 = 14", () => {
  approx(ev("2+3*4"), 14);
});

test("parênteses: (2+3)*4 = 20", () => {
  approx(ev("(2+3)*4"), 20);
});

test("menos unário: -3+5 = 2", () => {
  approx(ev("-3+5"), 2);
});

test("percentual aditivo: 200+10% = 220", () => {
  approx(ev("200+10%"), 220);
});

test("percentual subtrativo: 200-10% = 180", () => {
  approx(ev("200-10%"), 180);
});

test("percentual multiplicativo: 200*10% = 20", () => {
  approx(ev("200*10%"), 20);
});

test("percentual isolado: 50% = 0,5", () => {
  approx(ev("50%"), 0.5);
});

test("vírgula como decimal: 0,1+0,2 = 0,3", () => {
  approx(ev("0,1+0,2"), 0.3);
});

test("ponto flutuante sem ruído: 0.1+0.2 = 0.3", () => {
  approx(ev("0.1+0.2"), 0.3);
});

test("divisão por zero → erro", () => {
  const err = evError("1/0");
  assert.match(err, /zero/i);
});

test("parênteses desbalanceados → erro", () => {
  const err = evError("(2+3");
  assert.match(err, /parênteses/i);
});

test("entrada maliciosa alert(1) → erro, nunca executa", () => {
  const err = evError("alert(1)");
  assert.match(err, /desconhecido/i);
});

test("entrada maliciosa constructor → erro, nunca executa", () => {
  const err = evError("constructor");
  assert.match(err, /desconhecido/i);
});

test("expoente com precedência: 2*3^2 = 18", () => {
  approx(ev("2*3^2"), 18);
});

test("expoente associativo à direita: 2^3^2 = 512", () => {
  approx(ev("2^3^2"), 512);
});

// ---------- Científica ----------

test("sin(30) em graus = 0,5", () => {
  approx(ev("sin(30)"), 0.5);
});

test("sin(pi/2) em radianos = 1", () => {
  approx(ev("sin(pi/2)", { angleMode: "rad" }), 1);
});

test("sqrt(9) = 3", () => {
  approx(ev("sqrt(9)"), 3);
});

test("log(100) = 2", () => {
  approx(ev("log(100)"), 2);
});

test("ln(e) = 1", () => {
  approx(ev("ln(e)"), 1);
});

test("5! = 120", () => {
  approx(ev("5!"), 120);
});

test("abs(-7) = 7", () => {
  approx(ev("abs(-7)"), 7);
});

// ---------- Price ----------

test("Price: parcela confere com fórmula direta", () => {
  const P = 200000;
  const annual = 0.1;
  const n = 360;
  const r = Math.pow(1 + annual, 1 / 12) - 1;
  const expected = (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  const res = price(P, annual, n);
  approx(res.firstPayment, expected, 0.01, "parcela");
});

test("Price: soma das amortizações = financiado; saldo final = 0", () => {
  const P = 200000;
  const res = price(P, 0.1, 360);
  const sumAmort = res.schedule.reduce((s, row) => s + row.principal, 0);
  approx(sumAmort, P, 0.01, "soma amortizações");
  approx(res.schedule[res.schedule.length - 1].balance, 0, 1e-9, "saldo final");
});

test("SAC: amortização constante, 1ª > última, saldo final 0", () => {
  const P = 200000;
  const n = 360;
  const res = sac(P, 0.1, n);
  approx(res.schedule[0].principal, P / n, 1e-9, "amortização constante");
  assert.ok(res.firstPayment > res.lastPayment, "primeira parcela deve ser maior que a última");
  approx(res.schedule[n - 1].balance, 0, 1e-9, "saldo final SAC");
});

test("taxa 0%: parcela = financiado/prazo", () => {
  const res = price(120000, 0, 120);
  approx(res.firstPayment, 1000, 1e-9, "parcela taxa zero");
});

test("capacidade: round-trip parcela máxima ≈ parcela gerada", () => {
  const cap = paymentCapacity(10000, 30, 0.1, 360);
  approx(cap.maxPayment, 3000, 1e-9, "parcela máxima");
  const res = price(cap.maxFinanced, 0.1, 360);
  approx(res.firstPayment, cap.maxPayment, 0.01, "round-trip");
});

// ---------- Rentabilidade / custos ----------

test("rentabilidade: números redondos", () => {
  const r = rentalYield({ price: 100000, monthlyRent: 1000, monthlyCosts: 0, vacancyPct: 0 });
  approx(r.grossAnnual, 12000, 1e-9, "renda bruta anual");
  approx(r.grossYield, 0.12, 1e-9, "yield bruto");
  approx(r.netYield, 0.12, 1e-9, "yield líquido");
  approx(r.payback, 100000 / 12000, 1e-9, "payback");
});

test("custos de aquisição: números redondos", () => {
  const c = acquisitionCosts({ price: 100000, itbiPct: 3, registroPct: 1, appraisalFee: 1000 });
  approx(c.itbi, 3000, 1e-9, "ITBI");
  approx(c.registro, 1000, 1e-9, "registro");
  approx(c.total, 5000, 1e-9, "total");
  approx(c.pct, 5, 1e-9, "percentual");
});

test("preço por m² e comparação", () => {
  approx(pricePerM2(300000, 75), 4000, 1e-9, "preço/m²");
  const cmp = compareByM2({ priceA: 300000, areaA: 75, priceB: 450000, areaB: 90 });
  approx(cmp.m2a, 4000, 1e-9, "m² A");
  approx(cmp.m2b, 5000, 1e-9, "m² B");
  approx(cmp.diffPct, 25, 1e-9, "diferença %");
});

test("ganho de capital", () => {
  const g = capitalGain({ buyPrice: 300000, costs: 15000, sellPrice: 400000, irPct: 15 });
  approx(g.gain, 85000, 1e-9, "ganho");
  approx(g.tax, 12750, 1e-9, "imposto");
  approx(g.net, 72250, 1e-9, "líquido");
});

test("taxa mensal equivalente", () => {
  approx(monthlyRate(0), 0, 1e-12);
  approx(Math.pow(1 + monthlyRate(0.1), 12), 1.1, 1e-9);
});
