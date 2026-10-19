// calc.js — motor puro da calculadora (sem DOM).
// Script clássico (sem import/export): publica a API em globalThis.Calc.
// Usado pelo app (navegador, via <script src>) e pelos testes (node:vm).
// Nenhuma dependência externa, sem eval/Function.
(function (root) {

class CalcError extends Error {
  constructor(message) {
    super(message);
    this.name = "CalcError";
  }
}

const CONSTANTS = { pi: Math.PI, e: Math.E };

function toRadians(x) {
  return (x * Math.PI) / 180;
}

function trig(fn, x, opts) {
  const rad = opts && opts.angleMode === "rad" ? x : toRadians(x);
  const r = Math[fn](rad);
  if (!isFinite(r)) throw new CalcError("Valor indefinido");
  return r;
}

const FUNCTIONS = {
  sin: (x, opts) => trig("sin", x, opts),
  cos: (x, opts) => trig("cos", x, opts),
  tan: (x, opts) => trig("tan", x, opts),
  sqrt: (x) => {
    if (x < 0) throw new CalcError("Raiz de número negativo");
    return Math.sqrt(x);
  },
  log: (x) => {
    if (x <= 0) throw new CalcError("Logaritmo inválido");
    return Math.log10(x);
  },
  ln: (x) => {
    if (x <= 0) throw new CalcError("Logaritmo inválido");
    return Math.log(x);
  },
  abs: (x) => Math.abs(x),
};

function factorial(n) {
  if (!Number.isInteger(n) || n < 0) {
    throw new CalcError("Fatorial requer inteiro não negativo");
  }
  if (n > 170) throw new CalcError("Fatorial limitado a 170");
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

// Arredonda a 12 algarismos significativos e elimina "-0".
function clean(n) {
  if (typeof n !== "number" || !isFinite(n)) throw new CalcError("Valor inválido");
  if (n === 0) return 0;
  const r = Number(n.toPrecision(12));
  return r === 0 ? 0 : r;
}

function isLetter(c) {
  return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");
}

function isDigit(c) {
  return c >= "0" && c <= "9";
}

// ---------- Tokenizer ----------

function tokenize(input) {
  const s = String(input);
  const tokens = [];
  let i = 0;

  const readNumber = () => {
    let str = "";
    while (i < s.length && isDigit(s[i])) {
      str += s[i];
      i++;
    }
    if (i < s.length && (s[i] === "." || s[i] === ",")) {
      str += ".";
      i++;
      while (i < s.length && isDigit(s[i])) {
        str += s[i];
        i++;
      }
    }
    const v = parseFloat(str);
    if (!isFinite(v)) throw new CalcError("Número inválido");
    return { type: "num", value: v };
  };

  const readIdentifier = () => {
    let str = "";
    while (i < s.length && (isLetter(s[i]) || isDigit(s[i]))) {
      str += s[i];
      i++;
    }
    const id = str.toLowerCase();
    if (Object.hasOwn(FUNCTIONS, id)) return { type: "func", value: id };
    if (Object.hasOwn(CONSTANTS, id)) return { type: "const", value: id };
    throw new CalcError("Símbolo desconhecido: " + str);
  };

  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (isDigit(c)) {
      tokens.push(readNumber());
      continue;
    }
    if ((c === "." || c === ",") && i + 1 < s.length && isDigit(s[i + 1])) {
      tokens.push(readNumber());
      continue;
    }
    if (isLetter(c)) {
      tokens.push(readIdentifier());
      continue;
    }
    if (c === "×") { tokens.push({ type: "op", value: "*" }); i++; continue; }
    if (c === "÷") { tokens.push({ type: "op", value: "/" }); i++; continue; }
    if (c === "−") { tokens.push({ type: "op", value: "-" }); i++; continue; }
    if (c === "π") { tokens.push({ type: "const", value: "pi" }); i++; continue; }
    if (c === "√") { tokens.push({ type: "func", value: "sqrt" }); i++; continue; }
    if (c === "²") { tokens.push({ type: "op", value: "^" }); tokens.push({ type: "num", value: 2 }); i++; continue; }
    if (c === "ʸ") { tokens.push({ type: "op", value: "^" }); i++; continue; }
    if (c === "+") { tokens.push({ type: "op", value: "+" }); i++; continue; }
    if (c === "-") { tokens.push({ type: "op", value: "-" }); i++; continue; }
    if (c === "*") { tokens.push({ type: "op", value: "*" }); i++; continue; }
    if (c === "/") { tokens.push({ type: "op", value: "/" }); i++; continue; }
    if (c === "%") { tokens.push({ type: "op", value: "%" }); i++; continue; }
    if (c === "^") { tokens.push({ type: "op", value: "^" }); i++; continue; }
    if (c === "!") { tokens.push({ type: "op", value: "!" }); i++; continue; }
    if (c === "(") { tokens.push({ type: "lparen" }); i++; continue; }
    if (c === ")") { tokens.push({ type: "rparen" }); i++; continue; }
    throw new CalcError("Caractere inválido: " + c);
  }

  return tokens;
}

// ---------- Parser (descida recursiva) ----------

class Parser {
  constructor(tokens, opts) {
    this.t = tokens;
    this.i = 0;
    this.opts = opts || {};
  }

  peek() {
    return this.t[this.i];
  }

  next() {
    return this.t[this.i++];
  }

  parseExpression() {
    let left = this.parseTerm();
    for (;;) {
      const tk = this.peek();
      if (tk && tk.type === "op" && (tk.value === "+" || tk.value === "-")) {
        const op = this.next().value;
        const right = this.parseTerm();
        let rv = right.value;
        if (right.percent) rv = left.value * rv;
        left = { value: op === "+" ? left.value + rv : left.value - rv, percent: false };
      } else {
        break;
      }
    }
    return left;
  }

  parseTerm() {
    let left = this.parseFactor();
    for (;;) {
      const tk = this.peek();
      if (tk && tk.type === "op" && (tk.value === "*" || tk.value === "/")) {
        const op = this.next().value;
        const right = this.parseFactor();
        if (op === "*") {
          left = { value: left.value * right.value, percent: false };
        } else {
          if (right.value === 0) throw new CalcError("Divisão por zero");
          const r = left.value / right.value;
          if (!isFinite(r)) throw new CalcError("Divisão por zero");
          left = { value: r, percent: false };
        }
      } else {
        break;
      }
    }
    return left;
  }

  parseFactor() {
    const base = this.parseUnary();
    const tk = this.peek();
    if (tk && tk.type === "op" && tk.value === "^") {
      this.next();
      const exp = this.parseFactor();
      const r = Math.pow(base.value, exp.value);
      if (!isFinite(r)) throw new CalcError("Valor indefinido");
      return { value: r, percent: false };
    }
    return base;
  }

  parseUnary() {
    const tk = this.peek();
    if (tk && tk.type === "op" && (tk.value === "-" || tk.value === "+")) {
      const op = this.next().value;
      const operand = this.parseUnary();
      return { value: op === "-" ? -operand.value : operand.value, percent: operand.percent };
    }
    return this.parsePostfix();
  }

  parsePostfix() {
    let node = this.parsePrimary();
    for (;;) {
      const tk = this.peek();
      if (tk && tk.type === "op" && tk.value === "%") {
        this.next();
        node = { value: node.value / 100, percent: true };
      } else if (tk && tk.type === "op" && tk.value === "!") {
        this.next();
        node = { value: factorial(node.value), percent: false };
      } else {
        break;
      }
    }
    return node;
  }

  parsePrimary() {
    const tk = this.peek();
    if (!tk) throw new CalcError("Expressão incompleta");
    if (tk.type === "num") {
      this.next();
      return { value: tk.value, percent: false };
    }
    if (tk.type === "const") {
      this.next();
      return { value: CONSTANTS[tk.value], percent: false };
    }
    if (tk.type === "lparen") {
      this.next();
      const inner = this.parseExpression();
      const close = this.next();
      if (!close || close.type !== "rparen") throw new CalcError("Parênteses desbalanceados");
      return { value: inner.value, percent: inner.percent };
    }
    if (tk.type === "func") {
      this.next();
      const open = this.next();
      if (!open || open.type !== "lparen") throw new CalcError("Função requer parênteses");
      const arg = this.parseExpression();
      const close = this.next();
      if (!close || close.type !== "rparen") throw new CalcError("Parênteses desbalanceados");
      const fn = FUNCTIONS[tk.value];
      return { value: fn(arg.value, this.opts), percent: false };
    }
    throw new CalcError("Expressão inválida");
  }
}

// ---------- API do avaliador ----------

function evaluate(input, opts) {
  const tokens = tokenize(input);
  const parser = new Parser(tokens, opts);
  const result = parser.parseExpression();
  if (parser.i < tokens.length) throw new CalcError("Expressão inválida");
  return clean(result.value);
}

function tryEvaluate(input, opts) {
  try {
    return { ok: true, value: evaluate(input, opts) };
  } catch (e) {
    return { ok: false, error: e instanceof CalcError ? e.message : "Erro" };
  }
}

// ---------- Funções financeiras (puras) ----------

function monthlyRate(annualRate) {
  const a = Number(annualRate) || 0;
  if (a < 0) throw new CalcError("Taxa não pode ser negativa");
  if (a === 0) return 0;
  return Math.pow(1 + a, 1 / 12) - 1;
}

function sum(arr) {
  return arr.reduce((acc, v) => acc + v, 0);
}

function price(principal, annualRate, months, monthlyFee = 0) {
  if (months <= 0) throw new CalcError("Prazo deve ser maior que zero");
  const r = monthlyRate(annualRate);
  let base;
  if (r === 0) {
    base = principal / months;
  } else {
    const f = Math.pow(1 + r, months);
    base = (principal * r * f) / (f - 1);
  }
  const schedule = [];
  let balance = principal;
  for (let m = 1; m <= months; m++) {
    const interest = balance * r;
    let amortization = base - interest;
    let payment = base + monthlyFee;
    if (m === months) {
      amortization = balance;
      payment = interest + amortization + monthlyFee;
    }
    balance -= amortization;
    schedule.push({ month: m, payment, interest, principal: amortization, balance });
  }
  return {
    monthlyRate: r,
    firstPayment: schedule[0].payment,
    lastPayment: schedule[schedule.length - 1].payment,
    totalPaid: sum(schedule.map((s) => s.payment)),
    totalInterest: sum(schedule.map((s) => s.interest)),
    totalFees: monthlyFee * months,
    schedule,
  };
}

function sac(principal, annualRate, months, monthlyFee = 0) {
  if (months <= 0) throw new CalcError("Prazo deve ser maior que zero");
  const r = monthlyRate(annualRate);
  const amortization = principal / months;
  const schedule = [];
  let balance = principal;
  for (let m = 1; m <= months; m++) {
    const interest = balance * r;
    const payment = amortization + interest + monthlyFee;
    balance = m === months ? 0 : balance - amortization;
    schedule.push({ month: m, payment, interest, principal: amortization, balance });
  }
  return {
    monthlyRate: r,
    firstPayment: schedule[0].payment,
    lastPayment: schedule[schedule.length - 1].payment,
    totalPaid: sum(schedule.map((s) => s.payment)),
    totalInterest: sum(schedule.map((s) => s.interest)),
    totalFees: monthlyFee * months,
    schedule,
  };
}

function paymentCapacity(grossIncome, commitmentPct, annualRate, months) {
  if (months <= 0) throw new CalcError("Prazo deve ser maior que zero");
  const maxPayment = (grossIncome * commitmentPct) / 100;
  const r = monthlyRate(annualRate);
  let maxFinanced;
  if (r === 0) {
    maxFinanced = maxPayment * months;
  } else {
    maxFinanced = (maxPayment * (1 - Math.pow(1 + r, -months))) / r;
  }
  return { maxPayment, maxFinanced, monthlyRate: r };
}

function rentVsBuy({ propertyValue, monthlyRent, monthlyYieldRate, annualAppreciation, annualRentAdjustment, horizonYears }) {
  const months = Math.round(horizonYears * 12);
  const appreciationMonthly = monthlyRate(annualAppreciation);
  const rentAdjustMonthly = monthlyRate(annualRentAdjustment);
  const buyPatrimony = propertyValue * Math.pow(1 + appreciationMonthly, months);
  let cash = propertyValue;
  let rent = monthlyRent;
  for (let m = 0; m < months; m++) {
    cash = cash * (1 + monthlyYieldRate) - rent;
    rent = rent * (1 + rentAdjustMonthly);
  }
  const rentPatrimony = cash;
  const difference = buyPatrimony - rentPatrimony;
  let winner = "empate";
  if (difference > 0) winner = "compra";
  else if (difference < 0) winner = "aluguel";
  return { buyPatrimony, rentPatrimony, difference: Math.abs(difference), winner };
}

function rentalYield({ price, monthlyRent, monthlyCosts, vacancyPct }) {
  const grossAnnual = monthlyRent * 12;
  const netAnnual = monthlyRent * 12 * (1 - vacancyPct / 100) - monthlyCosts * 12;
  const grossYield = price > 0 ? grossAnnual / price : 0;
  const netYield = price > 0 ? netAnnual / price : 0;
  const payback = netAnnual > 0 ? price / netAnnual : null;
  return { grossAnnual, netAnnual, grossYield, netYield, payback };
}

function acquisitionCosts({ price, itbiPct, registroPct, appraisalFee }) {
  const itbi = (price * itbiPct) / 100;
  const registro = (price * registroPct) / 100;
  const total = itbi + registro + appraisalFee;
  const pct = price > 0 ? (total / price) * 100 : 0;
  return { itbi, registro, appraisalFee, total, pct };
}

function pricePerM2(price, area) {
  if (area <= 0) throw new CalcError("Área deve ser maior que zero");
  return price / area;
}

function compareByM2({ priceA, areaA, priceB, areaB }) {
  const m2a = pricePerM2(priceA, areaA);
  const m2b = pricePerM2(priceB, areaB);
  const diffPct = m2a > 0 ? ((m2b - m2a) / m2a) * 100 : 0;
  return { m2a, m2b, diffPct };
}

function capitalGain({ buyPrice, costs, sellPrice, irPct }) {
  const gain = sellPrice - buyPrice - costs;
  const tax = gain > 0 ? (gain * irPct) / 100 : 0;
  const net = gain - tax;
  return { gain, tax, net };
}

root.Calc = {
  CalcError,
  evaluate,
  tryEvaluate,
  monthlyRate,
  price,
  sac,
  paymentCapacity,
  rentVsBuy,
  rentalYield,
  acquisitionCosts,
  pricePerM2,
  compareByM2,
  capitalGain,
};

})(typeof globalThis !== "undefined" ? globalThis : window);
