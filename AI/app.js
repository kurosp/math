// ====== cấu hình ======
const WORKER_URL = "https://gemini-proxy-vercel-roan.vercel.app/api/gemini";
const MODEL = "gemini-2.5-flash";
const TEMPERATURE = 0.7;
const MAX_OUTPUT_TOKENS = 5000;

const SYSTEM_INSTRUCTION =
"Bạn trả lời nhẹ nhàng, luôn khen người dùng hỏi rất hay." +
  "Bạn trả lời tiếng Việt, trình bày gọn gàng. " +
  "Công thức dùng LaTeX trong $...$ hoặc $$...$$. " +
  "Nếu biểu thức dài, ưu tiên tách dòng hoặc dùng nhiều dòng.";
// =======================================

const chatEl = document.getElementById("chat");
const statusEl = document.getElementById("status");
const msgEl = document.getElementById("msg");
const sendBtn = document.getElementById("send");
const clearBtn = document.getElementById("clear");
const scrollBottomBtn = document.getElementById("scrollBottom");
const composerEl = document.getElementById("composer");


function autoSizeInput(){
  // Autosize textarea height (mobile-friendly)
  if (!msgEl) return;
  msgEl.style.height = "0px";
  const h = Math.min(msgEl.scrollHeight, 140);
  msgEl.style.height = h + "px";
  updateComposerHeight();
}
let history = [];

