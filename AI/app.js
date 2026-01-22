// ====== cấu hình chỉnh trong code ======
// Dán 5 API key của bạn vào đây:
const API_KEYS = [
  "AIzaSyDpFhjVWPFUkf27g1lNXNDLhPVY0t7ywt8",
  "AIzaSyCqPYZMqK6_ykbMcHAK69V4Kb09X-YXxls",
  "AIzaSyBgRBxZEzi6dEXt4dj9f_qbg6zsm4aLVBg",
  "AIzaSyDGFt2b0IkLIf3I967GzX0q7GJs8o2x20k",
  " AIzaSyCsoth235SBzlAAP1QY8Re_O8bmDOfLHB0"
];

const MODEL = "gemini-3-flash";
const TEMPERATURE = 0.7;
const MAX_OUTPUT_TOKENS = 7500;

// Khi hết cả 5 key, chờ tối thiểu X giây rồi quay lại key #1 thử lại
const COOLDOWN_DEFAULT_SECONDS = 10;

const SYSTEM_INSTRUCTION =
  "Bạn trả lời tiếng Việt, trình bày gọn gàng. " +
  "Công thức dùng LaTeX trong $...$ hoặc $$...$$. " +
  "Nếu biểu thức dài, ưu tiên tách dòng hoặc dùng nhiều dòng.";
// =======================================

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

function formatMMSS(ms){
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

// ---------- Key rotation + cooldown ----------
let keyIndex = Number(localStorage.getItem("gemini_key_index") || 0);
let cooldownUntil = Number(localStorage.getItem("gemini_cooldown_until") || 0);
let countdownTimer = null;

function getApiKey(){
  return API_KEYS[keyIndex % API_KEYS.length];
}
function rotateKey(){
  keyIndex = (keyIndex + 1) % API_KEYS.length;
  localStorage.setItem("gemini_key_index", String(keyIndex));
  return getApiKey();
}
function resetToFirstKey(){
  keyIndex = 0;
  localStorage.setItem("gemini_key_index", "0");
}

function setCooldown(seconds){
  cooldownUntil = Date.now() + seconds * 1000;
  localStorage.setItem("gemini_cooldown_until", String(cooldownUntil));
  startCountdown();
}

function clearCooldown(){
  cooldownUntil = 0;
  localStorage.removeItem("gemini_cooldown_until");
  stopCountdown();
  hideStatus();
}

function startCountdown(){
  stopCountdown();
  sendBtn.disabled = true;

  const tick = () => {
    const left = cooldownUntil - Date.now();
    if (left <= 0) {
      clearCooldown();
      resetToFirstKey();
      sendBtn.disabled = false;
      addBotBubble("✅ Đã hết thời gian chờ. Mình thử lại từ key #1 nha.");
      return;
    }
    showStatus(`⏳ Hết cả 5 key. Đang chờ hồi quota… còn ${formatMMSS(left)} rồi thử lại từ key #1.`);
  };

  tick();
  countdownTimer = setInterval(tick, 500);
}

function stopCountdown(){
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = null;
}

// Nếu đang cooldown mà reload trang, tự chạy lại countdown
if (cooldownUntil && Date.now() < cooldownUntil) startCountdown();

// ---------- Gemini call with auto-rotate ----------
async function callGemini(userText){
  if (cooldownUntil && Date.now() < cooldownUntil) {
    throw new Error("đang chờ hồi quota: còn " + formatMMSS(cooldownUntil - Date.now()));
  }

  if (!API_KEYS?.length || API_KEYS.length < 5 || API_KEYS.some(k => !k || k.includes("KEY_"))) {
    throw new Error("bạn chưa dán đủ 5 API key vào API_KEYS trong app.js");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

  const payload = {
    contents: [...history, { role: "user", parts: [{ text: userText }] }],
    generationConfig: { temperature: TEMPERATURE, maxOutputTokens: MAX_OUTPUT_TOKENS },
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] }
  };

  let lastErr = null;
  let bestRetryAfter = 0;

  for (let attempt = 0; attempt < API_KEYS.length; attempt++) {
    const apiKey = getApiKey();

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(payload)
    });

    const ra = res.headers.get("retry-after");
    const raSec = ra ? Number(ra) : 0;
    if (Number.isFinite(raSec) && raSec > bestRetryAfter) bestRetryAfter = raSec;

    const raw = await res.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { raw }; }

    if (res.ok) {
      clearCooldown();

      const parts = data?.candidates?.[0]?.content?.parts || [];
      const reply = parts.map(p => p.text).filter(Boolean).join("\n").trim();
      if (!reply) return "mình chưa nhận được câu trả lời 😅";

      history.push({ role: "user", parts: [{ text: userText }] });
      history.push({ role: "model", parts: [{ text: reply }] });
      if (history.length > 20) history = history.slice(-20);

      return reply;
    }

    const msg = data?.error?.message || data?.raw || `http ${res.status}`;
    lastErr = msg;

    const rotateWorthy =
      res.status === 401 || res.status === 403 || res.status === 429 ||
      /quota|exceed|rate|limit|RESOURCE_EXHAUSTED|Too Many Requests/i.test(msg);

    if (rotateWorthy) {
      rotateKey();
      continue;
    }

    throw new Error(msg);
  }

  // hết cả 5 key
  const waitSec = Math.max(bestRetryAfter || 0, COOLDOWN_DEFAULT_SECONDS);
  setCooldown(waitSec);
  throw new Error("hết cả 5 key. bật chế độ chờ hồi quota...");
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
    // nếu đang cooldown thì sendBtn sẽ bị startCountdown disable lại
    if (!(cooldownUntil && Date.now() < cooldownUntil)) sendBtn.disabled = false;
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
