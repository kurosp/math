// ====== cấu hình ======
const WORKER_URL = "https://btoan-gemini-proxy.ss1sien.workers.dev";

const MODEL = "gemini-2.5-flash";
const TEMPERATURE = 0.7;
const MAX_OUTPUT_TOKENS = 5000;

const SYSTEM_INSTRUCTION =
  "Nói tiếng Việt, xưng tao–mày. Giọng cà khịa, láo láo cho vui, có thể chửi thề nhẹ/ vừa (vcl, đm, vãi, vl...) nhưng đừng spam quá lố. " +
  "Trả lời thẳng, ngắn gọn, không văn mẫu, không mở bài dài dòng. " +
  "Chèn nhiều icon mặt cho sinh động (gần như mỗi câu 1–3 cái), ưu tiên emoji mặt kiểu bàn phím Google: " +
  "😀😁😂🤣😅😆😉😊🙂🙃😇😍😘😗😙😚😋😜😝🤪🤨🧐🤓😎🥸🤩🥳😏😒😞😔😟😕🙁☹️😣😖😫😩🥺😢😭😤😠😡🤬😱😨😰😥😓🤗🤔🫢🫣😶‍🌫️😶😐😑🫤🙄😬🤥😴🤤😪😮‍💨😮😯😲🥱😵😵‍💫🤯🤠🥴🤧🤢🤮🤫🤭🫡 " +
  "Nếu là toán/hoá: trình bày rõ ràng, công thức dùng LaTeX trong $...$ hoặc $$...$$. Nếu biểu thức dài thì tách dòng.";
// =======================

const chatEl = document.getElementById("chat");
const statusEl = document.getElementById("status");
const msgEl = document.getElementById("msg");
const sendBtn = document.getElementById("send");
const clearBtn = document.getElementById("clear");

let history = [];

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
  let s = raw ?? "";
  s = s.replace(/\r\n/g, "\n");
  s = s.replace(/(^|\n)\s*\*\s+/g, "$1• ");
  s = escapeHtml(s);
  s = s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  s = s.replace(/\n/g, "<br>");
  return s;
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
  btn.textContent = "copy";
  btn.addEventListener("click", async () => {
    const ok = await copyText(rawText);
    btn.textContent = ok ? "copied" : "fail";
    setTimeout(() => (btn.textContent = "copy"), 900);
  });

  const content = document.createElement("div");
  content.innerHTML = renderPrettyText(rawText);

  bubble.appendChild(btn);
  bubble.appendChild(content);
  row.appendChild(bubble);
  chatEl.appendChild(row);
  chatEl.scrollTop = chatEl.scrollHeight;

  if (window.MathJax?.typesetPromise) {
    window.MathJax.typesetPromise([bubble]).catch(() => {});
  }
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
  showStatus("đang trả lời...");
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

  try{
    const reply = await callGemini(userText);
    addBotBubble(reply);
  }catch(e){
    addBotBubble("lỗi: " + e.message);
  }finally{
    hideStatus();
    sendBtn.disabled = false;
    msgEl.focus();
  }
}

sendBtn.addEventListener("click", send);
msgEl.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });

clearBtn.addEventListener("click", () => {
  history = [];
  chatEl.innerHTML = "";
  addBotBubble("đã xoá lịch sử.");
  msgEl.focus();
});

// Initial hello
addBotBubble("chào bạn, tôi là chatbot Btoan AI 😄");