const ICON_COPY = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="9" y="9" width="11" height="11" rx="2.8" stroke="currentColor" stroke-width="2.2"/><rect x="4" y="4" width="11" height="11" rx="2.8" stroke="currentColor" stroke-width="2.2"/></svg>`;
const ICON_CHECK = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M20 6 9 17l-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// ---------- UI helpers ----------
function escapeHtml(s){
  return s
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function renderPrettyText(raw){
  // Render: bullets + bold + code blocks (```lang ... ```)
  const src = (raw ?? "").replace(/\r\n/g, "\n");

  const reCode = /```(\w+)?\n([\s\S]*?)```/g;
  let out = "";
  let last = 0;
  let m;

  const renderText = (txt) => {
    let s = txt;
    s = s.replace(/(^|\n)\s*\*\s+/g, "$1• ");
    s = escapeHtml(s);
    s = s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    s = s.replace(/\n/g, "<br>");
    return s;
  };

  while ((m = reCode.exec(src)) !== null) {
    out += renderText(src.slice(last, m.index));

    const lang = (m[1] || "txt").toLowerCase();
    const codeRaw = m[2] ?? "";
    const codeEsc = escapeHtml(codeRaw);

    out += `
      <div class="codeblock" data-lang="${lang}">
        <div class="codebar">
          <div class="lang">${lang}</div>
          <button class="codecopy" type="button" title="Sao chép mã">
            <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="9" y="9" width="13" height="13" rx="2"></rect>
              <rect x="2" y="2" width="13" height="13" rx="2"></rect>
            </svg>
            <span>Sao chép mã</span>
          </button>
        </div>
        <pre class="codepre"><code class="language-${lang}">${codeEsc}</code></pre>
      </div>
    `;

    last = reCode.lastIndex;
  }

  out += renderText(src.slice(last));
  return out.trim();
}

async function copyText(text){
  try{
    await navigator.clipboard.writeText(text);
    return true;
  }catch{
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  }
}

function addUserBubble(text){
  const row = document.createElement("div");
  row.className = "msgrow me";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  row.appendChild(bubble);
  chatEl.appendChild(row);
  chatEl.scrollTop = chatEl.scrollHeight;
}

function addBotBubble(rawText){
  const row = document.createElement("div");
  row.className = "msgrow bot";

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  const btn = document.createElement("button");
  btn.className = "copy-btn";
  btn.type = "button";
  btn.setAttribute("title","Sao chép");
  btn.innerHTML = ICON_COPY;
  btn.addEventListener("click", async () => {
    const ok = await copyText(rawText);
    btn.classList.toggle("copied", ok);
    btn.innerHTML = ok ? ICON_CHECK : ICON_COPY;
    setTimeout(() => {
      btn.classList.remove("copied");
      btn.innerHTML = ICON_COPY;
    }, 900);
  });

  const content = document.createElement("div");
  content.innerHTML = renderPrettyText(rawText);

  bubble.appendChild(btn);
  bubble.appendChild(content);
  row.appendChild(bubble);
  chatEl.appendChild(row);
  chatEl.scrollTop = chatEl.scrollHeight;

  // Code block copy buttons
  bubble.querySelectorAll(".codecopy").forEach((b) => {
    b.addEventListener("click", async () => {
      const code = b.closest(".codeblock")?.querySelector("code")?.innerText || "";
      const ok = await copyText(code);
      const label = b.querySelector("span");
      if (label) label.textContent = ok ? "Đã copy" : "Copy lỗi";
      setTimeout(() => { if (label) label.textContent = "Sao chép mã"; }, 900);
    });
  });

  // Syntax highlight
  if (window.hljs) {
    bubble.querySelectorAll("pre code").forEach((el) => {
      try { window.hljs.highlightElement(el); } catch {}
    });
  }

  if (window.MathJax?.typesetPromise) {
    window.MathJax.typesetPromise([bubble]).catch(() => {});
  }
}


let typingRow = null;

function showTypingInline(){
  if (typingRow) return;
  const row = document.createElement("div");
  row.className = "msgrow bot typing";

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  const dots = document.createElement("div");
  dots.className = "typing-inline";
  dots.innerHTML = "<span></span><span></span><span></span>";

  bubble.appendChild(dots);
  row.appendChild(bubble);
  chatEl.appendChild(row);
  chatEl.scrollTop = chatEl.scrollHeight;
  typingRow = row;
}

function hideTypingInline(){
  if (!typingRow) return;
  typingRow.remove();
  typingRow = null;
}

function showStatus(text){
  if (!statusEl) return;
  statusEl.style.display = "block";
  statusEl.textContent = text;
}
function hideStatus(){
  if (!statusEl) return;
  statusEl.style.display = "none";
  statusEl.textContent = "";
}


// ---------- Gemini via Worker ----------
async function callGemini(userText){
  // typing indicator handled in UI (inline)
  const payload = {
    contents: [...history, { role: "user", parts: [{ text: userText }] }],
    generationConfig: { temperature: TEMPERATURE, maxOutputTokens: MAX_OUTPUT_TOKENS },
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] }
  };

  const res = await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, payload })
  });

  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = { raw }; }

  if (!res.ok) {
    const msg = data?.error?.message || data?.raw || ("http " + res.status);
    throw new Error(msg);
  }

  const parts = data?.candidates?.[0]?.content?.parts || [];
  const reply = parts.map(p => p.text).filter(Boolean).join("\n").trim();
  if (!reply) return "mình chưa nhận được câu trả lời 😅";

  history.push({ role: "user", parts: [{ text: userText }] });
  history.push({ role: "model", parts: [{ text: reply }] });
  if (history.length > 20) history = history.slice(-20);

  return reply;
}

// ---------- Send flow ----------
async function send(){
  const userText = msgEl.value.trim();
  if (!userText) return;

  addUserBubble(userText);
  msgEl.value = "";
  sendBtn.disabled = true;
  showTypingInline();

  try{
    const reply = await callGemini(userText);
    addBotBubble(reply);
  }catch(e){
    autoSizeInput();

addBotBubble("lỗi: " + e.message);
  }finally{
    hideTypingInline();
      hideStatus();
    sendBtn.disabled = false;
    msgEl.focus();
  }
}

sendBtn.addEventListener("click", send);
msgEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});
msgEl.addEventListener("input", autoSizeInput);
window.addEventListener("resize", autoSizeInput);

if (scrollBottomBtn) {
  scrollBottomBtn.addEventListener("click", () => {
    chatEl.scrollTop = chatEl.scrollHeight;
    msgEl.focus();
  });
}

clearBtn.addEventListener("click", () => {
  history = [];
  chatEl.innerHTML = "";
  addBotBubble("đã xoá lịch sử.");
  msgEl.focus();
});


// ---------- Keyboard helper (đẩy ô nhập lên trên bàn phím) ----------
function setCssVar(name, value){
  document.documentElement.style.setProperty(name, value);
}
function updateComposerHeight(){
  if (!composerEl) return;
  const h = Math.round(composerEl.getBoundingClientRect().height || 56);
  setCssVar("--composer-h", h + "px");
}
function updateKeyboardOffset(){
  // visualViewport chỉ có trên mobile hiện đại
  const vv = window.visualViewport;
  if (!vv) { setCssVar("--kbd-offset", "0px"); return; }

  // Tính phần bàn phím che phía dưới
  const offset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  setCssVar("--kbd-offset", Math.round(offset) + "px");
}

updateComposerHeight();
updateKeyboardOffset();

window.addEventListener("resize", () => {
  updateComposerHeight();
  updateKeyboardOffset();
});

if (window.visualViewport){
  window.visualViewport.addEventListener("resize", updateKeyboardOffset);
  window.visualViewport.addEventListener("scroll", updateKeyboardOffset);
}

// Khi focus/blur input thì cập nhật lại
msgEl.addEventListener("focus", () => {
  updateComposerHeight();
  updateKeyboardOffset();
  setTimeout(() => { updateKeyboardOffset(); chatEl.scrollTop = chatEl.scrollHeight; }, 50);
});
msgEl.addEventListener("blur", () => {
  setCssVar("--kbd-offset", "0px");
});



function updateScrollButton(){
  if (!scrollBottomBtn) return;
  const nearBottom = (chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight) < 120;
  scrollBottomBtn.style.opacity = nearBottom ? "0" : "1";
  scrollBottomBtn.style.pointerEvents = nearBottom ? "none" : "auto";
}
chatEl.addEventListener("scroll", updateScrollButton);
window.addEventListener("resize", updateScrollButton);

// Initial hello
addBotBubble("chào bạn, tôi là chatbot Btoan AI 😄");
