const APP_VERSION='v10';
console.log('math tool', APP_VERSION);

// English comments as requested.
const $ = (id) => document.getElementById(id);
let lastRender = null; // { exactHtml, decHtml, mode:'exact'|'dec', canToggle:boolean }

function clearPlot() { $("plot").innerHTML = ""; }

function renderOutput(html) {
  const el = $("out");
  el.innerHTML = html;
  if (typeof renderMathInElement === "function") {
    try {
      renderMathInElement(el, {
        delimiters: [{ left: "$$", right: "$$", display: true }, { left: "$", right: "$", display: false }],
        throwOnError: false
      });
    } catch {}
  }
}

function escapeHtml(s) {
  return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
}

function linesToHtml(lines) {
  return lines.map(item => item.type === "latex"
    ? `$$${item.value}$$`
    : escapeHtml(item.value).replace(/\n/g, "<br>")
  ).join("<br>");
}

function setToggle(canToggle, label) {
  const btn = $("toggleBtn");
  btn.disabled = !canToggle;
  btn.textContent = label || "đổi sang thập phân";
}

// ---------- preprocessing (input) ----------
function preprocessMinus(s) {
  // Normalize various minus/dash characters to ASCII '-'
  return String(s).replace(/[−–—]/g, "-");
}

function preprocessSqrt(s) {
  // Normalize sqrt symbol (√) to "sqrt(...)"
  if (!s || typeof s !== "string") return s;
  let t = s;

  // √( ... ) -> sqrt( ... )
  t = t.replace(/[√\u221A]\s*\(/g, "sqrt(");

  // √x or √2 or √2,3 -> sqrt(x) / sqrt(2) / sqrt(2.3)
  t = t.replace(/[√\u221A]\s*([a-zA-Z_][a-zA-Z0-9_]*|\d+(?:[\.,]\d+)?)/g, "sqrt($1)");



  // \sqrt{...} or \sqrt(...) -> sqrt(...)
  t = t.replace(/\\sqrt\s*\{([^{}]+)\}/g, 'sqrt($1)');
  t = t.replace(/\\sqrt\s*\(([^()]+)\)/g, 'sqrt($1)');

  // √{...} -> sqrt(...)
  t = t.replace(/[√\u221A]\s*\{([^{}]+)\}/g, 'sqrt($1)');

  // sqrt x, sqrt2, ... -> sqrt(x)
  t = t.replace(/\bsqrt\s+([a-zA-Z_][a-zA-Z0-9_]*|\d+(?:[\.,]\d+)?)/g, 'sqrt($1)');
  t = t.replace(/\bsqrt([a-zA-Z_][a-zA-Z0-9_]*|\d+(?:[\.,]\d+)?)/g, 'sqrt($1)');

  return t;
}

function preprocessMul(s) {
  let t = s.replaceAll("×", "*").replaceAll("·", "*");
  // Treat dot as multiplication ONLY when it is not a decimal dot.
  // Keep digit.digit as a decimal number (e.g., 2.33).
  t = t.replace(/(\d)\s*\.\s*([a-zA-Z_])/g, "$1*$2");
  t = t.replace(/([a-zA-Z_])\s*\.\s*(\d)/g, "$1*$2");
  t = t.replace(/([a-zA-Z_])\s*\.\s*([a-zA-Z_])/g, "$1*$2");
  return t;
}

function preprocessSuperscripts(s) {
  // Convert unicode superscripts (x², y³, x¹², ...) into caret powers (x^2, y^3, x^12)
  if (!s || typeof s !== "string") return s;
  const map = { "⁰":"0","¹":"1","²":"2","³":"3","⁴":"4","⁵":"5","⁶":"6","⁷":"7","⁸":"8","⁹":"9" };
  return s.replace(/([0-9a-zA-Z_\)\]])([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g, (_, base, sup) => {
    const digits = sup.split("").map(ch => map[ch] ?? "").join("");
    return digits ? `${base}^${digits}` : `${base}${sup}`;
  });
}


function preprocessDecimalComma(s) { return s.replace(/(\d),(\d)/g, "$1.$2"); }

function preprocessLogNames(s) {
  // Normalize common log/ln function names (case-insensitive) so the parser recognizes them.
  // We intentionally keep "log2(...)" etc here; base-handling is done later in evaluation.
  let t = String(s);
  t = t.replace(/\bLn\s*\(/gi, "ln(");
  t = t.replace(/\bLog\s*(?=\d|\()/gi, "log"); // "Log2(" or "Log("
  return t;
}


function preprocessAbs(s) {
  // Convert |...| into abs(...) so math.js/nerdamer can parse absolute value.
  // Keeps '||' unchanged (logical OR), although it's rarely used in this tool.
  let t = String(s);
  let out = '';
  const stack = [];
  const isOp = (ch) => !ch || /[+\-*/^=,;:(\[\{]/.test(ch);
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch !== '|') { out += ch; continue; }
    if (t[i+1] === '|') { out += '||'; i++; continue; }
    // Decide open vs close based on previous non-space char
    let j = out.length - 1;
    while (j >= 0 && /\s/.test(out[j])) j--;
    const prev = j >= 0 ? out[j] : '';
    const open = stack.length === 0 || isOp(prev);
    if (open) { out += 'abs(' ; stack.push('|'); }
    else { out += ')'; stack.pop(); }
  }
  while (stack.length) { out += ')'; stack.pop(); }
  return out;
}

function preprocessImplicitMul(s) {
  // Insert * for common implicit multiplications:
  // 5x, 2(x+1), (x+1)(x-1), 2sqrt(2), xsqrt(x)
  let t = s;

  // number followed by variable
  t = t.replace(/(\d)\s*([xyzt])/gi, "$1*$2");

  // number followed by '('
  t = t.replace(/(^|[^a-zA-Z0-9_])(\d)\s*\(/g, "$1$2*(");

  // ')' followed by number/variable/'('
  t = t.replace(/\)\s*(\d|[xyzt]|\()/gi, ")*$1");

  // standalone variable (x,y,z,t) followed by '('  -> x*(...)
  // IMPORTANT: avoid breaking function names like sqrt(2) where the trailing 't(' would match.
  t = t.replace(/(^|[^a-zA-Z0-9_])([xyzt])\s*\(/gi, "$1$2*(");

  // standalone variable followed by standalone variable (e.g., xy -> x*y)
  t = t.replace(/(^|[^a-zA-Z0-9_])([xyzt])\s*([xyzt])(?![a-zA-Z0-9_])/gi, "$1$2*$3");

  // exponent followed by variable (e.g., x^2y -> x^2*y)
  t = t.replace(/(\^\d+)\s*([xyzt])/gi, "$1*$2");

  // number or variable followed by function call (sqrt/sin/cos/...)
  t = t.replace(/(\d|[xyzt])\s*(sqrt|sin|cos|tan|log|ln|exp)\s*\(/gi, "$1*$2(");

  // ')' followed by function call
  t = t.replace(/\)\s*(sqrt|sin|cos|tan|log|ln|exp)\s*\(/gi, ")*$1(");

  return t;
}

function preprocessAll(s) {
  let t = s;
  t = preprocessMinus(t);
  t = preprocessLogNames(t);
  t = preprocessSuperscripts(t);
  t = preprocessSqrt(t);
  t = preprocessAbs(t);
  t = preprocessMul(t);
  t = preprocessDecimalComma(t);
  t = preprocessImplicitMul(t);
  return t;
}



function normalizeSqrtForCAS(expr) {
  // Convert sqrt( ... ) into ( ... )^(1/2) to avoid CAS treating "sqrt" as a symbol.
  // Handles nested parentheses by scanning.
  let s = String(expr);
  const key = "sqrt(";
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s.slice(i, i + key.length).toLowerCase() === key) {
      i += key.length; // position after "sqrt("
      let depth = 1;
      let inner = "";
      for (; i < s.length; i++) {
        const ch = s[i];
        if (ch === "(") { depth++; inner += ch; continue; }
        if (ch === ")") {
          depth--;
          if (depth === 0) break;
          inner += ch;
          continue;
        }
        inner += ch;
      }
      // now i is at matching ')'
      out += `((${inner}))^(1/2)`;
      continue;
    }
    out += s[i];
  }
  return out;
}


// ---------- pretty (output) ----------
function fixSqrtLatex(tex) {
  // KaTeX requires \sqrt{...}. Some converters may output \sqrt( ... ) or \sqrt\left( ... \right)
  let s = String(tex);

  // Fix \sqrt\left( ... \right) -> \sqrt{ ... }
  while (s.includes("\\sqrt\\left(")) {
    const i = s.indexOf("\\sqrt\\left(");
    const j = s.indexOf("\\right)", i);
    if (j === -1) break;
    const inside = s.slice(i + "\\sqrt\\left(".length, j);
    s = s.slice(0, i) + "\\sqrt{" + inside + "}" + s.slice(j + "\\right)".length);
  }

  // Fix \sqrt( ... ) -> \sqrt{ ... }
  while (s.includes("\\sqrt(")) {
    const i = s.indexOf("\\sqrt(");
    const j = s.indexOf(")", i + "\\sqrt(".length);
    if (j === -1) break;
    const inside = s.slice(i + "\\sqrt(".length, j);
    s = s.slice(0, i) + "\\sqrt{" + inside + "}" + s.slice(j + 1);
  }


  // Fix \sqrt x  or \sqrt 2  -> \sqrt{x} / \sqrt{2}
  // Also handles \sqrt x^{...} by wrapping only the immediate token; KaTeX will then parse exponent normally.
  s = s.replace(/\\sqrt\s+([a-zA-Z0-9])/g, "\\\\sqrt{$1}");

  return s;
}
function texPostprocess(tex) { return String(tex).replace(/(\d)\.(\d)/g, "$1,$2"); }

// Some converters (or browser escaping) may accidentally drop the backslash in \left/\right,
// producing 'left(' ... '\right)' which breaks KaTeX. Re-inject missing backslashes.
function fixLeftRight(tex) {
  let s = String(tex);
  // left( left[ left|  -> \left( \left[ \left|
  s = s.replace(/(^|[^\\])left([\(\[\|])/g, "$1\\left$2");
  // right) right] right| -> \right) \right] \right|
  s = s.replace(/(^|[^\\])right([\)\]\|])/g, "$1\\right$2");
  return s;
}


function prettyMul(tex) {
  return String(tex)
    // 3 \cdot {x} -> 3x (math.js sometimes wraps symbols in braces)
    .replace(/(\d)\s*\\cdot\s*\\,?\s*\{\s*([a-zA-Z])\s*\}/g, "$1$2")
    // 3 \cdot x -> 3x ; 3 \cdot \theta -> 3\theta ; 3 \cdot \mathrm{x} -> 3\mathrm{x}
    .replace(/(\d)\s*\\cdot\s*\\,?\s*(\\[a-zA-Z]+(?:\{[^}]*\})?|[a-zA-Z])/g, "$1$2")
    // 3 \cdot \left( ... \right) -> 3\left( ... \right)
    .replace(/(\d)\s*\\cdot\s*\\left\(/g, "$1\\left(")
    // Handle unicode middle dot if present
    .replace(/(\d)\s*·\s*([a-zA-Z])/g, "$1$2");
}

function fixFrac(tex) {
  let t = String(tex);

  // Convert \frac{\frac{1}{2}}{\sqrt{x}} -> \frac{1}{2\sqrt{x}}
  t = t.replace(/\\frac\{\s*\\frac\{1\}\{2\}\s*\}\{\s*(\\sqrt\{[^}]+\})\s*\}/g, "\\\\frac{1}{2$1}");

  // Convert \frac{\frac{1}{2}}{x} -> \frac{1}{2x}
  t = t.replace(/\\frac\{\s*\\frac\{1\}\{2\}\s*\}\{\s*([a-zA-Z]|\\[a-zA-Z]+)\s*\}/g, "\\\\frac{1}{2$1}");

  // Convert \frac{\frac{a}{b}}{c} for simple a,b,c (no nesting) -> \frac{a}{bc}
  t = t.replace(/\\frac\{\s*\\frac\{([0-9]+)\}\{([0-9]+)\}\s*\}\{\s*([a-zA-Z])\s*\}/g, "\\\\frac{$1}{$2$3}");

  return t;
}

function nerdToTex(expr) {
  // Prefer math.js TeX (usually KaTeX-friendly), fallback to nerdamer.
  try {
    const node = math.parse(String(expr));
    return prettyMul(fixLeftRight(fixFrac(fixSqrtLatex(texPostprocess(node.toTex({ parenthesis: "keep" }))))));
  } catch {
    try { return prettyMul(fixLeftRight(fixFrac(fixSqrtLatex(texPostprocess(nerdamer(expr).toTeX()))))); }
    catch { return prettyMul(fixLeftRight(fixFrac(fixSqrtLatex(texPostprocess(expr))))); }
  }
}

function formatDecimal(n, digits = 10) {
  if (!Number.isFinite(n)) return "NaN";
  let s = n.toFixed(digits);
  s = s.replace(/\.0+$/, "");
  s = s.replace(/(\.\d*?)0+$/, "$1");
  s = s.replace(".", ",");
  return s;
}

function uniqueClose(nums, eps = 1e-7) {
  const out = [];
  for (const n of nums) if (!out.some(x => Math.abs(x - n) < eps)) out.push(n);
  return out.sort((a, b) => a - b);
}

// ---------- plot ----------
function plotExpr(eq) {
  const cleanEq = preprocessAll(eq).trim();
  const compact = cleanEq.replace(/\s+/g, "");

  // 1) Explicit y = f(x)
  const mY = compact.match(/^y=(.+)$/i);
  if (mY) {
    let f = mY[1];
    if (!/[xX]/.test(f)) f = `(${f})+0*x`;

    clearPlot();
    functionPlot({
      target: "#plot",
      width: $("plot").clientWidth,
      height: 420,
      grid: true,
      data: [{ fn: f, sampler: "builtIn", graphType: "polyline" }]
    });

    return { lines: [{ type: "text", value: "Đã vẽ đồ thị:" }, { type: "latex", value: `y=${nerdToTex(mY[1])}` }] };
  }

  // 2) Implicit curve: F(x,y)=0 (e.g., x^2+y^2=1, (x^2+y^2-1)3x^2y^3=0)
  let F = compact;
  const eqm = compact.match(/^(.+?)=(.+)$/);
  if (eqm) F = `(${eqm[1]})-(${eqm[2]})`;

  if (!/[yY]/.test(F)) throw new Error("Đồ thị cần dạng: -g y = biểu_thức_theo_x (hoặc phương trình có y, ví dụ: x^2+y^2=1)");

  clearPlot();
  functionPlot({
    target: "#plot",
    width: $("plot").clientWidth,
    height: 420,
    grid: true,
    data: [{ fn: F, fnType: "implicit" }]
  });

  return {
    lines: [
      { type: "text", value: "Đã vẽ đồ thị (phương trình ẩn):" },
      { type: "latex", value: `${nerdToTex(F)}=0` }
    ]
  };
}

// ---------- calculus ----------
function integrateCmd(cmd) {
  const raw = normalizeSqrtForCAS(preprocessAll(cmd.trim()));

  const def = raw.match(/^\-p\s+(.+?)\s+dx\s+from\s+(.+?)\s+to\s+(.+)\s*$/i);
  if (def) {
    const expr = def[1].trim(), aStr = def[2].trim(), bStr = def[3].trim();
    const a = Number(math.evaluate(aStr)), b = Number(math.evaluate(bStr));
    const f = (x) => Number(math.evaluate(expr, { x }));

    const n = 2000, h = (b - a) / n;
    let s = f(a) + f(b);
    for (let i = 1; i < n; i++) {
      const x = a + i * h;
      s += (i % 2 === 0 ? 2 : 4) * f(x);
    }
    const approx = (h / 3) * s;

    return { lines: [
      { type: "text", value: "Tích phân xấp xỉ:" },
      { type: "latex", value: `\\int_{${nerdToTex(aStr)}}^{${nerdToTex(bStr)}} ${nerdToTex(expr)}\\,dx\\approx ${texPostprocess(String(approx))}` }
    ]};
  }

  const ind = raw.match(/^\-p\s+(.+?)\s+dx\s*$/i);
  if (ind) {
    const expr = ind[1].trim();
      const casExpr = normalizeSqrtForCAS(expr);
    try {
      const res = nerdamer.integrate(casExpr, "x").simplify().toString();
      return { lines: [
        { type: "text", value: "Nguyên hàm:" },
        { type: "latex", value: `\\int ${nerdToTex(expr)}\\,dx = ${nerdToTex(res)} + C` }
      ]};
    } catch { throw new Error("Không nguyên hàm được dạng này (thử biểu thức đơn giản hơn)."); }
  }

  throw new Error("Ví dụ: -p x^2 dx hoặc -p x dx from 0 to 2");
}

function solveDerivative(cmd) {
  let expr = cmd.replace(/^\-d\s*/i, "").trim();
  expr = preprocessAll(expr).replace(/^y\s*=\s*/i, "").replace(/^f\(x\)\s*=\s*/i, "");
  if (!expr) throw new Error("Ví dụ: -d √x");

  // math.js can differentiate sqrt reliably.
  try {
    const node = math.derivative(expr, "x");
    const tex = fixSqrtLatex(texPostprocess(node.toTex({ parenthesis: "keep" })));
    return { lines: [{ type: "text", value: "Đạo hàm:" }, { type: "latex", value: `f'(x)=${tex}` }] };
  } catch {
    // Fallback to nerdamer with sqrt normalized to powers
    try {
      const casExpr = normalizeSqrtForCAS(expr);
      const dStr = nerdamer.diff(casExpr, "x").simplify().toString();
      if (String(dStr).trim()==='sqrt') throw new Error('Biểu thức √ chưa được hiểu đúng. Thử viết sqrt(x) hoặc √(x).');
      return { lines: [{ type: "text", value: "Đạo hàm:" }, { type: "latex", value: `f'(x)=${nerdToTex(dStr)}` }] };
    } catch {
      throw new Error("Không đạo hàm được biểu thức này.");
    }
  }
}

// ---------- extrema for polynomials ----------
function isSimplePolynomialInX(expr) {
  const s = expr.replace(/\s+/g, "");
  if (!s) return { ok: false };
  if (s.includes("/") || /[a-wu-zA-WU-Z]/.test(s.replace(/x/gi, ""))) return { ok: false };
  if (/sqrt\(|sin\(|cos\(|tan\(|log\(|ln\(|exp\(/i.test(s)) return { ok: false };
  if (/x\^\-/i.test(s)) return { ok: false };

  let deg = 0;
  const powMatches = [...s.matchAll(/x\^(\d+)/gi)];
  for (const m of powMatches) {
    const p = parseInt(m[1], 10);
    if (Number.isFinite(p)) deg = Math.max(deg, p);
  }
  if (/x(?!\^)/i.test(s)) deg = Math.max(deg, 1);
  return { ok: true, deg };
}

function extremaLinesForPoly(expr) {
  const poly = isSimplePolynomialInX(expr);
  if (!poly.ok || poly.deg < 2 || poly.deg > 4) return null;

  const casExpr = normalizeSqrtForCAS(expr);
  try {
    const fnum = (x) => Number(math.evaluate(expr, { x }));
    const d1 = nerdamer.diff(casExpr, "x").simplify().toString();
    const d2 = nerdamer.diff(d1, "x").simplify().toString();

    let sols = [];
    try {
      const solStr = nerdamer.solve(d1, "x").toString();
      sols = solStr.replace(/[\[\]]/g, "").split(",").map(s => s.trim()).filter(Boolean);
      sols = sols.map(s => Number(s.replace(/x\s*=?/g, ""))).filter(v => Number.isFinite(v));
    } catch { sols = []; }

    const crit = uniqueClose(sols);

    const lines = [];
    lines.push({ type: "text", value: `Cực trị của f(x) (bậc ${poly.deg}):` });
    lines.push({ type: "latex", value: `f(x)=${nerdToTex(expr)}` });
    lines.push({ type: "latex", value: `f'(x)=${nerdToTex(d1)}` });
    lines.push({ type: "latex", value: `f''(x)=${nerdToTex(d2)}` });

    if (!crit.length) {
      lines.push({ type: "text", value: "Không tìm thấy điểm cực trị (hoặc không giải được f'(x)=0)." });
      return lines;
    }

    for (const x0 of crit) {
      const y0 = fnum(x0);
      let d2v = null;
      try { d2v = Number(math.evaluate(d2, { x: x0 })); } catch {}
      let kind = "điểm dừng";
      if (d2v !== null && Number.isFinite(d2v)) {
        if (d2v > 0) kind = "cực tiểu";
        else if (d2v < 0) kind = "cực đại";
      }
      lines.push({ type: "text", value: `${kind}:` });
      lines.push({ type: "latex", value: `x=${texPostprocess(String(x0))}` });
      lines.push({ type: "latex", value: `f(${texPostprocess(String(x0))})=${texPostprocess(String(y0))}` });
    }
    return lines;
  } catch {
    return null;
  }
}

// ---------- solve equation/system with toggle exact/decimal ----------
function parseRootsToArray(solStr) {
  let s = String(solStr).trim();
  s = s.replace(/^\[/, "").replace(/\]$/, "");
  if (!s) return [];
  return s.split(",").map(x => x.trim()).filter(Boolean);
}

function eqToTexAssignment(eq) {
  const p = eq.split("=");
  if (p.length === 2) return `${p[0].trim()}=${nerdToTex(p[1].trim())}`;
  return nerdToTex(eq);
}

function eqToDecAssignment(eq) {
  const p = eq.split("=");
  if (p.length === 2) {
    const vexpr = p[1].trim();
    try {
      const val = Number(nerdamer(vexpr).evaluate().text());
      return `${p[0].trim()}=${texPostprocess(formatDecimal(val, 10))}`;
    } catch {
      try {
        const val = Number(math.evaluate(vexpr));
        return `${p[0].trim()}=${texPostprocess(formatDecimal(val, 10))}`;
      } catch {
        return `${p[0].trim()}=${nerdToTex(vexpr)}`;
      }
    }
  }
  return nerdToTex(eq);
}

function solveSingleEquation(lhs, rhs) {
  const expr = `(${lhs})-(${rhs})`;
  let roots = [];
  try {
    const solStr = nerdamer.solve(normalizeSqrtForCAS(expr), "x").toString();
    roots = parseRootsToArray(solStr);
  } catch { throw new Error("Không giải được phương trình này."); }

  const exactRootsTex = roots.map(r => nerdToTex(r));
  const decRootsTex = roots.map(r => {
    try {
      const val = Number(nerdamer(r).evaluate().text());
      return texPostprocess(formatDecimal(val, 10));
    } catch {
      try {
        const val = Number(math.evaluate(r));
        return texPostprocess(formatDecimal(val, 10));
      } catch {
        return nerdToTex(r);
      }
    }
  });

  const exactLatex = `x\\in\\left\\{${exactRootsTex.join(",\\;")}\\right\\}`;
  const decLatex = `x\\in\\left\\{${decRootsTex.join(",\\;")}\\right\\}`;

  const lines = [{ type: "text", value: "Nghiệm (theo x):" }, { type: "latex", value: exactLatex }];

  const ext = extremaLinesForPoly(expr);
  if (ext) {
    lines.push({ type: "text", value: "" });
    lines.push(...ext);
  }

  // Build toggle replacing only latex lines
  const exactLatexLines = [];
  const decLatexLines = [];
  // first latex line is roots
  exactLatexLines.push(exactLatex);
  decLatexLines.push(decLatex);
  // add extrema latex lines, keep as-is but also provide decimalized versions for numeric-only latex like x=...
  if (ext) {
    for (const it of ext) {
      if (it.type !== "latex") continue;
      exactLatexLines.push(it.value);
      // decimal version: if it's "x=..." or "f(...)=..." already numeric, keep it
      decLatexLines.push(it.value);
    }
  }

  return { payload: { lines }, toggle: { exactLatexLines, decLatexLines } };
}

function solveSystem(input) {
  const raw = preprocessAll(input);
  const eqs = raw.split(/;|\n+/).map(s => s.trim()).filter(Boolean);
  if (eqs.length < 2) throw new Error("Hệ cần ít nhất 2 phương trình (cách nhau bằng dấu ';').");
  if (eqs.length > 8) throw new Error("Hệ quá nhiều phương trình (tối đa 8 dòng).");

  const allowedVars = ["x", "y", "z", "t"];
  const used = allowedVars.filter(v =>
    eqs.some(e => new RegExp(`(^|[^a-zA-Z0-9_])${v}([^a-zA-Z0-9_]|$)`).test(e))
  );
  if (used.length === 0) throw new Error("Không thấy ẩn x/y/z/t trong hệ.");
  if (used.length > 4) throw new Error("Chỉ hỗ trợ tối đa 4 ẩn: x, y, z, t.");

  try {
    const res = nerdamer.solveEquations(eqs.map(normalizeSqrtForCAS));
    const flat = Array.isArray(res) ? res.join(", ") : String(res);
    const parts = flat.split(/,\s*/).map(s => s.trim()).filter(Boolean);

    const exactLatexLines = parts.map(eqToTexAssignment);
    const decLatexLines = parts.map(eqToDecAssignment);

    const lines = [{ type: "text", value: `Nghiệm hệ (${used.join(", ")}):` }, ...exactLatexLines.map(v => ({ type: "latex", value: v }))];
    return { payload: { lines }, toggle: { exactLatexLines, decLatexLines } };
  } catch {
    throw new Error("Không giải được hệ này. Gợi ý: viết rõ dấu * (ví dụ 2*x).");
  }
}



// ---------- log/ln helpers ----------
function _isIntString(s) { return /^[-+]?\d+$/.test(String(s).trim()); }

function simplifyBasicLogs(input) {
  // Replace simple exact cases:
  // log(10^n) = n, log(1000)=3, log2(8)=3, ln(e)=1, ln(e^n)=n
  let s = String(input);

  // Normalize names first
  s = preprocessLogNames(s);

  // ln(e) and ln(e^n)
  s = s.replace(/\bln\s*\(\s*e\s*\)/gi, "1");
  s = s.replace(/\bln\s*\(\s*e\s*\^\s*\(?\s*([-+]?\d+)\s*\)?\s*\)/gi, (_, n) => String(n));
  s = s.replace(/\bln\s*\(\s*1\s*\)/gi, "0");

  // log(1)=0 base10; log(10)=1; log(10^n)=n
  s = s.replace(/\blog\s*\(\s*1\s*\)/gi, "0");
  s = s.replace(/\blog\s*\(\s*10\s*\)/gi, "1");
  s = s.replace(/\blog\s*\(\s*10\s*\^\s*\(?\s*([-+]?\d+)\s*\)?\s*\)/gi, (_, n) => String(n));

  // log(1000) exact powers of 10
  s = s.replace(/\blog\s*\(\s*(\d+)\s*\)/gi, (_, num) => {
    if (!/^1(0+)$/.test(num)) return `log(${num})`;
    const zeros = num.length - 1;
    return String(zeros);
  });

  // logB( N ) with B and N integers: if N is exact power of B => exponent
  // We scan for occurrences of "log<base>(<arg>)" with balanced parentheses (arg without nested is typical for this use).
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const rest = s.slice(i);
    const m = rest.match(/^log\s*(\d+)\s*\(/i);
    if (m) {
      const base = parseInt(m[1], 10);
      let j = i + m[0].length - 1; // points at '('
      let depth = 0, k = j, inner = "";
      for (; k < s.length; k++) {
        const ch = s[k];
        if (ch === '(') { depth++; if (depth > 1) inner += ch; continue; }
        if (ch === ')') { depth--; if (depth === 0) break; inner += ch; continue; }
        if (depth >= 1) inner += ch;
      }
      if (depth === 0) {
        const innerTrim = inner.trim();
        if (_isIntString(innerTrim) && base > 1) {
          let n = Math.abs(parseInt(innerTrim, 10));
          let exp = 0;
          while (n > 1 && n % base === 0) { n = n / base; exp++; }
          if (n === 1) {
            // handle negative argument only if base is odd and exponent integer? keep symbolic for safety
            const val = (parseInt(innerTrim, 10) < 0) ? `log${base}(${innerTrim})` : String(exp);
            out += val;
          } else out += `log${base}(${innerTrim})`;
        } else {
          out += `log${base}(${innerTrim})`;
        }
        i = k; // jump to ')'
        continue;
      }
    }
    out += s[i];
  }
  return out;
}

function transformLogsForMathJS(expr) {
  // Convert:
  //  - ln(x) -> log(x)  (natural log)
  //  - log(x) -> log10(x) (base-10)
  //  - logB(x) -> (log(x)/log(B)) for any integer base B
  let s = preprocessLogNames(String(expr));

  // Base logs log2(...), log10(...) etc: scan with parentheses matching
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const rest = s.slice(i);

    // ln(
    if (rest.match(/^ln\s*\(/i)) {
      // normalize to log(
      out += "log(";
      i += rest.match(/^ln\s*\(/i)[0].length - 1;
      continue;
    }

    // log<digits>(
    const m = rest.match(/^log\s*(\d+)\s*\(/i);
    if (m) {
      const base = m[1];
      // parse inner (...)
      let j = i + m[0].length - 1; // '('
      let depth = 0, k = j, inner = "";
      for (; k < s.length; k++) {
        const ch = s[k];
        if (ch === '(') { depth++; if (depth > 1) inner += ch; continue; }
        if (ch === ')') { depth--; if (depth === 0) break; inner += ch; continue; }
        if (depth >= 1) inner += ch;
      }
      if (depth !== 0) throw new Error("Thiếu dấu ')' trong log" + base);
      out += `(log(${inner})/log(${base}))`;
      i = k; // at ')'
      continue;
    }

    // plain log(  -> base10
    if (rest.match(/^log\s*\(/i)) {
      out += "log10(";
      i += rest.match(/^log\s*\(/i)[0].length - 1;
      continue;
    }

    out += s[i];
  }
  return out;
}

function postprocessLogLatex(tex) {
  let s = String(tex);

  // 1) log base 10 should display as "log" (no subscript 10)
  s = s.replace(/\\log_\{10\}\\left\(([^)]*)\\right\)/g, "\\log\\left($1\\right)");
  s = s.replace(/\\log_\{10\}\(([^)]*)\)/g, "\\log($1)");

  // 2) Convert fractions of logs into log base:
  //    \frac{\log\left(A\right)}{\log\left(B\right)} -> \log_{B}\left(A\right)
  // Also handle \ln in numerator/denominator.
  const fracRe = /\\frac\{\\(log|ln)\\left\(([^}]*)\\right\)\}\{\\(log|ln)\\left\(([^}]*)\\right\)\}/g;
  s = s.replace(fracRe, (_, fn1, A, fn2, B) => `\\log_{${B}}\\left(${A}\\right)`);

  // 3) Remaining natural logs: show as ln
  // Convert \log\left( ... \right) to \ln\left( ... \right) when it's not a base-log (i.e., no subscript)
  s = s.replace(/\\log\\left\(/g, "\\ln\\left(");

  return s;
}


function tryPureLogLatex(exprSym) {
  // If the whole expression is a single log/ln call that we did NOT simplify to a number,
  // keep it symbolic (log/ln) and offer decimal via toggle.
  const s = String(exprSym).trim();
  // Quick reject if there are operators outside the outermost function call
  // We'll parse "name(...)" with balanced parentheses.
  const m = s.match(/^([a-zA-Z]+)\s*(\d+)?\s*\(/);
  if (!m) return null;

  // Determine function name + optional base digits like log2
  let fn = m[1].toLowerCase();
  let baseDigits = m[2] || "";

  if (!(fn === "log" || fn === "ln")) return null;

  // Find matching closing paren for the first "("
  const openIdx = s.indexOf("(");
  let depth = 0, closeIdx = -1;
  for (let i = openIdx; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) { closeIdx = i; break; }
    }
  }
  if (closeIdx === -1) return null;
  // Ensure nothing meaningful after closing paren
  if (s.slice(closeIdx + 1).trim() !== "") return null;

  const inner = s.slice(openIdx + 1, closeIdx).trim();

  // Render inner to latex (best-effort)
  let innerLatex = null;
  try {
    const innerProc = preprocessAll(inner);
    innerLatex = texPostprocess(math.parse(innerProc).toTex({ parenthesis: "keep" }));
  } catch {
    innerLatex = inner; // fallback raw
  }

  // Build exact latex for log/ln
  let exactLatex = "";
  if (fn === "ln") {
    exactLatex = `\\ln\\left(${innerLatex}\\right)`;
  } else {
    // fn === log
    if (baseDigits) exactLatex = `\\log_{${baseDigits}}\\left(${innerLatex}\\right)`;
    else exactLatex = `\\log\\left(${innerLatex}\\right)`; // base10 display
  }

  // Decimal value for toggle (using mathjs transform)
  let decVal = null;
  try {
    const eNum = normalizeSqrtForCAS(transformLogsForMathJS(s));
    decVal = Number(math.evaluate(eNum));
    if (!Number.isFinite(decVal)) decVal = null;
  } catch {}

  if (decVal === null) return { exactLatex, toggle: null };

  const decLatex = texPostprocess(formatDecimal(decVal, 12));
  return {
    exactLatex,
    toggle: {
      labelOn: "đổi sang thập phân",
      labelOff: "đổi sang phân số",
      exactLatexLines: [exactLatex],
      decLatexLines: [decLatex],
    }
  };
}

function evalPreferExact(expr) {
  // NOTE: expr is already preprocessAll()-ed in solveOrEval.
  const eSym = simplifyBasicLogs(expr);
  // If it's a single log/ln call (e.g., log2(5)) and not reducible to an integer,
  // keep it as log/ln by default (no decimal rational approximation).
  const pureLog = tryPureLogLatex(eSym);
  if (pureLog && !/^\s*[+-]?\d+(?:\.\d+)?\s*$/.test(String(eSym).trim())) {
    return { payload: { lines: [{ type: "text", value: "Kết quả:" }, { type: "latex", value: pureLog.exactLatex }] }, toggle: pureLog.toggle };
  }
  const e = normalizeSqrtForCAS(transformLogsForMathJS(eSym));

  const hasSqrt = /sqrt\s*\(/i.test(e);
  const hasDecimal = /\d+\.\d+/.test(e);
  const hasLog = /\b(log|ln)\b/i.test(eSym);

  // If user typed decimals and there is no sqrt, show decimal directly (avoid turning 2.33 into 233/100).
  if (hasDecimal && !hasSqrt && !hasLog) {
    try {
      const v = math.evaluate(e);
      const outLatex = texPostprocess(formatDecimal(v, 12));
      return { payload: { lines: [{ type: "text", value: "Kết quả:" }, { type: "latex", value: outLatex }] }, toggle: null };
    } catch {
      // fall through to CAS
    }
  }

  try {
    // Prefer exact/symbolic (so √2 stays √2, not a decimal).
    const n = nerdamer(e).simplify();
    const s = n.toString();
    let exactLatex = nerdToTex(s);
    exactLatex = postprocessLogLatex(exactLatex);

    // Decimal approximation (for toggle)
    let decVal = null;
    try {
      decVal = Number(nerdamer(s).evaluate().text());
      if (!Number.isFinite(decVal)) decVal = null;
    } catch {}
    if (decVal === null) {
      try {
        decVal = Number(math.evaluate(e));
        if (!Number.isFinite(decVal)) decVal = null;
      } catch {}
    }

    // If it's a simple rational, allow toggle to decimal
    const m = s.match(/^\s*([+-]?\d+)\/(\d+)\s*$/);
    if (m) {
      const dec = Number(m[1]) / Number(m[2]);
      const decLatex = texPostprocess(formatDecimal(dec, 12));
      return { payload: { lines: [{ type: "text", value: "Kết quả:" }, { type: "latex", value: exactLatex }] },
               toggle: { exactLatexLines: [exactLatex], decLatexLines: [decLatex] } };
    }

    // For irrationals like √2, keep exact by default but allow decimal toggle.
    if (decVal !== null && (hasSqrt || hasLog || /sqrt|pi|e/i.test(s))) {
      const decLatex = texPostprocess(formatDecimal(decVal, 12));
      return { payload: { lines: [{ type: "text", value: "Kết quả:" }, { type: "latex", value: exactLatex }] },
               toggle: { exactLatexLines: [exactLatex], decLatexLines: [decLatex] } };
    }

    return { payload: { lines: [{ type: "text", value: "Kết quả:" }, { type: "latex", value: exactLatex }] }, toggle: null };
  } catch {
    // Fallback numeric
    const v = math.evaluate(e);

    // If expression contains log/ln, keep symbolic by default and offer decimal via toggle.
    if (hasLog) {
      let exactLatex = texPostprocess(math.parse(e).toTex({ parenthesis: "keep" }));
      exactLatex = postprocessLogLatex(exactLatex);
      const decLatex = texPostprocess(formatDecimal(v, 12));
      const toggle = {
        labelOn: "đổi sang thập phân",
        labelOff: "đổi sang phân số",
        exactLatexLines: [exactLatex],
        decLatexLines: [decLatex],
      };
      return { payload: { lines: [{ type: "text", value: "Kết quả:" }, { type: "latex", value: exactLatex }] }, toggle };
    }

    return { payload: { lines: [{ type: "text", value: "Kết quả:" }, { type: "latex", value: texPostprocess(formatDecimal(v, 12)) }] }, toggle: null };
  }
}


function solveOrEval(inputRaw) {
  const input = preprocessAll(inputRaw);

  if ((input.includes(";") || input.includes("\n")) && input.includes("=")) return solveSystem(input);

  if (input.includes("=")) {
    const parts = input.split("=");
    if (parts.length !== 2) throw new Error("Phương trình chỉ nên có 1 dấu '='");
    return solveSingleEquation(parts[0].trim(), parts[1].trim());
  }

  if (/[xX]/.test(input)) {
    const ext = extremaLinesForPoly(input);
    if (ext) return { payload: { lines: ext }, toggle: null };
    throw new Error("Biểu thức có x. Nếu muốn vẽ, dùng -g y=...");
  }

  return evalPreferExact(input);
}

function runCommand() {
  // IMPORTANT: preprocessAll must be applied exactly once.
  // Double-preprocessing turns decimals like 2,33 -> 2.33 -> 2*33.
  const raw = preprocessMinus($("cmd").value.trim());
  if (!raw) { renderOutput("Vui lòng nhập phép tính."); setToggle(false); return; }

  try {
    clearPlot();
    let payload = null, toggle = null;

    if (raw.startsWith("-g")) payload = plotExpr(raw.replace(/^\-g\s*/i, ""));
    else if (raw.startsWith("-p")) payload = integrateCmd(raw);
    else if (raw.startsWith("-d")) payload = solveDerivative(raw);
    else {
      const r = solveOrEval(raw);
      payload = r.payload;
      toggle = r.toggle;
    }

    const exactHtml = linesToHtml(payload.lines);

    if (toggle && toggle.exactLatexLines && toggle.decLatexLines) {
      const exactLatexLines = [...toggle.exactLatexLines];
      const decLatexLines = [...toggle.decLatexLines];

      const exactHtml2 = linesToHtml(payload.lines.map(it => it.type === "latex" ? ({ type: "latex", value: exactLatexLines.shift() }) : it));
      const decHtml2 = linesToHtml(payload.lines.map(it => it.type === "latex" ? ({ type: "latex", value: decLatexLines.shift() }) : it));

      lastRender = { exactHtml: exactHtml2, decHtml: decHtml2, mode: "exact", canToggle: true };
      renderOutput(exactHtml2);
      setToggle(true, "đổi sang thập phân");
      return;
    }

    lastRender = { exactHtml, decHtml: null, mode: "exact", canToggle: false };
    renderOutput(exactHtml);
    setToggle(false);

  } catch (err) {
    clearPlot();
    lastRender = null;
    renderOutput(escapeHtml("Lỗi: " + (err?.message || String(err))));
    setToggle(false);
  }
}

$("runBtn").addEventListener("click", runCommand);
$("clearBtn").addEventListener("click", () => {
  $("cmd").value = "";
  clearPlot();
  lastRender = null;
  renderOutput("Đã xóa.");
  setToggle(false);
});

$("toggleBtn").addEventListener("click", () => {
  if (!lastRender || !lastRender.canToggle) return;
  if (lastRender.mode === "exact") {
    renderOutput(lastRender.decHtml);
    lastRender.mode = "dec";
    setToggle(true, "đổi sang phân số");
  } else {
    renderOutput(lastRender.exactHtml);
    lastRender.mode = "exact";
    setToggle(true, "đổi sang thập phân");
  }
});

$("cmd").addEventListener("keydown", (e) => { if (e.key === "Enter") runCommand(); });

window.addEventListener("resize", () => {
  if ($("plot").children.length > 0) {
    const input = preprocessMinus($("cmd").value.trim());
    if (input.startsWith("-g")) {
      try { plotExpr(input.replace(/^\-g\s*/i, "")); } catch {}
    }
  }
});


// ---------- UI helpers (examples) ----------
try {
  document.querySelectorAll('[data-example]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = btn.getAttribute('data-example') || '';
      if (!v) return;
      const inp = $("cmd");
      inp.value = v;
      inp.focus();
    });
  });
} catch (_) {}
