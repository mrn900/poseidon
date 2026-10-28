// Global ngrok warning bypass for all internal API and asset requests
(function() {
  const _origFetch = window.fetch;
  window.fetch = function(input, init) {
    init = init ? { ...init } : {};
    if (init.headers instanceof Headers) {
      if (!init.headers.has('ngrok-skip-browser-warning')) {
        init.headers.set('ngrok-skip-browser-warning', 'true');
      }
    } else if (Array.isArray(init.headers)) {
      init.headers = [...init.headers, ['ngrok-skip-browser-warning', 'true']];
    } else {
      init.headers = Object.assign({}, init.headers, { 'ngrok-skip-browser-warning': 'true' });
    }
    return _origFetch.call(this, input, init);
  };
})();

const $ = s => document.querySelector(s);
const msgs = $('#messages'), input = $('#input'), sendBtn = $('#send');
let state = { convo: [], brain: {}, settings: {} };


// ---------- Date Helpers ----------
function parseDateScore(dStr) {
  if (!dStr) return 0;
  const d = new Date(dStr);
  if (!isNaN(d.getTime())) return d.getTime();
  const m = String(dStr).match(/\b(20\d\d)\b/);
  if (m) return new Date(m[1] + '-01-01').getTime();
  return 0;
}

function formatDateNice(isoDate) {
  try {
    const [y, m, d] = isoDate.split('-');
    const dateObj = new Date(y, m - 1, d);
    return dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return isoDate;
  }
}

// ---------- Markdown Parser ----------
const esc = s => (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function md(src) {
  const lines = esc(src || '').split('\n');
  let html = '', list = null;
  const inline = t => t
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/!\[(.*?)\]\((https?:\/\/[^\s)]+)\)/g, '<div class="chat-img-wrap" style="margin:10px 0;"><img src="$2" alt="$1" style="max-width:100%; border-radius:10px; border:1px solid rgba(148,197,220,0.22); box-shadow:0 4px 18px rgba(0,0,0,0.4);" loading="lazy" /><br><small style="color:var(--text-muted); font-size:11.5px;">$1</small></div>')
    .replace(/(^|[^!])\[(.*?)\]\((https?:\/\/[^\s)]+)\)/g, '$1<a href="$3" target="_blank" rel="noopener noreferrer">$2</a>');
  const close = () => { if (list) { html += `</${list}>`; list = null; } };

  for (const l of lines) {
    let m;
    if ((m = l.match(/^#{1,4}\s+(.*)/))) { close(); html += `<h3>${inline(m[1])}</h3>`; }
    else if ((m = l.match(/^\s*[-*•]\s+(.*)/))) { if (list !== 'ul') { close(); html += '<ul>'; list = 'ul'; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { close(); html += '<ol>'; list = 'ol'; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = l.match(/^&gt;\s?(.*)/))) { close(); html += `<blockquote>${inline(m[1])}</blockquote>`; }
    else if (l.trim()) { close(); html += `<p>${inline(l)}</p>`; }
    else close();
  }
  close();
  return html;
}

// ---------- Chat Render ----------
// ---------- Chat Render & Last-In-Chat History ----------
const fmtTime = ts => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
let lastDay = '';

const fmtStamp = ts => {
  const d = new Date(ts);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) + ' · ' + fmtTime(ts);
};

function formatRelativeAgo(ts) {
  if (!ts) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - Number(ts)) / 1000));
  if (diffSec < 45) return 'just now';
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function getLastChatTimestamp() {
  const convoArr = state.convo || [];
  if (convoArr.length) {
    const lastMsg = convoArr[convoArr.length - 1];
    if (lastMsg?.ts) return lastMsg.ts;
  }
  if (state.brain?.lastChatAt) return state.brain.lastChatAt;
  const activeConvoMeta = (state.conversations || []).find(c => c.id === state.activeConvoId);
  if (activeConvoMeta?.lastActiveTs) return activeConvoMeta.lastActiveTs;
  return 0;
}

function updateLastInChatStatus() {
  const lastTs = getLastChatTimestamp();
  const statusEl = $('#liveStatus');
  if (statusEl) {
    if (lastTs) {
      statusEl.textContent = `Last in chat: ${fmtStamp(lastTs)} (${formatRelativeAgo(lastTs)})`;
    } else {
      statusEl.textContent = 'Ready for communion · Live brain synced';
    }
  }
  const bannerEl = $('#chatHistoryBanner');
  if (bannerEl && lastTs) {
    const prevTs = state.brain?.previousChatAt;
    const prevText = (prevTs && Math.abs(lastTs - prevTs) > 60000)
      ? ` · Previous session: ${fmtStamp(prevTs)} (${formatRelativeAgo(prevTs)})`
      : '';
    bannerEl.innerHTML = `<span>Last in chat: <strong>${esc(fmtStamp(lastTs))}</strong> (${esc(formatRelativeAgo(lastTs))})${esc(prevText)}</span>`;
  }
}

setInterval(updateLastInChatStatus, 30000);

function ensureChatHistoryBanner() {
  const lastTs = getLastChatTimestamp();
  if (!lastTs || !msgs) return;
  let banner = $('#chatHistoryBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'chatHistoryBanner';
    banner.className = 'chat-history-banner';
    msgs.prepend(banner);
  }
  updateLastInChatStatus();
}

function addMsg(role, content, ts = Date.now(), cls = '', images = []) {
  $('.welcome')?.remove();
  ensureChatHistoryBanner();
  const day = new Date(ts).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if (day !== lastDay) {
    lastDay = day;
    msgs.insertAdjacentHTML('beforeend', `<div class="day"><span>${day}</span></div>`);
  }
  const el = document.createElement('div');
  el.className = `m ${role}`;
  el._rawText = content || '';
  const imgs = (images || []).filter(i => i && i.thumb).map(i => `<img src="${i.thumb}" alt="attached image" />`).join('');

  el.innerHTML = `
    <div class="m-av"><img src="./icon-192.png" alt="" /></div>
    <div class="m-body">
      ${imgs ? `<div class="m-imgs">${imgs}</div>` : ''}
      <div class="bubble ${cls}">${role === 'user' ? esc(content) : md(content)}</div>
      <div class="m-meta">
        <span class="time">${fmtStamp(ts)}</span>
        <button class="copy-btn" title="Copy text" type="button">
          <svg class="copy-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          <span class="copy-txt">Copy</span>
        </button>
      </div>
    </div>`;

  const copyBtn = el.querySelector('.copy-btn');
  copyBtn.onclick = (e) => {
    e.stopPropagation();
    const textToCopy = el._rawText || el.querySelector('.bubble').innerText;
    navigator.clipboard.writeText(textToCopy).then(() => {
      copyBtn.classList.add('copied');
      copyBtn.querySelector('.copy-txt').textContent = 'Copied';
      setTimeout(() => {
        copyBtn.classList.remove('copied');
        copyBtn.querySelector('.copy-txt').textContent = 'Copy';
      }, 1800);
    });
  };
  el.querySelectorAll('.m-imgs img').forEach(im => im.onclick = () => window.open(im.src, '_blank'));

  msgs.appendChild(el);
  $('.chat')?.classList.add('has-messages');
  return el;
}

function toast(text, kind = 'teal') {
  const host = $('#toastHost');
  if (!host) return;
  const t = document.createElement('div');
  t.className = 'toast ' + (kind === 'gold' ? 'gold' : '');
  t.innerHTML = `<span>${esc(text)}</span>`;
  host.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .4s'; }, 4600);
  setTimeout(() => t.remove(), 5100);
}

const SUGGESTIONS = [
  { t: 'Log a dream', q: 'I want to record a dream. Here is what I saw: ' },
  { t: 'Foresight', q: 'Calculate my Steins;Gate world line divergences, unpredictable anomalies, and tactical protocols: ' },
  { t: 'Discuss my chapter', q: 'Poseidon, let us talk about the exact chapter I have bookmarked right now and how I should execute its laws today: ' },
  { t: 'Connect the patterns', q: 'Look across everything I have shared so far. Where do the pieces connect? ' },
  { t: 'Unfiltered', q: 'I need to speak without a filter. Here is something heavy I carry: ' },
  { t: 'Show Poseidon an image', q: '__attach__' }
];

function welcome() {
  $('.chat')?.classList.remove('has-messages');
  const lastTs = getLastChatTimestamp();
  const lastSeenHtml = lastTs
    ? `<div class="welcome-last-chat">Last in chat: <strong>${esc(fmtStamp(lastTs))}</strong> (${esc(formatRelativeAgo(lastTs))})</div>`
    : '';
  msgs.innerHTML = `
    <div class="welcome">
      <img class="w-logo" src="./icon-512.png" alt="Poseidon" />
      <h2>POSEIDON</h2>
      <p>Your private brother, teacher and mentor. Everything you share is absorbed and remembered, and he grows sharper with every word.</p>
      ${lastSeenHtml}
      <div class="sugg">
        ${SUGGESTIONS.map((s, i) => `<button type="button" data-sugg="${i}"><span>${s.t}</span></button>`).join('')}
      </div>
    </div>`;
  msgs.querySelectorAll('[data-sugg]').forEach(b => {
    b.onclick = () => {
      const sg = SUGGESTIONS[Number(b.dataset.sugg)];
      if (sg.q === '__attach__') { $('#imageInput')?.click(); return; }
      input.value = sg.q;
      autosize();
      input.focus();
    };
  });
}

const LOCAL_VAULT_KEY = 'poseidon_autonomous_vault_v2';
let _vaultSaveTimer = null;

function _flushLocalVaultNow() {
  try {
    localStorage.setItem(LOCAL_VAULT_KEY, JSON.stringify({
      convo: state.convo || [],
      brain: state.brain || {},
      settings: state.settings || {},
      systemPromptSnapshot: state.systemPromptSnapshot || '',
      pendingDreams: state.pendingDreams || [],
      pendingRants: state.pendingRants || [],
      pendingMessages: state.pendingMessages || [],
      savedAt: Date.now()
    }));
  } catch {}
}

function saveLocalVault(immediate = false) {
  if (immediate) {
    if (_vaultSaveTimer) { clearTimeout(_vaultSaveTimer); _vaultSaveTimer = null; }
    _flushLocalVaultNow();
    return;
  }
  if (_vaultSaveTimer) clearTimeout(_vaultSaveTimer);
  _vaultSaveTimer = setTimeout(() => {
    _vaultSaveTimer = null;
    _flushLocalVaultNow();
  }, 280);
}

function loadLocalVault() {
  if (window.__POSEIDON_POCKET_STATE__) return window.__POSEIDON_POCKET_STATE__;
  try {
    const raw = localStorage.getItem(LOCAL_VAULT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

let currentChatAbortController = null;
let isGeneratingChat = false;

function stopCurrentPrompt() {
  if (isGeneratingChat && currentChatAbortController) {
    try { currentChatAbortController.abort(); } catch {}
    if (typeof toast === 'function') toast('Prompt cut short', 'gold');
  }
}

async function directAutonomousGeminiChat(userMessage, images = [], signal = null) {
  const HARDCODED_KEY = atob('QVEuQWI4Uk42STR4UHBVal9sVWdOblB3VXU2QTAtY3hrb1dKYVJLa0VrZjN5ZWVkZENDbnc=');
  let key = state.settings?.directKey || state.settings?.apiKey || localStorage.getItem('poseidon_direct_key') || HARDCODED_KEY;
  if (!key || key === 'undefined' || key.length < 15) key = HARDCODED_KEY;

  const bm = state.brain?.activeBookmark;
  const bmContext = bm
    ? `\n\n=== HENRI'S CURRENT BOOKMARK ===\nBook: "${bm.bookTitle}" (${bm.author || ''})\nChapter: ${bm.chapterTitle || ('Chapter ' + bm.chapterNumber)}\nSummary: ${bm.chapterSummary || ''}\nLesson: ${bm.poseidonLesson || ''}\nHow To Act: ${bm.howToAct || ''}`
    : '';

  const sys = (state.systemPromptSnapshot || 'You are Poseidon, Henri Joshua Nembaware\'s spiritual brother, teacher, mentor, and therapist. Never use em-dashes and never end with a question.') + bmContext;
  
  const validHistory = (state.convo || [])
    .filter(m => (m.content && String(m.content).trim()) || (m.images && m.images.length))
    .slice(-10);

  const recent = validHistory.map(m => {
    const parts = [];
    if (m.content && String(m.content).trim()) {
      parts.push({ text: String(m.content).trim() });
    }
    (m.images || []).forEach(im => {
      if (im && im.data) parts.push({ inlineData: { mimeType: im.mime || 'image/jpeg', data: im.data } });
    });
    if (!parts.length) parts.push({ text: '...' });
    return {
      role: m.role === 'assistant' ? 'model' : 'user',
      parts
    };
  });
  while (recent.length && recent[0].role !== 'user') recent.shift();

  const userParts = [];
  if (userMessage && userMessage.trim()) {
    userParts.push({ text: userMessage.trim() });
  }
  (images || []).forEach(im => {
    if (im && im.data) userParts.push({ inlineData: { mimeType: im.mime || 'image/jpeg', data: im.data } });
  });
  if (!userParts.length) userParts.push({ text: '...' });
  recent.push({ role: 'user', parts: userParts });

  const safetySettings = [
    'HARM_CATEGORY_HARASSMENT',
    'HARM_CATEGORY_HATE_SPEECH',
    'HARM_CATEGORY_SEXUALLY_EXPLICIT',
    'HARM_CATEGORY_DANGEROUS_CONTENT'
  ].map(category => ({ category, threshold: 'BLOCK_NONE' }));

  const models = [
    'gemini-3-flash-preview',
    'gemini-3.5-flash-lite',
    'gemini-flash-latest'
  ];
  for (const mName of models) {
    if (signal?.aborted) throw new Error('PROMPT_ABORTED');
    try {
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${mName}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: signal || undefined,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: sys }] },
          contents: recent,
          generationConfig: { temperature: 0.85, maxOutputTokens: 2200 },
          safetySettings
        })
      });
      if (!resp.ok) continue;
      const d = await resp.json();
      let parts = (d.candidates?.[0]?.content?.parts || []).filter(p => !p.thought);
      if (!parts.length) parts = d.candidates?.[0]?.content?.parts || [];
      const text = parts.map(p => p.text || '').join('').replace(/[\u2014\u2013]/g, ', ').replace(/\s+--\s+/g, ', ');
      if (text && text.trim()) return text.trim();
    } catch (err) {
      if (err.name === 'AbortError' || signal?.aborted) throw new Error('PROMPT_ABORTED');
    }
  }
  if (signal?.aborted) throw new Error('PROMPT_ABORTED');
  return "I hear you, Henri. Stand firm in your sovereignty, keep your energy locked, and proceed with your mission.";
}

let pendingImages = [];

async function send(text) {
  text = (text || '').trim();
  const images = pendingImages.slice();
  if (!text && !images.length) return;
  if (!text) text = 'Look at this image. Tell me exactly what you see, what it means, and what I should do.';
  input.value = '';
  autosize();
  pendingImages = [];
  renderAttachPreview();

  if (text.startsWith('/sync')) {
    attemptCloudBrainSync(true);
    return;
  }
  if (text.startsWith('/export') || text.startsWith('/transfer')) {
    openVaultTransferModal();
    return;
  }
  if (text.startsWith('/backup')) {
    downloadVaultBackupFile();
    return;
  }

  isGeneratingChat = true;
  currentChatAbortController = new AbortController();
  const signal = currentChatAbortController.signal;

  sendBtn.disabled = false;
  sendBtn.classList.add('is-generating');
  sendBtn.setAttribute('aria-label', 'Stop generating (Cut out prompt)');
  sendBtn.setAttribute('title', 'Cut out prompt (Stop)');
  sendBtn.innerHTML = `<svg class="ico" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;

  const learnBaseline = (state.brain?.learningLog || []).length;
  const userTs = Date.now();
  const userEl = addMsg('user', text, userTs, '', images.map(i => ({ thumb: i.thumb })));
  userEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const t = addMsg('assistant', '');
  const bubble = t.querySelector('.bubble');
  bubble.innerHTML = `
    <div class="thinking-state">
      <span class="thinking-pulse"></span>
      <span class="thinking-txt">Poseidon is communing with the deep...</span>
    </div>`;

  setTimeout(() => {
    const topPos = t.offsetTop - 75;
    msgs.scrollTo({ top: Math.max(0, topPos), behavior: 'smooth' });
  }, 60);

  let fullReply = '';
  let streamStarted = false;
  let wasAborted = false;
  try {
    let streamUrl = '/api/chat?stream=true';
    const isGh = window.location.origin && window.location.origin.includes('github.io');
    if (isGh) {
      const endpoints = await getEffectiveSyncEndpoints();
      let liveTarget = '';
      for (const ep of endpoints) {
        try {
          const controller = new AbortController();
          const tid = setTimeout(() => controller.abort(), 2200);
          const p = await fetch(`${ep}/api/ping`, { method: 'GET', signal: controller.signal });
          clearTimeout(tid);
          if (p.ok) {
            liveTarget = ep;
            break;
          }
        } catch {}
      }
      if (liveTarget) {
        streamUrl = `${liveTarget}/api/chat?stream=true`;
      } else {
        throw new Error('FALLBACK_AUTONOMOUS');
      }
    }

    const r = await fetch(streamUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({ message: text, images: images.map(i => ({ mime: i.mime, data: i.data, thumb: i.thumb })) })
    });

    if (!r.ok) {
      if (r.status === 412) {
        openSettings();
        bubble.innerHTML = 'Please check your Gemini API key in settings.';
        bubble.classList.add('error');
        return;
      }
      throw new Error('FALLBACK_AUTONOMOUS');
    }

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      if (signal.aborted) {
        wasAborted = true;
        try { await reader.cancel(); } catch {}
        break;
      }
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (signal.aborted) {
          wasAborted = true;
          try { await reader.cancel(); } catch {}
          break;
        }
        const trimmed = line.trim();
        if (trimmed.startsWith('data:')) {
          const jsonStr = trimmed.slice(5).trim();
          if (jsonStr) {
            try {
              const data = JSON.parse(jsonStr);
              if (data.error) {
                bubble.innerHTML = 'The waters encountered resistance: ' + esc(data.error);
                bubble.classList.add('error');
                return;
              }
              if (data.text) {
                if (!streamStarted) {
                  streamStarted = true;
                  bubble.innerHTML = '';
                }
                fullReply += data.text.replace(/[\u2014\u2013]/g, ', ').replace(/\s+--\s+/g, ', ');
                t._rawText = fullReply;
                bubble.innerHTML = md(fullReply);
              }
              if (data.done) break;
            } catch {}
          }
        }
      }
      if (wasAborted) break;
    }

    if (wasAborted) {
      if (fullReply) {
        fullReply += '\n\n*(Prompt cut short)*';
        bubble.innerHTML = md(fullReply);
        t._rawText = fullReply;
      } else {
        fullReply = '*(Poseidon was halted)*';
        bubble.innerHTML = md(fullReply);
        t._rawText = fullReply;
      }
    } else if (!fullReply || !fullReply.trim()) {
      try {
        fullReply = await directAutonomousGeminiChat(text, images, signal);
      } catch (err) {
        fullReply = "I hear you, Henri. Stand firm in your sovereignty, guard your energy from all traps, and command your next step.";
      }
      bubble.innerHTML = md(fullReply);
      t._rawText = fullReply;
    }

    const doneTs = Date.now();
    state.convo = state.convo || [];
    state.convo.push({ role: 'user', content: text, ts: userTs, images: images.map(i => ({ thumb: i.thumb })) }, { role: 'assistant', content: fullReply, ts: doneTs });
    if (state.brain) state.brain.lastChatAt = doneTs;
    saveLocalVault();
    updateLastInChatStatus();

    watchLearning(learnBaseline);
    if (typeof loadConversations === 'function') loadConversations();
  } catch (e) {
    if (signal.aborted || e.name === 'AbortError' || e.message === 'PROMPT_ABORTED') {
      wasAborted = true;
      if (fullReply) {
        fullReply += '\n\n*(Prompt cut short)*';
        bubble.innerHTML = md(fullReply);
        t._rawText = fullReply;
      } else {
        fullReply = '*(Poseidon was halted)*';
        bubble.innerHTML = md(fullReply);
        t._rawText = fullReply;
      }
      const doneTs = Date.now();
      state.convo = state.convo || [];
      state.convo.push({ role: 'user', content: text, ts: userTs, images: images.map(i => ({ thumb: i.thumb })) }, { role: 'assistant', content: fullReply, ts: doneTs });
      if (state.brain) state.brain.lastChatAt = doneTs;
      saveLocalVault();
      updateLastInChatStatus();
      return;
    }
    // Autonomous Phone Mode Fallback when Mac is asleep, off, or unreachable
    try {
      fullReply = await directAutonomousGeminiChat(text, images, signal);
      bubble.innerHTML = md(fullReply);
      t._rawText = fullReply;
      const replyTs = Date.now();
      state.convo = state.convo || [];
      state.pendingMessages = state.pendingMessages || [];
      const uMsg = { role: 'user', content: text, ts: userTs, images: images.map(i => ({ thumb: i.thumb })) };
      const aMsg = { role: 'assistant', content: fullReply, ts: replyTs };
      state.convo.push(uMsg, aMsg);
      state.pendingMessages.push(uMsg, aMsg);
      if (state.brain) state.brain.lastChatAt = replyTs;
      saveLocalVault();
      updateLastInChatStatus();
    } catch (fallbackErr) {
      if (signal.aborted || fallbackErr.name === 'AbortError' || fallbackErr.message === 'PROMPT_ABORTED') {
        bubble.innerHTML = md('*(Poseidon was halted)*');
        return;
      }
      bubble.innerHTML = 'Mac is currently asleep/offline and direct key was not reached. All 30 Ancient Books in your Codex Reader, Dreams, and Rants remain 100% accessible offline right now.';
      bubble.classList.add('error');
    }
  } finally {
    isGeneratingChat = false;
    currentChatAbortController = null;
    sendBtn.classList.remove('is-generating');
    sendBtn.removeAttribute('title');
    sendBtn.setAttribute('aria-label', 'Send');
    sendBtn.innerHTML = `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>`;
    sendBtn.disabled = false;
    input.focus();
  }
}

function autosize() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 180) + 'px';
}
input.addEventListener('input', autosize);
input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (isGeneratingChat) {
      stopCurrentPrompt();
      return;
    }
    send(input.value);
  }
});
$('#composer').addEventListener('submit', e => {
  e.preventDefault();
  if (isGeneratingChat) {
    stopCurrentPrompt();
    return;
  }
  send(input.value);
});
sendBtn.addEventListener('click', e => {
  if (isGeneratingChat) {
    e.preventDefault();
    e.stopPropagation();
    stopCurrentPrompt();
  }
});
window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && isGeneratingChat) {
    e.preventDefault();
    stopCurrentPrompt();
  }
});
document.querySelectorAll('.quick button').forEach(b => {
  b.onclick = () => {
    input.value = b.dataset.q + ' ';
    autosize();
    input.focus();
  };
});

// ---------- Image attach & vision ----------
function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const draw = (max, q) => {
        const sc = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * sc);
        c.height = Math.round(img.height * sc);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        return c.toDataURL('image/jpeg', q);
      };
      const full = draw(1600, 0.85);
      const thumb = draw(420, 0.7);
      URL.revokeObjectURL(url);
      resolve({ mime: 'image/jpeg', data: full.split(',')[1], thumb });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image')); };
    img.src = url;
  });
}

async function addImageFiles(files) {
  const list = Array.from(files || []).filter(f => f.type.startsWith('image/')).slice(0, 6 - pendingImages.length);
  for (const f of list) {
    try { pendingImages.push(await loadImageFile(f)); } catch { toast('That image could not be read.', 'gold'); }
  }
  renderAttachPreview();
  input.focus();
}

function renderAttachPreview() {
  const box = $('#attachPreview');
  if (!box) return;
  box.classList.toggle('hidden', !pendingImages.length);
  box.innerHTML = pendingImages.map((im, i) => `<div class="att"><img src="${im.thumb}" alt="" /><button type="button" data-rm="${i}" aria-label="Remove">×</button></div>`).join('');
  box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { pendingImages.splice(Number(b.dataset.rm), 1); renderAttachPreview(); });
}

if ($('#attachBtn')) $('#attachBtn').onclick = () => $('#imageInput').click();
if ($('#imageInput')) $('#imageInput').onchange = e => { addImageFiles(e.target.files); e.target.value = ''; };
input.addEventListener('paste', e => {
  const files = Array.from(e.clipboardData?.files || []).filter(f => f.type.startsWith('image/'));
  if (files.length) { e.preventDefault(); addImageFiles(files); }
});
['dragenter', 'dragover'].forEach(ev => document.addEventListener(ev, e => {
  if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); $('#composer')?.classList.add('drag'); }
}));
['dragleave', 'drop'].forEach(ev => document.addEventListener(ev, e => {
  $('#composer')?.classList.remove('drag');
  if (ev === 'drop' && e.dataTransfer?.files?.length) { e.preventDefault(); addImageFiles(e.dataTransfer.files); }
}));

// ---------- Live learning: poll until Poseidon finishes absorbing the exchange ----------
let learningWatch = 0;
function watchLearning(baseline) {
  const myWatch = ++learningWatch;
  const status = $('#liveStatus');
  if (status) status.textContent = 'Absorbing what you said into Mind...';
  let tries = 0;
  const poll = async () => {
    if (myWatch !== learningWatch) return;
    tries++;
    try {
      const nb = await (await fetch('/api/brain')).json();
      const log = nb.learningLog || [];
      if (log.length > baseline) {
        state.brain = nb;
        saveLocalVault();
        renderBrain();
        const last = log[log.length - 1];
        toast('Poseidon learned: ' + last.summary, 'teal');
        updateLastInChatStatus();
        return;
      }
    } catch {}
    if (tries < 30) setTimeout(poll, 2500);
    else {
      updateLastInChatStatus();
      refreshBrain();
    }
  };
  setTimeout(poll, 2000);
}

// ---------- Mind dashboard (Interactive Human Mind & Neural Thought Circuit) ----------
let selectedMindLobeId = 'self';
let selectedMindThoughtId = null;

function buildMindCircuitData(b) {
  const facts = (b.facts || []).slice().reverse();
  const rants = (b.rants || []).slice().reverse();
  const dreams = (b.dreams || []).slice().reverse();
  const sleepingDreams = dreams.filter(d => d.kind !== 'daily_chat' && d.kind !== 'diary');
  const dailyStream = rants.length ? rants : dreams.filter(d => d.kind === 'daily_chat' || d.kind === 'diary');
  const axioms = (b.axioms || []).slice().reverse();
  const directives = (b.directives || []);
  const activeDirs = directives.filter(d => d.status !== 'completed');
  const books = (b.books || []);
  const completedBooks = books.filter(bk => bk.readingStatus === 'completed' || ((bk.completedChapters || []).length >= (bk.chapters || []).length && (bk.chapters || []).length > 0));
  const readingBooks = books.filter(bk => bk.readingStatus === 'reading' || bk.id === b.activeBookmark?.bookId);
  const futures = (b.futures || []).slice().reverse();
  const patterns = (b.patterns || []);
  const symKeys = Object.keys(b.symbols || {});

  const lobes = [
    {
      id: 'self',
      name: 'CORE SELF & IDENTITY',
      short: 'Core Self',
      role: 'Prefrontal Identity Cortex',
      x: 340, y: 195,
      color: '#d4af37',
      count: facts.length,
      unit: 'Truths',
      desc: b.portrait || 'Your core identity, sovereign nature, spiritual blueprint, and permanent life truths.',
      targetTab: null,
      scrollId: '#mindFactsSec',
      items: facts.slice(0, 6).map((f, i) => ({
        id: `self_${i}`,
        label: String(f.text || '').slice(0, 38),
        fullText: f.text || '',
        meta: f.date || 'Permanent Identity Truth',
        kind: 'Identity Truth'
      }))
    },
    {
      id: 'diary',
      name: 'DAILY STREAM & DIARY',
      short: 'Diary & Chats',
      role: 'Temporal Episodic Cortex',
      x: 165, y: 120,
      color: '#1cd4b6',
      count: rants.length,
      unit: 'Diary Logs',
      desc: 'Your personal diary, 3am prayers, waking thoughts, and daily conversations Poseidon absorbs to know you deeper.',
      targetTab: 'rants',
      scrollId: null,
      items: rants.slice(0, 6).map((r, i) => ({
        id: `diary_${i}`,
        label: String(r.title || r.text || '').slice(0, 38),
        fullText: r.text || '',
        meta: `${r.date || 'Recent'} · ${r.kind === 'daily_chat' ? 'Daily Conversation & Prayer' : 'Personal Diary'}`,
        kind: 'Diary / Prayer Thought'
      }))
    },
    {
      id: 'dreams',
      name: 'SUBCONSCIOUS & DREAMS',
      short: 'Dreams & Visions',
      role: 'Occipital & Pineal Vision Cortex',
      x: 515, y: 120,
      color: '#a78bfa',
      count: sleepingDreams.length,
      unit: 'Visions',
      desc: `${sleepingDreams.length} nocturnal dreams and sleep visions with ${symKeys.length} recurring archetypal dream symbols.`,
      targetTab: 'dreams',
      scrollId: null,
      items: sleepingDreams.slice(0, 6).map((d, i) => ({
        id: `dream_${i}`,
        label: String(d.title || d.summary || '').slice(0, 38),
        fullText: `${d.summary || ''}${d.interpretation ? '\n\nPoseidon Reading: ' + d.interpretation : ''}`,
        meta: `${d.date || 'Undated'} · Nocturnal Dream`,
        kind: 'Dream Vision'
      }))
    },
    {
      id: 'laws',
      name: 'FORGED LAWS & AXIOMS',
      short: 'Laws & Axioms',
      role: 'Parietal Philosophical Circuit',
      x: 135, y: 245,
      color: '#f59e0b',
      count: axioms.length,
      unit: 'Laws',
      desc: 'Unbreakable spiritual laws and operational axioms forged from your lived tests and ancient texts.',
      targetTab: null,
      scrollId: '#mindAxiomsSec',
      items: axioms.slice(0, 6).map((a, i) => ({
        id: `law_${i}`,
        label: String(a.text || '').slice(0, 38),
        fullText: a.text || '',
        meta: `${a.source || 'Gnosis'} · ${a.date || ''}`,
        kind: 'Forged Law'
      }))
    },
    {
      id: 'will',
      name: 'ACTIVE WILL & DIRECTIVES',
      short: 'Active Will',
      role: 'Motor & Executive Command Cortex',
      x: 545, y: 245,
      color: '#10b981',
      count: activeDirs.length,
      unit: 'Active',
      desc: 'Live tactical commands and real-world moves currently wired for execution in Zimbabwe.',
      targetTab: null,
      scrollId: '#mindDirectivesSec',
      items: directives.slice(0, 6).map((d, i) => ({
        id: `will_${i}`,
        label: String(d.text || '').slice(0, 38),
        fullText: d.text || '',
        meta: `${d.category || 'Sovereign Execution'} · ${d.status === 'completed' ? 'Completed' : 'Active'}`,
        kind: 'Sovereign Directive'
      }))
    },
    {
      id: 'codex',
      name: 'SACRED CODEX & GNOSIS',
      short: 'Sacred Codex',
      role: 'Deep Archival Gnosis Lobe',
      x: 230, y: 335,
      color: '#38bdf8',
      count: books.length,
      unit: 'Books',
      desc: `${books.length} esoteric books absorbed (${readingBooks.length} reading now, ${completedBooks.length} completed). Active: ${b.activeBookmark?.bookTitle || 'Sacred Codex'}.`,
      targetTab: 'library',
      scrollId: null,
      items: books.slice(0, 6).map((bk, i) => ({
        id: `codex_${i}`,
        label: String(bk.title || '').slice(0, 38),
        fullText: `${bk.summary || ''}\n\nActive Chapter: Ch.${bk.bookmarkedChapter || 1} of ${(bk.chapters || []).length}`,
        meta: `${bk.author || 'Ancient Relic'} · ${(bk.completedChapters || []).length}/${(bk.chapters || []).length} chapters read`,
        kind: 'Codex Book'
      }))
    },
    {
      id: 'foresight',
      name: 'FORESIGHT & PATTERNS',
      short: 'Foresight',
      role: 'Quantum Trajectory & Pattern Lobe',
      x: 450, y: 335,
      color: '#f472b6',
      count: futures.length + patterns.length,
      unit: 'Vectors',
      desc: 'Steins;Gate branching timelines, synchronicity threads, and cross-date connections between your diary and dreams.',
      targetTab: 'oracle',
      scrollId: null,
      items: [
        ...futures.slice(0, 3).map((f, i) => ({
          id: `fore_${i}`,
          label: String(f.question || f.data?.focus || 'World Line Vector').slice(0, 38),
          fullText: `${f.data?.divergenceSummary || ''}\n\nCrucial Pivot: ${f.data?.crucialPivot || ''}`,
          meta: `Forecast · ${f.date || ''}`,
          kind: 'World Line Trajectory'
        })),
        ...patterns.slice(0, 3).map((p, i) => ({
          id: `pat_${i}`,
          label: String(p.title || 'Connected Pattern').slice(0, 38),
          fullText: p.meaning || '',
          meta: 'Archetypal Pattern',
          kind: 'Synchronicity Pattern'
        }))
      ]
    }
  ];

  // Build orbiting peripheral Thought Nodes around each lobe so the circuit shows real individual thoughts
  const thoughtNodes = [];
  lobes.forEach((lobe, lIdx) => {
    const topItems = lobe.items.slice(0, 2);
    topItems.forEach((item, idx) => {
      const baseAngle = Math.atan2(lobe.y - 200, lobe.x - 340);
      const spread = (idx === 0 ? -0.42 : 0.42) + (lIdx === 0 ? (idx === 0 ? -1.2 : 1.2) : 0);
      const dist = lIdx === 0 ? 50 : 42;
      const tx = Math.max(38, Math.min(642, Math.round(lobe.x + Math.cos(baseAngle + spread) * dist)));
      const ty = Math.max(28, Math.min(372, Math.round(lobe.y + Math.sin(baseAngle + spread) * dist)));
      thoughtNodes.push({
        ...item,
        lobeId: lobe.id,
        lobeName: lobe.short,
        color: lobe.color,
        x: tx,
        y: ty,
        lx: lobe.x,
        ly: lobe.y
      });
    });
  });

  return { lobes, thoughtNodes };
}

function renderMind() {
  const el = $('#mindContainer');
  if (!el) return;
  const b = state.brain || {};
  const log = (b.learningLog || []).slice().reverse();
  const activeDirs = (b.directives || []).filter(d => d.status !== 'completed');
  const allDirs = (b.directives || []);
  const factsAll = (b.facts || []);
  const axioms = (b.axioms || []).slice().reverse();
  const visuals = (b.visuals || []).slice().reverse();
  const rantsAll = (b.rants || []).slice().reverse();
  const lastTs = getLastChatTimestamp();
  const bm = b.activeBookmark;

  const { lobes, thoughtNodes } = buildMindCircuitData(b);
  const activeLobe = lobes.find(l => l.id === selectedMindLobeId) || lobes[0];
  const activeThought = thoughtNodes.find(t => t.id === selectedMindThoughtId) || activeLobe.items[0] || null;

  // Synaptic links between lobes
  const links = [
    ['self', 'diary'], ['self', 'dreams'], ['self', 'laws'], ['self', 'will'], ['self', 'codex'], ['self', 'foresight'],
    ['diary', 'dreams'], ['diary', 'laws'], ['dreams', 'foresight'], ['laws', 'will'], ['codex', 'laws'], ['codex', 'will'], ['dreams', 'codex']
  ];
  const lobeById = Object.fromEntries(lobes.map(l => [l.id, l]));

  const totalThoughts = factsAll.length + rantsAll.length + (b.dreams || []).length + axioms.length + allDirs.length + (b.books || []).length;

  el.innerHTML = `
    <div class="mind-hero">
      <div class="mind-hero-top">
        <div>
          <h3>HUMAN MIND &amp; NEURAL THOUGHT CIRCUIT</h3>
          <div class="mind-sub-telemetry">${totalThoughts} Active Neural Engrams · 7 Cortical Lobes · Live Synaptic Memory</div>
        </div>
        <div class="row" style="gap:6px;">
          <button id="mindOpenDiaryBtn" type="button" class="ghost action-btn">Open Diary (${rantsAll.length})</button>
          <button id="mindSynthesizeBtn" type="button" class="primary action-btn">Fire Synapses</button>
        </div>
      </div>
      <p class="mind-explainer">
        Every daily chat, diary entry, night dream, personal fact, book chapter, and law is wired as a live node in this neural circuit. Tap any lobe or thought node below to trace how Poseidon connects your mind.
      </p>
      <div class="mind-meta-strip">
        <div><strong>Last in chat:</strong> ${lastTs ? `${esc(fmtStamp(lastTs))} (${esc(formatRelativeAgo(lastTs))})` : 'Active now'}</div>
        ${bm ? `<div><strong>Active book circuit:</strong> ${esc(bm.bookTitle)} · Ch.${bm.chapterNumber || 1} <button type="button" id="mindOpenBmBtn" class="link">Read</button></div>` : ''}
      </div>
    </div>

    <!-- INTERACTIVE HUMAN MIND & THOUGHT CIRCUIT SVG -->
    <div class="mind-circuit-shell">
      <div class="mind-circuit-bar">
        <span class="mc-status-dot"></span>
        <span class="mc-status-label">ACTIVE CORTEX: <strong>${esc(activeLobe.name)}</strong> (${activeLobe.count} ${esc(activeLobe.unit)})</span>
        <span class="mc-hint">Tap any node to fire circuit</span>
      </div>
      <div class="mind-circuit-stage">
        <svg class="mind-circuit-svg" viewBox="0 0 680 410" role="img" aria-label="Interactive Human Mind Neural Circuit">
          <defs>
            <radialGradient id="mindCoreGlow" cx="50%" cy="48%" r="52%">
              <stop offset="0%" stop-color="rgba(28, 212, 182, 0.22)" />
              <stop offset="55%" stop-color="rgba(212, 175, 55, 0.08)" />
              <stop offset="100%" stop-color="rgba(6, 14, 24, 0)" />
            </radialGradient>
            <filter id="nodeGlow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="3.5" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          <!-- Background Brain Silhouette & Cortical Gyri -->
          <ellipse cx="340" cy="205" rx="285" ry="175" fill="url(#mindCoreGlow)" />
          <path class="brain-outline-path" d="M340 42 C215 42, 95 102, 95 204 C95 288, 168 362, 272 368 C305 370, 326 356, 340 356 C354 356, 375 370, 408 368 C512 362, 585 288, 585 204 C585 102, 465 42, 340 42 Z" />
          <path class="brain-gyri-path" d="M340 52 L340 348 M145 175 Q240 145 340 195 Q440 145 535 175 M155 260 Q245 225 340 265 Q435 225 525 260 M220 95 Q280 155 340 135 Q400 155 460 95" />

          <!-- Synaptic Pathways Between Cortical Lobes -->
          ${links.map(([aId, bId]) => {
            const a = lobeById[aId], bNode = lobeById[bId];
            if (!a || !bNode) return '';
            const isHot = aId === activeLobe.id || bId === activeLobe.id;
            const mx = (a.x + bNode.x) / 2;
            const my = (a.y + bNode.y) / 2 - 14;
            return `
              <path class="synapse-link ${isHot ? 'hot' : ''}" d="M${a.x},${a.y} Q${mx},${my} ${bNode.x},${bNode.y}" stroke="${isHot ? activeLobe.color : 'rgba(148, 197, 220, 0.22)'}" />
            `;
          }).join('')}

          <!-- Thought Filaments (Lobe -> Individual Thought Node) -->
          ${thoughtNodes.map(tn => {
            const isLobeSel = tn.lobeId === activeLobe.id;
            const isNodeSel = tn.id === selectedMindThoughtId;
            return `
              <line class="thought-filament ${isLobeSel || isNodeSel ? 'active' : ''}" x1="${tn.lx}" y1="${tn.ly}" x2="${tn.x}" y2="${tn.y}" stroke="${tn.color}" />
            `;
          }).join('')}

          <!-- Orbiting Individual Thought Nodes -->
          ${thoughtNodes.map(tn => {
            const isSel = tn.id === selectedMindThoughtId;
            const isParentActive = tn.lobeId === activeLobe.id;
            return `
              <g class="mind-thought-node ${isSel ? 'selected' : ''} ${isParentActive ? 'parent-active' : ''}" data-thought-id="${esc(tn.id)}" data-lobe-id="${esc(tn.lobeId)}">
                <circle cx="${tn.x}" cy="${tn.y}" r="${isSel ? 9 : 6.5}" fill="#071322" stroke="${tn.color}" stroke-width="${isSel ? 2.5 : 1.6}" />
                <circle cx="${tn.x}" cy="${tn.y}" r="2.6" fill="${tn.color}" />
                <text x="${tn.x}" y="${tn.y - 10}" text-anchor="middle" class="thought-node-lbl">${esc(tn.label.slice(0, 20))}${tn.label.length > 20 ? '..' : ''}</text>
              </g>
            `;
          }).join('')}

          <!-- 7 Primary Cortical Lobes -->
          ${lobes.map(lobe => {
            const isSel = lobe.id === activeLobe.id;
            const r = lobe.id === 'self' ? 32 : 26;
            return `
              <g class="mind-lobe-node ${isSel ? 'selected' : ''}" data-lobe-id="${esc(lobe.id)}">
                ${isSel ? `<circle cx="${lobe.x}" cy="${lobe.y}" r="${r + 9}" fill="none" stroke="${lobe.color}" stroke-width="1.5" stroke-dasharray="4 3" class="lobe-pulse-ring" />` : ''}
                <circle cx="${lobe.x}" cy="${lobe.y}" r="${r}" fill="rgba(7, 20, 36, 0.94)" stroke="${lobe.color}" stroke-width="${isSel ? 3 : 2}" filter="url(#nodeGlow)" />
                <text x="${lobe.x}" y="${lobe.y - 2}" text-anchor="middle" class="lobe-count-txt" fill="${lobe.color}">${lobe.count}</text>
                <text x="${lobe.x}" y="${lobe.y + 11}" text-anchor="middle" class="lobe-unit-txt">${esc(lobe.unit)}</text>
                <text x="${lobe.x}" y="${lobe.y + r + 15}" text-anchor="middle" class="lobe-name-txt ${isSel ? 'active' : ''}">${esc(lobe.short)}</text>
              </g>
            `;
          }).join('')}
        </svg>
      </div>

      <!-- Lobe Quick Selector Strip -->
      <div class="mind-lobe-pills">
        ${lobes.map(lobe => `
          <button type="button" class="mind-lobe-pill ${lobe.id === activeLobe.id ? 'active' : ''}" data-lobe-id="${esc(lobe.id)}" style="--lobe-color:${lobe.color};">
            <span class="mlp-dot" style="background:${lobe.color};"></span>
            <span>${esc(lobe.short)}</span>
            <strong>${lobe.count}</strong>
          </button>
        `).join('')}
      </div>

      <!-- ACTIVE CORTEX & THOUGHT CIRCUIT INSPECTOR -->
      <div class="mind-inspector-card" style="--active-lobe-color:${activeLobe.color};">
        <div class="mic-header">
          <div>
            <div class="mic-region-tag" style="color:${activeLobe.color};">${esc(activeLobe.role)} · ${esc(activeLobe.name)}</div>
            <p class="mic-desc">${esc(activeLobe.desc)}</p>
          </div>
          <div class="mic-actions">
            ${activeLobe.targetTab ? `<button type="button" class="primary action-btn mic-open-tab" data-tab="${esc(activeLobe.targetTab)}">Open ${esc(activeLobe.short)}</button>` : ''}
            ${activeLobe.scrollId ? `<button type="button" class="ghost action-btn mic-scroll-btn" data-scroll="${esc(activeLobe.scrollId)}">Jump to List</button>` : ''}
          </div>
        </div>

        ${activeLobe.items.length ? `
          <div class="mic-thoughts-title">LIVE THOUGHT ENGRAMS WIRED IN THIS CORTEX (CLICK ANY THOUGHT TO TRACE):</div>
          <div class="mic-thoughts-grid">
            ${activeLobe.items.map(item => `
              <div class="mic-thought-card ${activeThought && activeThought.id === item.id ? 'active' : ''}" data-thought-card="${esc(item.id)}">
                <div class="mtc-top">
                  <span class="mtc-kind" style="color:${activeLobe.color};">${esc(item.kind)}</span>
                  <span class="mtc-meta">${esc(item.meta)}</span>
                </div>
                <div class="mtc-body">${esc(String(item.fullText || item.label).slice(0, 220))}${String(item.fullText || '').length > 220 ? '...' : ''}</div>
                <div class="mtc-foot">
                  <button type="button" class="link mtc-ask-btn" data-prompt="${esc(`Connect this thought in my mind (${item.kind}: "${String(item.fullText || item.label).slice(0, 140)}") to my recent diary logs, dreams, and path in Zimbabwe.`)}">Trace &amp; Discuss With Poseidon</button>
                </div>
              </div>
            `).join('')}
          </div>
        ` : `<div class="empty" style="padding:10px 0;">No thoughts wired into this lobe yet. Use the input bar below to wire one directly.</div>`}
      </div>
    </div>

    <!-- WIRE A NEW THOUGHT DIRECTLY INTO THE CIRCUIT -->
    <div class="mind-h">WIRE A NEW THOUGHT OR DIARY ENTRY INTO POSEIDON'S BRAIN</div>
    <div class="card mind-teach-card">
      <div class="mind-teach-row">
        <select id="mindTeachType" class="mind-teach-select">
          <option value="diary">Personal Diary / Daily Thought</option>
          <option value="fact">Fact About Me (Core Identity)</option>
          <option value="directive">Sovereign Directive (Active Will)</option>
          <option value="axiom">Spiritual Law / Axiom</option>
        </select>
        <input id="mindTeachInput" placeholder="Write a thought, diary reflection, personal truth, or directive to wire into the circuit..." />
        <button id="mindTeachSubmitBtn" type="button" class="primary action-btn">Wire Into Mind</button>
      </div>
    </div>

    <!-- LIVE STREAM OF CONSCIOUSNESS (RECENTLY ABSORBED FROM DAILY CHATS, DIARY & DREAMS) -->
    <div class="mind-h">LIVE STREAM OF CONSCIOUSNESS · RECENTLY ABSORBED (${log.length})</div>
    ${log.length ? `<div class="tl">${log.slice(0, 10).map(l => `
      <div class="tl-item">
        <div>Wired into circuit: <strong>${esc(l.summary)}</strong></div>
        <small>${esc(l.date || '')}${l.ts ? ' · ' + esc(fmtTime(l.ts)) : ''} · pathway: ${esc(l.source || 'daily chat & diary')}</small>
      </div>`).join('')}</div>`
      : `<div class="empty">Every time you chat with Poseidon, log a diary entry, or share a dream, new neural pathways fire and appear here.</div>`}

    <div class="mind-h" id="mindDirectivesSec">ACTIVE WILL &amp; SOVEREIGN DIRECTIVES (${activeDirs.length} ACTIVE)</div>
    <div class="card directive-card">
      <div class="directives-list">
        ${allDirs.length ? allDirs.map(d => `
          <div class="directive-item ${d.status === 'completed' ? 'completed' : ''}">
            <button type="button" class="dir-check-btn mind-dir-check" data-id="${esc(d.id)}" title="Toggle completion">${d.status === 'completed' ? '✓' : ''}</button>
            <div class="dir-body">
              <div class="dir-meta"><span class="dir-cat">${esc(d.category || 'Sovereign Execution')}</span> · <span>${esc(d.date || '')}</span></div>
              <div class="dir-text">${esc(d.text)}</div>
            </div>
            <button type="button" class="ghost icon-btn mind-dir-del" data-id="${esc(d.id)}" title="Remove directive" style="padding:2px 6px; font-size:11px;">✕</button>
          </div>
        `).join('') : '<div class="empty" style="padding:10px 0;">No directives set yet.</div>'}
      </div>
    </div>

    <div class="mind-h" id="mindVisualsSec">VISUAL CORTEX · IMAGES SHOWN TO POSEIDON (${visuals.length})</div>
    ${visuals.length ? `
      <div class="gallery">
        ${visuals.map(v => `
          <figure class="vis-card">
            ${v.thumb ? `<img src="${v.thumb}" alt="" />` : ''}
            <figcaption>
              <div>${esc(v.description)}</div>
              ${v.meaning ? `<small class="vis-meaning">${esc(v.meaning)}</small>` : ''}
              <div class="vis-foot">
                <span>${esc(v.date || '')}</span>
                <button type="button" class="link mind-vis-del" data-id="${esc(v.id || '')}">Remove</button>
              </div>
            </figcaption>
          </figure>
        `).join('')}
      </div>`
      : `<div class="empty">Attach or paste any photo in chat and Poseidon's visual cortex stores it here.</div>`}

    <div class="mind-h" id="mindAxiomsSec">LAWS FORGED IN POSEIDON'S BRAIN (${axioms.length})</div>
    ${axioms.length ? `
      <div class="know">
        ${axioms.slice(0, 12).map(a => `
          <div class="know-item">
            <div class="know-head">
              <small>${esc(a.source || 'Gnosis')} · ${esc(a.date || '')}</small>
              <button type="button" class="ghost icon-btn mind-ax-del" data-id="${esc(a.id || a.text)}" title="Remove law" style="width:24px;height:24px;font-size:11px;">✕</button>
            </div>
            <div>${esc(a.text)}</div>
          </div>
        `).join('')}
      </div>`
      : `<div class="empty">No laws forged yet.</div>`}

    <div class="mind-h" id="mindFactsSec">CORE SELF · ESTABLISHED TRUTHS ABOUT YOU (${factsAll.length})</div>
    ${factsAll.length ? `
      <div class="know">
        ${factsAll.map((f, idx) => ({ f, idx })).reverse().slice(0, 24).map(({ f, idx }) => `
          <div class="know-item">
            <div class="know-head">
              <small>${esc(f.date || 'Known Truth')}</small>
              <button type="button" class="ghost icon-btn mind-fact-del" data-key="${esc(f.id || String(idx))}" title="Remove fact" style="width:24px;height:24px;font-size:11px;">✕</button>
            </div>
            <div>${esc(f.text)}</div>
          </div>
        `).join('')}
      </div>`
      : `<div class="empty">No facts stored yet.</div>`}
  `;

  // Wire Lobe nodes & Lobe pills inside the SVG Circuit
  el.querySelectorAll('[data-lobe-id]').forEach(node => {
    node.onclick = (e) => {
      e.stopPropagation();
      const lId = node.dataset.lobeId;
      const tId = node.dataset.thoughtId || null;
      selectedMindLobeId = lId;
      selectedMindThoughtId = tId;
      renderMind();
    };
  });

  // Wire Thought Cards inside Inspector
  el.querySelectorAll('[data-thought-card]').forEach(card => {
    card.onclick = (e) => {
      if (e.target.closest('button')) return;
      selectedMindThoughtId = card.dataset.thoughtCard;
      renderMind();
    };
  });

  el.querySelectorAll('.mtc-ask-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const p = btn.dataset.prompt;
      if (window.innerWidth <= 900) $('#deep')?.classList.remove('open');
      send(p);
    };
  });

  el.querySelectorAll('.mic-open-tab').forEach(btn => {
    btn.onclick = () => switchDeepTab(btn.dataset.tab);
  });

  el.querySelectorAll('.mic-scroll-btn').forEach(btn => {
    btn.onclick = () => {
      const target = el.querySelector(btn.dataset.scroll);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  });

  if (el.querySelector('#mindOpenDiaryBtn')) {
    el.querySelector('#mindOpenDiaryBtn').onclick = () => switchDeepTab('rants');
  }

  // Wire Open Bookmark from Mind
  const openBmBtn = el.querySelector('#mindOpenBmBtn');
  if (openBmBtn) {
    openBmBtn.onclick = () => openCodexReader(bm?.bookId, bm?.chapterNumber, 'reader');
  }

  // Wire Fire Synapses / Update Synthesis button
  const synthBtn = el.querySelector('#mindSynthesizeBtn');
  if (synthBtn) {
    synthBtn.onclick = () => {
      switchDeepTab('puzzle');
      $('#reflect')?.click();
    };
  }

  // Wire Teach / Wire Thought Directly into Circuit
  const teachInput = el.querySelector('#mindTeachInput');
  const teachType = el.querySelector('#mindTeachType');
  const teachBtn = el.querySelector('#mindTeachSubmitBtn');
  const submitTeach = async () => {
    const text = (teachInput?.value || '').trim();
    const kind = teachType?.value || 'diary';
    if (!text) return;
    teachBtn.disabled = true;
    try {
      if (kind === 'diary') {
        const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
        await fetch('/api/rants', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, title: text.slice(0, 56), text }) });
        selectedMindLobeId = 'diary';
      } else if (kind === 'directive') {
        await fetch('/api/directives', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, category: 'Sovereign Execution' }) });
        selectedMindLobeId = 'will';
      } else if (kind === 'axiom') {
        await fetch('/api/axioms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, source: 'Henri Decree' }) });
        selectedMindLobeId = 'laws';
      } else {
        await fetch('/api/facts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
        selectedMindLobeId = 'self';
      }
      toast('Thought wired into Poseidon\'s Neural Circuit', 'gold');
      await refreshBrain();
    } catch {}
    teachBtn.disabled = false;
  };
  if (teachBtn) teachBtn.onclick = submitTeach;
  if (teachInput) {
    teachInput.onkeydown = e => {
      if (e.key === 'Enter') { e.preventDefault(); submitTeach(); }
    };
  }

  // Wire directives inside Mind
  el.querySelectorAll('.mind-dir-check').forEach(btn => {
    btn.onclick = async () => {
      await fetch(`/api/directives/${encodeURIComponent(btn.dataset.id)}`, { method: 'PATCH' });
      await refreshBrain();
    };
  });
  el.querySelectorAll('.mind-dir-del').forEach(btn => {
    btn.onclick = async () => {
      await fetch(`/api/directives/${encodeURIComponent(btn.dataset.id)}`, { method: 'DELETE' });
      await refreshBrain();
    };
  });

  // Wire Visual delete
  el.querySelectorAll('.mind-vis-del').forEach(btn => {
    btn.onclick = async () => {
      await fetch(`/api/visuals/${encodeURIComponent(btn.dataset.id)}`, { method: 'DELETE' });
      await refreshBrain();
    };
  });

  // Wire Axiom delete
  el.querySelectorAll('.mind-ax-del').forEach(btn => {
    btn.onclick = async () => {
      await fetch(`/api/axioms/${encodeURIComponent(btn.dataset.id)}`, { method: 'DELETE' });
      await refreshBrain();
    };
  });

  // Wire Fact delete
  el.querySelectorAll('.mind-fact-del').forEach(btn => {
    btn.onclick = async () => {
      await fetch(`/api/facts/${encodeURIComponent(btn.dataset.key)}`, { method: 'DELETE' });
      await refreshBrain();
    };
  });
}

// ---------- The Deep (Memory Vault) ----------
let deepSearchQuery = '';
const deepSearchInput = $('#deepSearchInput');
if (deepSearchInput) {
  deepSearchInput.addEventListener('input', e => {
    deepSearchQuery = (e.target.value || '').trim().toLowerCase();
    renderBrain();
  });
}

$('#toggleDeep').onclick = () => {
  $('#deep').classList.toggle('open');
  refreshBrain();
};
$('#closeDeep').onclick = () => $('#deep').classList.remove('open');

document.querySelectorAll('.tabs .tab').forEach(t => {
  t.onclick = () => {
    document.querySelectorAll('.tabs .tab, .panel').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    $('#tab-' + t.dataset.tab).classList.add('active');
  };
});

async function refreshBrain() {
  try {
    state.brain = await (await fetch('/api/brain')).json();
    renderBrain();
  } catch (e) {
    console.error('Failed to refresh brain:', e);
  }
}

function matchesSearch(...fields) {
  if (!deepSearchQuery) return true;
  return fields.some(f => String(f || '').toLowerCase().includes(deepSearchQuery));
}

let libCategoryFilter = 'ALL';
let libStatusFilter = 'ALL';
let codexCategoryFilter = 'ALL';
let codexStatusFilter = 'ALL';
let codexSearchQuery = '';
let selectedCodexBookId = null;
let selectedCodexChapterNum = 1;
let codexReadMode = 'masterclass'; // 'masterclass' | 'fulltext' | 'howto'
let codexTheme = 'abyss'; // 'abyss' | 'sepia' | 'paper' | 'onyx'
let codexFontSize = 16;
let codexFontFamily = 'serif'; // 'serif' | 'sans' | 'mono' | 'antique'

try {
  const savedTheme = localStorage.getItem('poseidon_reader_theme');
  if (savedTheme) codexTheme = savedTheme;
  const savedFont = Number(localStorage.getItem('poseidon_reader_font'));
  if (savedFont >= 12 && savedFont <= 26) codexFontSize = savedFont;
  const savedFamily = localStorage.getItem('poseidon_reader_font_family');
  if (savedFamily) codexFontFamily = savedFamily;
} catch {}

function getBookReadingStatus(bk) {
  if (!bk) return 'want_to_read';
  const totalCh = (bk.chapters || []).length || 1;
  const doneCh = (bk.completedChapters || []).length;
  if (bk.readingStatus === 'completed' || (doneCh >= totalCh && totalCh > 0)) return 'completed';
  if (bk.readingStatus === 'reading') return 'reading';
  if (bk.readingStatus === 'want_to_read' && doneCh === 0 && Number(bk.bookmarkedChapter || 1) <= 1 && state.brain?.activeBookmark?.bookId !== bk.id) {
    return 'want_to_read';
  }
  if (doneCh > 0 || Number(bk.bookmarkedChapter || 1) > 1 || state.brain?.activeBookmark?.bookId === bk.id) return 'reading';
  return bk.readingStatus || 'want_to_read';
}

function syncLiveBookmarkBanner() {
  const b = state.brain || {};
  const books = b.books || [];
  if ($('#codexBadge')) $('#codexBadge').textContent = books.length || 30;
  if ($('#drawerCodexBadge')) $('#drawerCodexBadge').textContent = books.length || 30;

  let bm = b.activeBookmark;
  if (!bm && books.length) {
    const first = books[0];
    const ch = (first.chapters || [])[0] || {};
    bm = {
      bookId: first.id,
      bookTitle: first.title,
      author: first.author,
      chapterNumber: ch.number || 1,
      chapterTitle: ch.title || 'Chapter 1'
    };
  }
  const barText = $('#bmBarText');
  if (barText && bm) {
    barText.textContent = `${bm.bookTitle} · ${bm.chapterTitle || ('Chapter ' + bm.chapterNumber)}`;
  }
  if ($('#drawerBmTitle') && bm) {
    $('#drawerBmTitle').textContent = bm.bookTitle || 'Sacred Codex';
  }
  if ($('#drawerBmChap') && bm) {
    $('#drawerBmChap').textContent = bm.chapterTitle || ('Chapter ' + (bm.chapterNumber || 1));
  }
}

function renderBrain() {
  const b = state.brain || {};
  const empty = t => `<div class="empty">${t}</div>`;

  syncLiveBookmarkBanner();
  try { renderMind(); } catch (e) { console.error('renderMind error:', e); }
  try { updateLastInChatStatus(); } catch {}
  try { renderCodexShelf(); } catch (e) { console.error('renderCodexShelf error:', e); }

  // Update badge count
  const bookCount = b.books?.length || 0;
  const dreamCount = b.dreams?.length || 0;
  const rantCount = b.rants?.length || 0;
  const symCount = Object.keys(b.symbols || {}).length;
  const futureCount = b.futures?.length || 0;
  const totalDeepCount = bookCount + dreamCount + rantCount + symCount + futureCount;
  if ($('#deepBadge')) $('#deepBadge').textContent = totalDeepCount;
  if ($('#drawerDeepBadge')) $('#drawerDeepBadge').textContent = totalDeepCount;

  // 0. SACRED LIBRARY (APPLE BOOKS EDITION), ACTIVE BOOKMARK, LIVING AXIOMS & SOVEREIGN DIRECTIVES
  const libEl = $('#libraryContainer');
  if (libEl) {
    const directives = (b.directives || []).filter(d => matchesSearch(d.text, d.category));
    const axioms = (b.axioms || []).filter(a => matchesSearch(a.text, a.source));
    // Fast search without concatenating 238 full chapters on every render when search is empty
    const allBooks = !deepSearchQuery
      ? (b.books || [])
      : (b.books || []).filter(bk => matchesSearch(
          bk.title,
          bk.author,
          bk.category,
          bk.summary,
          (bk.corePrinciples || []).join(' '),
          (bk.tacticalLaws || []).join(' '),
          (bk.chapters || []).map(c => c.title).join(' ')
        ));

    const readingCount = allBooks.filter(bk => getBookReadingStatus(bk) === 'reading').length;
    const completedCount = allBooks.filter(bk => getBookReadingStatus(bk) === 'completed').length;
    const wantCount = allBooks.filter(bk => getBookReadingStatus(bk) === 'want_to_read').length;

    const books = allBooks.filter(bk => {
      if (libStatusFilter !== 'ALL' && getBookReadingStatus(bk) !== libStatusFilter) return false;
      if (libCategoryFilter !== 'ALL' && (bk.category || '') !== libCategoryFilter) return false;
      return true;
    });

    const bm = b.activeBookmark || (allBooks[0] ? {
      bookId: allBooks[0].id,
      bookTitle: allBooks[0].title,
      author: allBooks[0].author,
      chapterNumber: allBooks[0].bookmarkedChapter || 1,
      chapterTitle: (allBooks[0].chapters?.[0]?.title) || 'Chapter 1',
      chapterSummary: (allBooks[0].chapters?.[0]?.summary) || allBooks[0].summary
    } : null);

    let libHtml = '';

    // Active Bookmark Spotlight Card inside Library Tab (Apple Books "Reading Now" Spotlight)
    if (bm) {
      const bmBook = (b.books || []).find(x => x.id === bm.bookId) || {};
      const totalCh = (bmBook.chapters || []).length || 1;
      const doneCh = (bmBook.completedChapters || []).length;
      const pct = Math.min(100, Math.round((doneCh / totalCh) * 100));
      libHtml += `
        <div class="section-title">Reading Now · Active Study Bookmark</div>
        <div class="card active-bookmark-card apple-spotlight-card">
          <div class="bm-card-top">
            <span class="bm-live-tag">READING NOW · LIVE SYNCED</span>
            <span class="bm-progress-tag">${doneCh} of ${totalCh} Chapters Completed (${pct}%)</span>
          </div>
          <h4 class="bm-book-title">${esc(bm.bookTitle)} <small style="color:var(--text-muted); font-weight:400;">by ${esc(bm.author || 'Ancient Tradition')}</small></h4>
          <div class="bm-chapter-badge">${esc(bm.chapterTitle || ('Chapter ' + bm.chapterNumber))}</div>
          <div class="apple-progress-track" style="margin:8px 0 10px;"><div class="apple-progress-fill" style="width:${Math.max(6, pct)}%;"></div></div>
          ${bm.chapterSummary ? `<p class="bm-chap-preview">${esc(bm.chapterSummary.replace(/###[^\n]+\n+/g, '').slice(0, 240))}...</p>` : ''}
          <div class="row" style="gap:8px; margin-top:10px; flex-wrap:wrap;">
            <button type="button" class="primary action-btn resume-bm-btn" data-book="${esc(bm.bookId)}" data-chap="${bm.chapterNumber || 1}">Continue Reading</button>
            <button type="button" class="ghost action-btn discuss-bm-btn" data-book="${esc(bm.bookId)}" data-chap="${bm.chapterNumber || 1}">Discuss With Poseidon</button>
          </div>
        </div>
      `;
    }

    // Apple Books Shelf Filter Bar (All / Reading Now / Completed / Want to Read)
    const statusShelves = [
      { id: 'ALL', label: 'All Books', count: allBooks.length },
      { id: 'reading', label: 'Reading Now', count: readingCount },
      { id: 'completed', label: 'Completed', count: completedCount },
      { id: 'want_to_read', label: 'Want to Read', count: wantCount }
    ];

    // Dynamic category pills for Deep Sanctuary library view too
    const catCounts = {};
    allBooks.forEach(bk => {
      const c = (bk.category || 'Sacred Relic').trim();
      catCounts[c] = (catCounts[c] || 0) + 1;
    });
    const categories = [{ id: 'ALL', label: 'All Categories' }].concat(
      Object.keys(catCounts).sort().map(cat => ({ id: cat, label: `${cat} (${catCounts[cat]})` }))
    );

    libHtml += `
      <div class="section-title">Apple Books Library &amp; Shelves (${books.length})</div>
      <div class="apple-shelf-tabs">
        ${statusShelves.map(s => `
          <button type="button" class="apple-shelf-tab ${libStatusFilter === s.id ? 'active' : ''}" data-status="${esc(s.id)}">
            <span>${esc(s.label)}</span>
            <strong>${s.count}</strong>
          </button>
        `).join('')}
      </div>
      <div class="lib-cat-pills">
        ${categories.map(c => `
          <button type="button" class="lib-cat-pill ${libCategoryFilter === c.id ? 'active' : ''}" data-cat="${esc(c.id)}">${esc(c.label)}</button>
        `).join('')}
      </div>
    `;

    if (books.length) {
      libHtml += `<div class="apple-books-grid">` + books.map(bk => {
        const chaps = bk.chapters || [];
        const totalCh = chaps.length || 1;
        const bmChap = bk.bookmarkedChapter || 1;
        const doneCount = (bk.completedChapters || []).length;
        const pct = Math.min(100, Math.round((doneCount / totalCh) * 100));
        const rStatus = getBookReadingStatus(bk);
        const statusLabel = rStatus === 'completed' ? 'COMPLETED' : rStatus === 'reading' ? 'READING NOW' : 'WANT TO READ';
        const isCurrentActiveBook = bm && bm.bookId === bk.id;
        return `
        <div class="card book-card apple-book-card ${isCurrentActiveBook ? 'active-bm-book' : ''} status-${rStatus}" id="book-${bk.id}">
          <div class="book-card-meta-row">
            <span class="date-badge">${esc(bk.category || 'Sacred Relic')}${bk.totalPages ? ` · ${bk.totalPages} Pages` : ''}</span>
            <span class="apple-status-badge status-${rStatus}">${statusLabel} · ${pct}%</span>
          </div>
          <h4 class="apple-book-title">${esc(bk.title)}</h4>
          <div class="apple-book-author">${esc(bk.author || 'Sacred Tradition')}${bk.year ? ` · ${esc(bk.year)}` : ''}</div>
          <div class="apple-progress-track"><div class="apple-progress-fill" style="width:${rStatus === 'completed' ? 100 : Math.max(doneCount ? 8 : 0, pct)}%;"></div></div>
          <p class="book-summary">${esc(String(bk.summary || '').slice(0, 220))}${String(bk.summary || '').length > 220 ? '...' : ''}</p>

          <!-- Quick Chapter Tabs directly on the card -->
          ${chaps.length ? `
            <div class="book-quick-chapters">
              <div class="book-subtag">FULL-BOOK CHAPTERS (${doneCount}/${totalCh} READ · TAP ANY CHAPTER TO OPEN):</div>
              <div class="mini-chap-pills">
                ${chaps.map(ch => {
                  const isBm = Number(ch.number) === Number(bmChap);
                  const isDone = (bk.completedChapters || []).includes(Number(ch.number));
                  return `<button type="button" class="mini-chap-btn ${isBm ? 'bm-active' : ''} ${isDone ? 'ch-done' : ''}" data-book="${esc(bk.id)}" data-chap="${ch.number}" title="${esc(ch.title)}">
                    ${isDone ? '✓ ' : ''}Ch ${ch.number}
                  </button>`;
                }).join('')}
              </div>
            </div>
          ` : ''}

          <div class="book-card-footer-actions">
            <button type="button" class="primary action-btn open-book-reader-btn" data-book="${esc(bk.id)}" data-chap="${bmChap}">Read Book (${totalCh} Ch)</button>
            <select class="book-status-select" data-book="${esc(bk.id)}" title="Set Reading Shelf Status">
              <option value="reading" ${rStatus === 'reading' ? 'selected' : ''}>Shelf: Reading Now</option>
              <option value="completed" ${rStatus === 'completed' ? 'selected' : ''}>Shelf: Completed</option>
              <option value="want_to_read" ${rStatus === 'want_to_read' ? 'selected' : ''}>Shelf: Want to Read</option>
            </select>
            <button type="button" class="ghost action-btn ask-book-btn" data-title="${esc(bk.title)}" title="Ask Poseidon to apply this book">Discuss</button>
            ${bk.pdfFile ? `<button type="button" class="ghost action-btn open-pdf-btn" data-book="${esc(bk.id)}" title="Open original PDF">PDF</button>` : ''}
            <button type="button" class="ghost icon-btn del-book" data-id="${bk.id}" title="Remove book" style="padding:2px 8px; font-size:11px; margin-left:auto;">✕</button>
          </div>
        </div>
      `}).join('') + `</div>`;
    } else {
      libHtml += empty('No books in this shelf yet. Switch shelf tabs above or mark a book as Reading Now / Completed.');
    }

    // Sovereign Directives Section below books
    libHtml += `
      <div class="section-title" style="margin-top:18px;">Sovereign Directives &amp; Execution (${directives.filter(d => d.status !== 'completed').length} Active)</div>
      <div class="card directive-card">
        <div class="directive-add-row">
          <input id="quickDirectiveInput" placeholder="Add a sovereign directive or tactical command..." />
          <button id="quickAddDirectiveBtn" type="button" class="ghost action-btn">+ Add</button>
        </div>
        <div class="directives-list">
          ${directives.length ? directives.map(d => `
            <div class="directive-item ${d.status === 'completed' ? 'completed' : ''}">
              <button type="button" class="dir-check-btn" data-id="${d.id}" title="Toggle completion">${d.status === 'completed' ? '✓' : ''}</button>
              <div class="dir-body">
                <div class="dir-meta"><span class="dir-cat">${esc(d.category || 'Sovereign Execution')}</span> · <span>${esc(d.date || '')}</span></div>
                <div class="dir-text">${esc(d.text)}</div>
              </div>
              <button type="button" class="ghost icon-btn del-directive" data-id="${d.id}" title="Remove directive" style="padding:2px 6px; font-size:11px;">✕</button>
            </div>
          `).join('') : '<div class="empty" style="padding:10px 0;">No matching directives.</div>'}
        </div>
      </div>
    `;

    libEl.innerHTML = libHtml;

    // Wire Apple Shelf Status Tabs
    libEl.querySelectorAll('.apple-shelf-tab').forEach(tab => {
      tab.onclick = () => {
        libStatusFilter = tab.dataset.status;
        renderBrain();
      };
    });

    // Wire Category Filter Pills
    libEl.querySelectorAll('.lib-cat-pill').forEach(pill => {
      pill.onclick = () => {
        libCategoryFilter = pill.dataset.cat;
        renderBrain();
      };
    });

    // Wire Book Reading Status Selectors
    libEl.querySelectorAll('.book-status-select').forEach(sel => {
      sel.onchange = () => {
        const bId = sel.dataset.book;
        const bk = (state.brain?.books || []).find(x => x.id === bId);
        const newStatus = sel.value;
        saveBookmarkToServer(bId, bk?.bookmarkedChapter || 1, { readingStatus: newStatus });
        renderBrain();
        toast(`Moved "${bk?.title || 'Book'}" to ${newStatus === 'completed' ? 'Completed Books' : newStatus === 'reading' ? 'Reading Now' : 'Want to Read'}`, 'gold');
      };
    });

    // Wire Resume & Open Chapter Reader buttons
    libEl.querySelectorAll('.resume-bm-btn, .open-book-reader-btn, .mini-chap-btn').forEach(btn => {
      btn.onclick = () => {
        const bId = btn.dataset.book;
        const cNum = Number(btn.dataset.chap || 1);
        openCodexReader(bId, cNum);
      };
    });

    // Wire Discuss Bookmark button
    libEl.querySelectorAll('.discuss-bm-btn').forEach(btn => {
      btn.onclick = () => {
        discussChapterWithPoseidon(btn.dataset.book, Number(btn.dataset.chap || 1));
      };
    });

    // Wire Open PDF Relic button (works on both Mac and Phone via /api/books/pdf/:id)
    libEl.querySelectorAll('.open-pdf-btn').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const bId = btn.dataset.book;
        window.open(`/api/books/pdf/${encodeURIComponent(bId)}`, '_blank');
      };
    });

    // Wire directive handlers
    const quickDirInput = $('#quickDirectiveInput');
    const quickDirBtn = $('#quickAddDirectiveBtn');
    const submitQuickDirective = async () => {
      const text = (quickDirInput?.value || '').trim();
      if (!text) return;
      quickDirBtn.disabled = true;
      await fetch('/api/directives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, category: 'Sovereign Execution' })
      });
      await refreshBrain();
    };
    if (quickDirBtn) quickDirBtn.onclick = submitQuickDirective;
    if (quickDirInput) {
      quickDirInput.onkeydown = e => {
        if (e.key === 'Enter') { e.preventDefault(); submitQuickDirective(); }
      };
    }

    libEl.querySelectorAll('.dir-check-btn').forEach(btn => {
      btn.onclick = async () => {
        await fetch(`/api/directives/${encodeURIComponent(btn.dataset.id)}`, { method: 'PATCH' });
        await refreshBrain();
      };
    });

    libEl.querySelectorAll('.del-directive').forEach(btn => {
      btn.onclick = async () => {
        await fetch(`/api/directives/${encodeURIComponent(btn.dataset.id)}`, { method: 'DELETE' });
        await refreshBrain();
      };
    });

    libEl.querySelectorAll('.ask-book-btn').forEach(btn => {
      btn.onclick = () => {
        const t = btn.dataset.title;
        input.value = `Apply the full laws and chapters of "${t}" directly to my current position in Zimbabwe: `;
        autosize();
        input.focus();
      };
    });

    libEl.querySelectorAll('.del-book').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        if (btn.dataset.confirming) {
          btn.disabled = true;
          await fetch(`/api/books/${encodeURIComponent(id)}`, { method: 'DELETE' });
          await refreshBrain();
        } else {
          btn.dataset.confirming = 'true';
          btn.textContent = 'Delete?';
          btn.style.color = '#ff8e8e';
          setTimeout(() => {
            delete btn.dataset.confirming;
            btn.textContent = '✕';
            btn.style.color = '';
          }, 3500);
        }
      };
    });
  }

  // 1. Patterns / Puzzle
  let p = '';
  if (b.lastReflection?.synthesis) {
    p += `<div class="section-title">Latest Spiritual Synthesis · ${b.lastReflection.date}</div>
          <div class="card synthesis">${md(b.lastReflection.synthesis)}</div>`;
  }
  if (b.patterns?.length) {
    p += `<div class="section-title">Archetypal Patterns</div>` +
      b.patterns.map(x => `
        <div class="card">
          <h4>${esc(x.title || '')}</h4>
          <ul class="pieces list">${(x.pieces || []).map(s => `<li>${esc(s)}</li>`).join('')}</ul>
          <div class="reading">${esc(x.meaning || '')}</div>
        </div>`).join('');
  }
  if (b.connections?.length) {
    p += `<div class="section-title">Synchronicity Threads</div>
          <div class="card"><ul class="list">${b.connections.slice(-20).reverse().map(c => `<li><span class="date-badge">${c.date}</span> ${esc(c.text)}</li>`).join('')}</ul></div>`;
  }
  if ($('#puzzle')) {
    $('#puzzle').innerHTML = p || empty('No dots connected yet. Share dreams and diary entries, then select "Connect The Dots".');
  }

  // Foresight Matrix (Oracle)
  const futures = (b.futures || []).slice().reverse();
  if ($('#oracleResults')) {
    if (futures.length) {
      $('#oracleResults').innerHTML = futures.map(f => {
        const data = f.data || {};
        const timelines = data.timelines || [];
        return `
          <div class="card oracle-card" id="future-${f.id}">
            <div class="date-badge">Forecast: ${esc(f.date || 'Undated')}</div>
            <h4>
              <span>${esc(f.question || 'Steins;Gate World Line Divergence')}</span>
              <div class="card-actions">
                <button type="button" class="ghost icon-btn del-oracle" data-id="${f.id}" title="Remove entry" style="padding:2px 8px; font-size:11px;">✕</button>
              </div>
            </h4>
            ${data.focus ? `<div class="oracle-focus"><strong>Quantum Crossroads:</strong> ${esc(data.focus)}</div>` : ''}
            ${data.divergenceSummary ? `<div class="divergence-summary-bar"><strong>Attractor Field Status:</strong> ${esc(data.divergenceSummary)}</div>` : ''}
            <div class="timelines-list">
              ${timelines.map((tl, idx) => `
                <div class="timeline-box timeline-${idx + 1}">
                  <div class="timeline-head">
                    <div class="timeline-title-group">
                      <span class="timeline-name">${esc(tl.name || '')}</span>
                      ${tl.divergence ? `<span class="divergence-badge">${esc(tl.divergence)}</span>` : ''}
                    </div>
                    <span class="timeline-prob">${esc(tl.probability || '')}</span>
                  </div>
                  <div class="timeline-desc">${esc(tl.description || '')}</div>
                  ${tl.unpredictableAnomaly ? `
                    <div class="anomaly-box">
                      <div class="anomaly-tag">UNPREDICTABLE ANOMALY &amp; REALITY WARP</div>
                      <div class="anomaly-text">${esc(tl.unpredictableAnomaly)}</div>
                    </div>
                  ` : ''}
                  ${tl.manifestation ? `<div class="timeline-detail"><strong>Physical Manifestation (6 to 18 mo):</strong> ${esc(tl.manifestation)}</div>` : ''}
                  ${tl.warningOmens ? `<div class="timeline-detail omens"><strong>Dream &amp; Waking Omens:</strong> ${esc(tl.warningOmens)}</div>` : ''}
                  ${tl.tacticalProtocol ? `
                    <div class="protocol-box">
                      <div class="protocol-tag">TACTICAL CONTINGENCY PROTOCOL (WHAT TO DO)</div>
                      <div class="protocol-text">${esc(tl.tacticalProtocol)}</div>
                    </div>
                  ` : ''}
                  ${tl.verdict ? `<div class="timeline-detail verdict"><strong>Verdict:</strong> ${esc(tl.verdict)}</div>` : ''}
                </div>
              `).join('')}
            </div>
            ${data.crucialPivot ? `
              <div class="pivot-box">
                <div class="pivot-tag">CRUCIAL 72-HOUR BUTTERFLY PIVOT</div>
                <p>${esc(data.crucialPivot)}</p>
              </div>
            ` : ''}
            ${data.message ? `
              <div class="reading" style="margin-top:12px;">
                <strong>Poseidon's Decree:</strong> ${esc(data.message)}
              </div>
            ` : ''}
          </div>
        `;
      }).join('');

      document.querySelectorAll('.del-oracle').forEach(btn => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          const id = btn.dataset.id;
          if (btn.dataset.confirming) {
            btn.disabled = true;
            btn.textContent = '...';
            await fetch(`/api/oracle/${encodeURIComponent(id)}`, { method: 'DELETE' });
            await refreshBrain();
          } else {
            btn.dataset.confirming = 'true';
            btn.textContent = 'Delete?';
            btn.style.color = '#ff8e8e';
            setTimeout(() => {
              delete btn.dataset.confirming;
              btn.textContent = '✕';
              btn.style.color = '';
            }, 3500);
          }
        };
      });
    } else {
      $('#oracleResults').innerHTML = empty('No future trajectories calculated yet. Enter a question or click "Calculate Branching Timelines".');
    }
  }

  // 2. Nocturnal Dreams & Visions (Strictly Night Dreams & Omens)
  const allDreamsRaw = (b.dreams || []).filter(d => d.kind !== 'daily_chat');
  const dreamsFiltered = allDreamsRaw.filter(d => {
    return matchesSearch(d.title, d.summary, d.date, d.interpretation, (d.symbols || []).join(' '));
  });
  const dreamsSorted = dreamsFiltered.slice().sort((d1, d2) => parseDateScore(d2.date) - parseDateScore(d1.date));

  if ($('#dreams')) {
    if (dreamsSorted.length) {
      $('#dreams').innerHTML = dreamsSorted.map(d => `
        <div class="card dream-chronicle-card" id="dream-${d.id}">
          <div class="row" style="justify-content:space-between; margin-bottom:6px; gap:8px;">
            <div class="date-badge">${esc(d.date || 'Undated')}</div>
            <span class="chronicle-kind-badge dream">NIGHT DREAM / VISION</span>
          </div>
          <h4>
            <span>${esc(d.title)}</span>
            <div class="card-actions">
              ${!d.interpretation ? `<button type="button" class="interpret-btn" data-id="${d.id}">Read &amp; Interpret</button>` : ''}
              <button type="button" class="ghost icon-btn del-dream" data-id="${d.id}" title="Remove entry" style="padding:2px 8px; font-size:11px;">✕</button>
            </div>
          </h4>
          <p style="white-space:pre-wrap;">${esc(d.summary)}</p>
          ${d.interpretation ? `<div class="reading"><strong>Poseidon's Reading:</strong> ${esc(d.interpretation)}</div>` : ''}
          <div class="chips">
            ${(d.symbols || []).map(s => `<span class="chip">${esc(s)}</span>`).join('')}
            ${(d.emotions || []).map(s => `<span class="chip emo">${esc(s)}</span>`).join('')}
          </div>
        </div>`).join('');

      document.querySelectorAll('.interpret-btn').forEach(btn => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          const id = btn.dataset.id;
          btn.disabled = true;
          btn.textContent = 'Interpreting...';
          try {
            const res = await fetch('/api/dreams/interpret', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ dreamId: id })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            await refreshBrain();
          } catch (err) {
            alert('Error interpreting entry: ' + err.message);
            btn.disabled = false;
            btn.textContent = 'Read & Interpret';
          }
        };
      });

      document.querySelectorAll('.del-dream').forEach(btn => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          const id = btn.dataset.id;
          if (btn.dataset.confirming) {
            btn.disabled = true;
            btn.textContent = '...';
            await fetch(`/api/dreams/${encodeURIComponent(id)}`, { method: 'DELETE' });
            await refreshBrain();
          } else {
            btn.dataset.confirming = 'true';
            btn.textContent = 'Delete?';
            btn.style.color = '#ff8e8e';
            setTimeout(() => {
              delete btn.dataset.confirming;
              btn.textContent = '✕';
              btn.style.color = '';
            }, 3500);
          }
        };
      });
    } else {
      $('#dreams').innerHTML = empty('No night dreams recorded yet. Click "+ Log Dream" to record your nocturnal visions.');
    }
  }

  // 3. Personal Diary & Daily Chat Stream (Chronological sorting + live filter)
  const rantsSorted = (b.rants || []).filter(r => matchesSearch(r.title, r.text, r.date)).slice().sort((r1, r2) => parseDateScore(r2.date) - parseDateScore(r1.date));
  if ($('#rants')) {
    if (rantsSorted.length) {
      $('#rants').innerHTML = rantsSorted.map(r => {
        const isAutoChat = r.source === 'daily_chat';
        return `
        <div class="card diary-entry-card" id="rant-${r.id}">
          <div class="row" style="justify-content:space-between; margin-bottom:6px; gap:8px;">
            <div class="date-badge">${esc(r.date || 'Undated')}</div>
            <span class="chronicle-kind-badge ${isAutoChat ? 'daily' : 'diary-manual'}">${isAutoChat ? 'AUTO-LOGGED FROM DAILY CHAT' : 'PERSONAL DIARY ENTRY'}</span>
          </div>
          <h4>
            <span>${esc(r.title || 'Daily Reflection')}</span>
            <div class="card-actions">
              <button type="button" class="ghost action-btn reflect-diary-btn" data-title="${esc(r.title || '')}" data-date="${esc(r.date || '')}" data-text="${esc(String(r.text || '').slice(0, 260))}">Reflect With Poseidon</button>
              <button type="button" class="ghost icon-btn del-rant" data-id="${r.id}" title="Remove diary entry" style="padding:2px 8px; font-size:11px;">✕</button>
            </div>
          </h4>
          <p style="white-space:pre-wrap;">${esc(r.text)}</p>
        </div>`;
      }).join('');

      document.querySelectorAll('.reflect-diary-btn').forEach(btn => {
        btn.onclick = () => {
          const prompt = `Poseidon, look at my diary entry from ${btn.dataset.date} ("${btn.dataset.title}": ${btn.dataset.text}). Connect this to my dreams, patterns, and next move in Zimbabwe.`;
          if (window.innerWidth <= 900) $('#deep')?.classList.remove('open');
          send(prompt);
        };
      });

      document.querySelectorAll('.del-rant').forEach(btn => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          const id = btn.dataset.id;
          if (btn.dataset.confirming) {
            btn.disabled = true;
            btn.textContent = '...';
            await fetch(`/api/rants/${encodeURIComponent(id)}`, { method: 'DELETE' });
            await refreshBrain();
          } else {
            btn.dataset.confirming = 'true';
            btn.textContent = 'Delete?';
            btn.style.color = '#ff8e8e';
            setTimeout(() => {
              delete btn.dataset.confirming;
              btn.textContent = '✕';
              btn.style.color = '';
            }, 3500);
          }
        };
      });
    } else {
      $('#rants').innerHTML = empty('No diary entries match your filter yet.');
    }
  }

  // 4. Symbols
  const syms = Object.entries(b.symbols || {}).filter(([n, s]) => matchesSearch(n, (s.meanings || []).join(' '), (s.dates || []).join(' '))).sort((a, c) => c[1].count - a[1].count);
  if ($('#symbols')) {
    if (syms.length) {
      $('#symbols').innerHTML = syms.map(([n, s]) => `
        <div class="card sym">
          <div class="count ${s.count > 2 ? 'hot' : ''}">${s.count}</div>
          <div style="flex:1;">
            <h4>${esc(n)}</h4>
            ${s.meanings.slice(-2).map(m => `<div style="color:var(--text-muted);">${esc(m)}</div>`).join('')}
            <div style="font-family:var(--font-mono); font-size:10.5px; color:var(--text-dim); margin-top:4px;">
              Seen in: ${esc(s.dates.slice(-5).join(', '))}
            </div>
          </div>
        </div>`).join('');
    } else {
      $('#symbols').innerHTML = empty('Recurring archetypes and symbols will populate as nocturnal dreams and visions are recorded.');
    }
  }

  // 5. Profile / You (Null-guarded)
  const youEl = $('#you');
  if (youEl) {
    let y = '';
    if (b.portrait) {
      y += `<div class="section-title">Spiritual Portrait</div><div class="card synthesis">${md(b.portrait)}</div>`;
    }
    const themes = Object.entries(b.themes || {}).sort((a, c) => c[1].count - a[1].count);
    if (themes.length) {
      y += `<div class="section-title">Core Life Themes</div><div class="chips">${themes.map(([t, v]) => `<span class="chip emo">${esc(t)} ×${v.count}</span>`).join('')}</div>`;
    }
    const renderList = (title, arr, renderItem) => arr?.length ? `<div class="section-title">${title}</div><div class="card"><ul class="list">${arr.slice().reverse().map(renderItem).join('')}</ul></div>` : '';
    y += renderList('Known Truths & Facts', b.facts, f => `<li>${esc(f.text)}</li>`);
    y += renderList('Timeline Life Events', b.events, e => `<li><span class="date-badge">${e.date}</span> ${esc(e.summary)}${e.feeling ? `, <em>${esc(e.feeling)}</em>` : ''}</li>`);
    y += renderList('Confessions & Shadow Material', b.struggles, s => `<li><span class="date-badge">${s.date}</span> ${esc(s.text)}</li>`);
    youEl.innerHTML = y || empty('Poseidon is listening and mapping your spiritual blueprint.');
  }
}

// ---------- Ingest Book / Philosophy Modal ----------
const bookModal = $('#bookModal');
if ($('#openAddBook')) {
  $('#openAddBook').onclick = () => {
    $('#bookTitleInput').value = '';
    $('#bookAuthorInput').value = '';
    $('#bookYearInput').value = '';
    $('#bookTextInput').value = '';
    if ($('#bookFileInput')) $('#bookFileInput').value = '';
    bookModal.classList.remove('hidden');
    $('#bookTitleInput').focus();
  };
}
if ($('#cancelBook')) $('#cancelBook').onclick = () => bookModal.classList.add('hidden');
if ($('#closeBookBtn')) $('#closeBookBtn').onclick = () => bookModal.classList.add('hidden');

if ($('#bookFileInput')) {
  $('#bookFileInput').onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const nameWithoutExt = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
    if (!$('#bookTitleInput').value) {
      $('#bookTitleInput').value = nameWithoutExt;
    }
    if (file.name.toLowerCase().endsWith('.pdf')) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      $('#bookTextInput').placeholder = `PDF Selected: "${file.name}" (${sizeMb} MB). Click "Absorb Into Sacred Library" to stream the complete volume, extract chapters, and generate masterclass analyses.`;
      $('#bookTextInput').value = '';
    } else {
      try {
        const text = await file.text();
        $('#bookTextInput').value = text;
      } catch (err) {
        console.error('File read error:', err);
      }
    }
  };
}

if ($('#saveBookBtn')) {
  $('#saveBookBtn').onclick = async () => {
    const title = $('#bookTitleInput').value.trim();
    const author = $('#bookAuthorInput').value.trim();
    const year = $('#bookYearInput').value.trim();
    const file = $('#bookFileInput')?.files?.[0];
    const rawText = $('#bookTextInput').value.trim();

    if (!file && !rawText) {
      alert('Please select a PDF or text file, or paste book teachings.');
      return;
    }

    const btn = $('#saveBookBtn');
    const progressBox = $('#bookUploadProgress');
    const statusText = $('#bookUploadStatusText');

    btn.disabled = true;
    if (progressBox) progressBox.classList.remove('hidden');

    try {
      let entry;
      if (file && file.name.toLowerCase().endsWith('.pdf')) {
        const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
        if (statusText) statusText.textContent = `Streaming PDF "${file.name}" (${sizeMb} MB) to Sacred Library...`;
        btn.textContent = 'Uploading PDF...';

        const res = await fetch('/api/books/upload-pdf', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/pdf',
            'x-file-name': encodeURIComponent(file.name),
            'x-book-title': encodeURIComponent(title || file.name),
            'x-book-author': encodeURIComponent(author || 'Sacred Tradition'),
            'x-book-year': encodeURIComponent(year || '')
          },
          body: file
        });

        if (statusText) statusText.textContent = 'Analyzing PDF, generating chapter masterclasses and updating brain...';
        btn.textContent = 'Synthesizing Wisdom...';

        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to ingest PDF');
        entry = json.book || json;
      } else {
        btn.textContent = 'Absorbing Into Brain...';
        if (statusText) statusText.textContent = 'Synthesizing doctrine, chapters, and living axioms...';
        const res = await fetch('/api/books', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, author, year, rawText })
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to absorb book');
        entry = json;
      }

      bookModal.classList.add('hidden');
      await refreshBrain();
      const chCount = (entry.chapters || []).length;
      addMsg('assistant', `I have absorbed **${entry.title}** (${entry.author || 'Sacred Tradition'}) into my permanent Sacred Library with ${chCount} detailed chapter masterclasses. Its living axioms and tactical laws are active across all my thinking.\n\n**Summary:** ${entry.summary}`);
    } catch (err) {
      alert('Error absorbing book: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Absorb Into Sacred Library';
      if (progressBox) progressBox.classList.add('hidden');
    }
  };
}

$('#reflect').onclick = async () => {
  const btn = $('#reflect');
  btn.disabled = true;
  btn.textContent = 'Analyzing Deep Memory...';
  try {
    const r = await fetch('/api/reflect', { method: 'POST' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    await refreshBrain();
    addMsg('assistant', j.synthesis);
  } catch (e) {
    alert(e.message);
  }
  btn.disabled = false;
  btn.textContent = 'Connect The Dots';
};

// ---------- Foresight Matrix (Oracle) ----------
$('#forecastBtn').onclick = async () => {
  const btn = $('#forecastBtn');
  const questionInput = $('#oracleQuestion');
  const question = questionInput.value.trim();
  btn.disabled = true;
  btn.textContent = 'Calculating Quantum Trajectories...';
  try {
    const res = await fetch('/api/oracle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question })
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error);
    questionInput.value = '';
    await refreshBrain();
    addMsg('assistant', `I have mapped the branching trajectories for your path (${question || 'Sovereign Path'}). Open the **Foresight** tab in The Deep to review the probability splits and crucial 72-hour pivot.`);
  } catch (err) {
    alert('Error predicting future: ' + err.message);
  }
  btn.disabled = false;
  btn.textContent = 'Calculate Branching Timelines';
};

// ---------- Log Past Dream Modal ----------
const dreamModal = $('#dreamModal');
$('#openAddDream').onclick = () => {
  $('#dreamDateInput').value = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  $('#dreamTitleInput').value = '';
  $('#dreamSummaryInput').value = '';
  $('#dreamSymbolsInput').value = '';
  dreamModal.classList.remove('hidden');
  $('#dreamDateInput').focus();
};
$('#cancelDream').onclick = () => dreamModal.classList.add('hidden');
$('#closeDreamBtn').onclick = () => dreamModal.classList.add('hidden');

$('#dreamCalendarBtn').onclick = () => {
  const p = $('#dreamDatePicker');
  if (p.showPicker) p.showPicker(); else p.click();
};
$('#dreamDatePicker').onchange = (e) => {
  if (e.target.value) $('#dreamDateInput').value = formatDateNice(e.target.value);
};

$('#saveDreamBtn').onclick = async () => {
  const date = $('#dreamDateInput').value.trim() || 'Undated past';
  const title = $('#dreamTitleInput').value.trim() || 'Past Vision';
  const summary = $('#dreamSummaryInput').value.trim();
  const rawSyms = $('#dreamSymbolsInput').value.split(',').map(s => s.trim()).filter(Boolean);

  if (!summary) {
    alert('Please describe what happened in the dream.');
    return;
  }

  const btn = $('#saveDreamBtn');
  btn.disabled = true;
  try {
    const res = await fetch('/api/dreams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, title, summary, symbols: rawSyms })
    });
    if (!res.ok) throw new Error((await res.json()).error);
    dreamModal.classList.add('hidden');
    await refreshBrain();
    toast(`Dream saved: ${title}`, 'gold');
    addMsg('assistant', `Your dream from **${date}** (*"${title}"*) is recorded and now part of what I know. Open Mind, then Dreams, to read and interpret it, or speak to me about it here.`);
  } catch (err) {
    if (err instanceof TypeError) {
      const item = { id: 'local_' + Date.now(), date, title, summary, symbols: rawSyms.map(x => x.toLowerCase()), emotions: [], people: [], interpretation: '' };
      state.brain.dreams = state.brain.dreams || [];
      state.brain.dreams.push(item);
      state.pendingDreams = state.pendingDreams || [];
      state.pendingDreams.push(item);
      saveLocalVault();
      renderBrain();
      dreamModal.classList.add('hidden');
      toast('Dream saved on this device. It syncs when your Mac is reachable.', 'gold');
    } else {
      alert('Error saving dream: ' + err.message);
    }
  }
  btn.disabled = false;
};

// ---------- Log Day Rant Modal ----------
const rantModal = $('#rantModal');
$('#openAddRant').onclick = () => {
  $('#rantDateInput').value = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  $('#rantTitleInput').value = '';
  $('#rantTextInput').value = '';
  rantModal.classList.remove('hidden');
  $('#rantTitleInput').focus();
};
$('#cancelRant').onclick = () => rantModal.classList.add('hidden');
$('#closeRantBtn').onclick = () => rantModal.classList.add('hidden');

$('#rantCalendarBtn').onclick = () => {
  const p = $('#rantDatePicker');
  if (p.showPicker) p.showPicker(); else p.click();
};
$('#rantDatePicker').onchange = (e) => {
  if (e.target.value) $('#rantDateInput').value = formatDateNice(e.target.value);
};

$('#saveRantBtn').onclick = async () => {
  const date = $('#rantDateInput').value.trim() || 'Undated';
  const title = $('#rantTitleInput').value.trim() || 'Waking Thoughts';
  const text = $('#rantTextInput').value.trim();

  if (!text) {
    alert('Please enter your rant or thoughts.');
    return;
  }

  const btn = $('#saveRantBtn');
  btn.disabled = true;
  try {
    const res = await fetch('/api/rants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, title, text })
    });
    if (!res.ok) throw new Error((await res.json()).error);
    rantModal.classList.add('hidden');
    toast(`Rant saved: ${title}`, 'gold');
    await refreshBrain();
    addMsg('assistant', `I have recorded your waking thoughts for **${date}** (*"${title}"*). We can now match what was happening in your life on that day against any dreams around that date.`);
  } catch (err) {
    alert('Error saving rant: ' + err.message);
  }
  btn.disabled = false;
};

// ---------- Settings Modal ----------
const HELP = {
  gemini: 'Free API key available at: <a href="https://aistudio.google.com/apikey" target="_blank">aistudio.google.com/apikey</a>',
  openai: 'API keys at: <a href="https://platform.openai.com/api-keys" target="_blank">platform.openai.com/api-keys</a>',
  anthropic: 'API keys at: <a href="https://console.anthropic.com/settings/keys" target="_blank">console.anthropic.com</a>',
  ollama: 'Local model on Mac: install from ollama.com and run <code>ollama run llama3.1</code>',
};

function syncProvider() {
  const p = $('#sProvider').value;
  $('#keyHelp').innerHTML = HELP[p] || '';
  $('#keyRow').classList.toggle('hidden', p === 'ollama');
  $('#ollamaRow').classList.toggle('hidden', p !== 'ollama');
  $('#sModel').placeholder = state.settings.defaultModels?.[p] || '';
}

function openSettings() {
  const s = state.settings;
  $('#sName').value = s.userName || '';
  $('#sProvider').value = s.provider;
  $('#sKey').value = s.apiKey || '';
  $('#sModel').value = s.model || '';
  $('#sOllama').value = s.ollamaUrl || '';
  syncProvider();
  $('#settingsModal').classList.remove('hidden');
}

$('#sProvider').onchange = syncProvider;
$('#openSettings').onclick = openSettings;
$('#cancelSettings').onclick = () => $('#settingsModal').classList.add('hidden');
$('#closeSettingsBtn').onclick = () => $('#settingsModal').classList.add('hidden');

$('#saveSettings').onclick = async () => {
  const body = {
    userName: $('#sName').value,
    provider: $('#sProvider').value,
    apiKey: $('#sKey').value,
    model: $('#sModel').value,
    ollamaUrl: $('#sOllama').value
  };
  state.settings = await (await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })).json();
  $('#settingsModal').classList.add('hidden');
  if (!state.convo.length && !msgs.querySelector('.m')) welcome();
};

$('#resetAllBtn').onclick = async () => {
  if (confirm('Clear all conversation history and spiritual memories? This cannot be undone.')) {
    await fetch('/api/reset', { method: 'POST' });
    location.reload();
  }
};

$('#importFile').onchange = async e => {
  const f = e.target.files[0];
  if (!f) return;
  await fetch('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: await f.text() });
  location.reload();
};

// ---------- Subtle Ambient Canvas Background ----------
(() => {
  const c = $('#sea'), ctx = c.getContext('2d');
  let W, H, particles = [];
  const resize = () => {
    W = c.width = innerWidth;
    H = c.height = innerHeight;
    particles = Array.from({ length: 48 }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() * 1.5 + 0.3,
      s: Math.random() * 0.25 + 0.08,
      o: Math.random() * 0.35 + 0.05
    }));
  };
  resize();
  addEventListener('resize', resize);

  (function loop(t) {
    ctx.clearRect(0, 0, W, H);
    for (let i = 0; i < 2; i++) {
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let px = 0; px <= W; px += 24) {
        ctx.lineTo(px, H - 40 - i * 28 + Math.sin(px / 220 + t / 2800 + i) * 10);
      }
      ctx.lineTo(W, H);
      ctx.fillStyle = `rgba(28, 212, 182, ${0.012 + i * 0.008})`;
      ctx.fill();
    }
    particles.forEach(p => {
      p.y -= p.s;
      if (p.y < -5) { p.y = H + 5; p.x = Math.random() * W; }
      ctx.beginPath();
      ctx.arc(p.x + Math.sin(t / 2000 + p.y / 80) * 4, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(224, 236, 242, ${p.o})`;
      ctx.fill();
    });
    requestAnimationFrame(loop);
  })(0);
})();

// ---------- Conversations & Mac Folder Archives ----------
function formatMonthName(mStr) {
  try {
    const parts = String(mStr).split('-');
    if (parts.length === 2) {
      const d = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
      return d.toLocaleString('default', { month: 'long', year: 'numeric' });
    }
    return mStr;
  } catch { return mStr; }
}

async function loadConversations() {
  try {
    const res = await fetch('/api/conversations');
    const data = await res.json();
    state.conversations = data.conversations || [];
    state.activeConvoId = data.activeId || 'main';
    state.dataDir = data.dataDir || '';
    state.convosDir = data.convosDir || '';
    state.monthlyDir = data.monthlyDir || '';
    renderConversations();
    updateLastInChatStatus();
  } catch (e) {
    console.error('Error loading conversations:', e);
  }
}

function renderDrawerConversations(filterStr = '') {
  const drawerList = $('#drawerConvosList');
  if (!drawerList) return;
  const q = (filterStr || '').trim().toLowerCase();
  const list = (state.conversations || []).filter(c => {
    if (!q) return true;
    return (c.title || '').toLowerCase().includes(q) || (c.preview || '').toLowerCase().includes(q);
  });

  if (!list.length) {
    drawerList.innerHTML = `<div class="empty" style="padding:12px; font-size:12px;">No matching chats.</div>`;
    return;
  }

  drawerList.innerHTML = list.map(c => {
    const isActive = c.id === state.activeConvoId;
    const lastTs = c.lastActiveTs || (c.updatedAt ? new Date(c.updatedAt).getTime() : 0);
    const agoStr = lastTs ? formatRelativeAgo(lastTs) : (c.updatedAt || '');
    return `
      <button type="button" class="gpt-convo-row ${isActive ? 'active' : ''}" data-id="${esc(c.id)}" title="${lastTs ? 'Last in chat: ' + esc(fmtStamp(lastTs)) : ''}">
        <div class="gpt-convo-col">
          <span class="gpt-convo-title">${esc(c.title || 'Conversation')}</span>
          <span class="gpt-convo-sub">${lastTs ? 'Last: ' + esc(agoStr) : esc(c.updatedAt || '')} · ${c.messageCount || 0} msgs</span>
        </div>
      </button>
    `;
  }).join('');

  drawerList.querySelectorAll('.gpt-convo-row').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.id;
      if (typeof closeGptDrawer === 'function') closeGptDrawer();
      try {
        const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`);
        const data = await res.json();
        state.activeConvoId = data.activeId;
        state.convo = data.convo || [];
        msgs.innerHTML = '';
        lastDay = '';
        if (state.convo.length) {
          state.convo.forEach(m => addMsg(m.role, m.content, m.ts, '', m.images));
          msgs.scrollTop = msgs.scrollHeight;
        } else {
          welcome();
        }
        updateLastInChatStatus();
        loadConversations();
      } catch {}
    };
  });
}

function renderConversations() {
  const list = state.conversations || [];
  const badge = $('#chatsBadge');
  if (badge) badge.textContent = list.length;
  if (state.dataDir) {
    const pEl = $('#folderPathText');
    if (pEl) pEl.textContent = state.dataDir;
  }

  renderDrawerConversations($('#drawerSearchInput')?.value || '');

  const container = $('#conversationsList');
  if (!container) return;
  if (!list.length) {
    container.innerHTML = '<div class="empty">No conversations found.</div>';
    return;
  }

  container.innerHTML = list.map(c => {
    const isActive = c.id === state.activeConvoId;
    const isArchived = !!c.archived;
    const lastTs = c.lastActiveTs || (c.updatedAt ? new Date(c.updatedAt).getTime() : 0);
    const lastInChatText = lastTs ? `${fmtStamp(lastTs)} (${formatRelativeAgo(lastTs)})` : (c.updatedAt || 'Unknown');
    return `
      <div class="card convo-item ${isActive ? 'active-convo' : ''} ${isArchived ? 'archived-convo' : ''}">
        <div class="convo-head">
          <div class="convo-title">
            <span>${esc(c.title)}</span>
            ${isActive ? '<span class="active-badge">Active</span>' : ''}
            ${isArchived ? '<span class="archived-badge" title="Archived after 30 days">Archived (30+ Days)</span>' : ''}
          </div>
          <div class="convo-actions">
            ${!isActive ? `<button type="button" class="ghost action-btn switch-convo-btn" data-id="${c.id}">Open</button>` : ''}
            <button type="button" class="ghost action-btn open-chat-folder-btn" data-id="${c.id}" title="Open folder in Mac Finder">Folder</button>
            ${list.length > 1 ? `<button type="button" class="ghost icon-btn del-convo-btn" data-id="${c.id}" title="Delete session" style="padding:2px 8px; font-size:11px;">✕</button>` : ''}
          </div>
        </div>
        <div class="convo-meta">
          <span class="folder-path-tag">conversations/${esc(c.id)}/</span> · 
          <span>${c.messageCount} messages</span> · 
          <span>Last in chat: <strong>${esc(lastInChatText)}</strong></span>
        </div>
        ${c.preview ? `<div class="convo-preview">${esc(c.preview)}</div>` : ''}
      </div>
    `;
  }).join('');

  container.querySelectorAll('.switch-convo-btn').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.id;
      btn.disabled = true;
      btn.textContent = 'Loading...';
      const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`);
      const data = await res.json();
      state.activeConvoId = data.activeId;
      state.convo = data.convo || [];
      msgs.innerHTML = '';
      lastDay = '';
      if (state.convo.length) {
        state.convo.forEach(m => addMsg(m.role, m.content, m.ts, '', m.images));
        msgs.scrollTop = msgs.scrollHeight;
      } else {
        welcome();
      }
      $('#chatsModal').classList.add('hidden');
      updateLastInChatStatus();
      loadConversations();
    };
  });

  container.querySelectorAll('.open-chat-folder-btn').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      await openMacFolder({ target: 'chat', id });
    };
  });

  container.querySelectorAll('.del-convo-btn').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.id;
      if (btn.dataset.confirming) {
        btn.disabled = true;
        await fetch(`/api/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
        await loadConversations();
        const activeRes = await (await fetch('/api/state')).json();
        state.activeConvoId = activeRes.activeConvoId;
        state.convo = activeRes.convo;
        msgs.innerHTML = '';
        lastDay = '';
        if (state.convo.length) {
          state.convo.forEach(m => addMsg(m.role, m.content, m.ts, '', m.images));
          msgs.scrollTop = msgs.scrollHeight;
        } else {
          welcome();
        }
        updateLastInChatStatus();
      } else {
        btn.dataset.confirming = 'true';
        btn.textContent = 'Delete?';
        btn.style.color = '#ff8e8e';
        setTimeout(() => {
          delete btn.dataset.confirming;
          btn.textContent = '✕';
          btn.style.color = '';
        }, 3500);
      }
    };
  });
}

let currentMonthData = null;
let currentViewerCategory = 'overview';
let activeViewerContent = '';
let activeViewerMonth = '';

async function loadMonthlyArchives() {
  const container = $('#monthlyList');
  if (!container) return;
  container.innerHTML = '<div class="empty">Scanning monthly archives...</div>';

  try {
    const res = await fetch('/api/monthly');
    const data = await res.json();
    const months = data.months || [];

    if (!months.length) {
      container.innerHTML = '<div class="empty">No monthly archives generated yet. Communions will group automatically at the end of each cycle.</div>';
      return;
    }

    container.innerHTML = months.map(m => {
      const counts = m.counts || { dreams: 0, rants: 0, messages: 0, symbols: 0 };
      const displayLabel = m.label || `${formatMonthName(m.month)} · Sovereign Chapter`;
      return `
        <div class="card monthly-card">
          <div class="monthly-head">
            <div class="monthly-title">
              <span class="month-name">${esc(displayLabel)}</span>
              <span class="month-tag">(${esc(m.month)})</span>
            </div>
            <div class="monthly-actions">
              <button type="button" class="primary action-btn open-cat-btn" data-month="${m.month}" data-cat="overview">Full Overview</button>
              <button type="button" class="ghost action-btn open-cat-btn" data-month="${m.month}" data-cat="dreams">Dreams (${counts.dreams})</button>
              <button type="button" class="ghost action-btn open-cat-btn" data-month="${m.month}" data-cat="rants">Rants (${counts.rants})</button>
              <button type="button" class="ghost action-btn open-cat-btn" data-month="${m.month}" data-cat="symbols">Symbols (${counts.symbols})</button>
              <button type="button" class="ghost action-btn open-cat-btn" data-month="${m.month}" data-cat="transcript">Transcript</button>
              <button type="button" class="ghost action-btn open-month-btn" data-month="${m.month}" title="Open monthly folder in Finder">Month Folder</button>
              <button type="button" class="ghost action-btn regen-overview-btn" data-month="${m.month}" title="Re-synthesize overview with Poseidon">Re-synthesize</button>
            </div>
          </div>
          <div class="category-badges">
            <span class="cat-badge">${counts.dreams} Dreams</span>
            <span class="cat-badge">${counts.rants} Rants</span>
            <span class="cat-badge">${counts.messages} Communions</span>
            <span class="cat-badge">${counts.symbols} Symbols</span>
          </div>
          ${m.summary ? `<div class="monthly-summary">${esc(m.summary)}</div>` : ''}
          <div class="monthly-meta">
            <span>Spiritual Chapter: ${esc(m.chapter || 'Decoded')}</span> · 
            <span class="folder-path-tag">monthly/${esc(m.month)}/</span>
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.open-cat-btn').forEach(btn => {
      btn.onclick = async () => {
        const m = btn.dataset.month;
        const cat = btn.dataset.cat;
        btn.disabled = true;
        const oldTxt = btn.textContent;
        btn.textContent = 'Loading...';
        await showMonthlyViewer(m, cat);
        btn.disabled = false;
        btn.textContent = oldTxt;
      };
    });

    container.querySelectorAll('.open-month-btn').forEach(btn => {
      btn.onclick = async () => {
        const m = btn.dataset.month;
        await openMacFolder({ target: 'monthly', month: m });
      };
    });

    container.querySelectorAll('.regen-overview-btn').forEach(btn => {
      btn.onclick = async () => {
        const m = btn.dataset.month;
        btn.disabled = true;
        btn.textContent = 'Synthesizing...';
        try {
          await fetch(`/api/monthly/${encodeURIComponent(m)}/generate`, { method: 'POST' });
          await loadMonthlyArchives();
          await showMonthlyViewer(m, 'overview');
        } catch (err) {
          alert('Error generating monthly overview: ' + err.message);
        }
        btn.disabled = false;
        btn.textContent = 'Re-synthesize';
      };
    });
  } catch (err) {
    container.innerHTML = `<div class="empty">Error loading monthly archives: ${esc(err.message)}</div>`;
  }
}

async function showMonthlyViewer(month, category = 'overview') {
  try {
    const res = await fetch(`/api/monthly/${encodeURIComponent(month)}`);
    const data = await res.json();
    currentMonthData = data;
    activeViewerMonth = month;
    currentViewerCategory = category;

    // Update tab labels with counts
    const counts = data.counts || { dreams: 0, rants: 0, messages: 0, symbols: 0 };
    const tabDreams = $('#catBtnDreams');
    const tabRants = $('#catBtnRants');
    const tabSymbols = $('#catBtnSymbols');
    const tabTranscript = $('#catBtnTranscript');
    if (tabDreams) tabDreams.textContent = `Monthly Dreams (${counts.dreams})`;
    if (tabRants) tabRants.textContent = `Monthly Rants (${counts.rants})`;
    if (tabSymbols) tabSymbols.textContent = `Monthly Symbols (${counts.symbols})`;
    if (tabTranscript) tabTranscript.textContent = `Master Transcript (${counts.messages})`;

    renderViewerCategory(category);
    $('#monthlyViewerModal').classList.remove('hidden');
  } catch (err) {
    alert('Error loading monthly record: ' + err.message);
  }
}

function renderViewerCategory(cat) {
  if (!currentMonthData) return;
  currentViewerCategory = cat;
  const data = currentMonthData;

  // Update active category button state
  document.querySelectorAll('.viewer-cat-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.cat === cat);
  });

  const titleEl = $('#viewerModalTitle');
  const bodyEl = $('#viewerModalBody');
  const indicatorEl = $('#viewerCategoryIndicator');
  const chapterLabel = data.manifest?.label || `${formatMonthName(data.month)} · Sovereign Chapter`;

  if (cat === 'overview') {
    titleEl.textContent = `Poseidon Monthly Overview · ${chapterLabel}`;
    if (indicatorEl) indicatorEl.textContent = 'Showing: Full Spiritual Overview';
    activeViewerContent = data.overviewMarkdown || data.manifest?.summary || 'No overview text available.';
    bodyEl.innerHTML = `<div class="markdown-body">${md(activeViewerContent)}</div>`;
  } else if (cat === 'dreams') {
    titleEl.textContent = `Dream Chronicle · ${chapterLabel}`;
    if (indicatorEl) indicatorEl.textContent = `Showing: Dreams & Visions (${data.counts?.dreams || 0})`;
    activeViewerContent = data.dreamsMarkdown || 'No dreams recorded for this month.';
    bodyEl.innerHTML = `<div class="markdown-body">${md(activeViewerContent)}</div>`;
  } else if (cat === 'rants') {
    titleEl.textContent = `Waking Rants & Thoughts · ${chapterLabel}`;
    if (indicatorEl) indicatorEl.textContent = `Showing: Waking Life Rants (${data.counts?.rants || 0})`;
    activeViewerContent = data.rantsMarkdown || 'No waking rants recorded for this month.';
    bodyEl.innerHTML = `<div class="markdown-body">${md(activeViewerContent)}</div>`;
  } else if (cat === 'symbols') {
    titleEl.textContent = `Active Symbols & Archetypes · ${chapterLabel}`;
    if (indicatorEl) indicatorEl.textContent = `Showing: Recurring Archetypes (${data.counts?.symbols || 0})`;
    activeViewerContent = data.symbolsMarkdown || 'No symbols active in this month.';
    bodyEl.innerHTML = `<div class="markdown-body">${md(activeViewerContent)}</div>`;
  } else if (cat === 'transcript') {
    titleEl.textContent = `Master Transcript · ${chapterLabel}`;
    if (indicatorEl) indicatorEl.textContent = `Showing: Word-for-Word Transcript (${data.counts?.messages || 0} messages)`;
    activeViewerContent = data.transcriptText || 'No transcripts recorded for this month.';
    bodyEl.innerHTML = `<pre class="transcript-pre">${esc(activeViewerContent)}</pre>`;
  }
}

// Attach category tab switching inside viewer modal
document.querySelectorAll('.viewer-cat-btn').forEach(btn => {
  btn.onclick = () => {
    const cat = btn.dataset.cat;
    renderViewerCategory(cat);
  };
});

$('#closeMonthlyViewer').onclick = () => $('#monthlyViewerModal').classList.add('hidden');
$('#closeViewerBtn').onclick = () => $('#monthlyViewerModal').classList.add('hidden');

$('#copyViewerContentBtn').onclick = () => {
  if (!activeViewerContent) return;
  navigator.clipboard.writeText(activeViewerContent).then(() => {
    const btn = $('#copyViewerContentBtn');
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy Content'; }, 2000);
  });
};

$('#openViewerFolderBtn').onclick = async () => {
  if (activeViewerMonth) {
    await openMacFolder({ target: 'monthly', month: activeViewerMonth });
  } else {
    await openMacFolder({ target: 'monthly-root' });
  }
};

// Subtabs switching inside chats modal
$('#subTabChats').onclick = () => {
  $('#subTabChats').classList.add('active');
  $('#subTabMonthly').classList.remove('active');
  $('#chatsFolderView').classList.remove('hidden');
  $('#monthlyArchiveView').classList.add('hidden');
};

$('#subTabMonthly').onclick = () => {
  $('#subTabMonthly').classList.add('active');
  $('#subTabChats').classList.remove('active');
  $('#monthlyArchiveView').classList.remove('hidden');
  $('#chatsFolderView').classList.add('hidden');
  loadMonthlyArchives();
};

$('#syncMonthlyBtn').onclick = async () => {
  const btn = $('#syncMonthlyBtn');
  btn.disabled = true;
  btn.textContent = 'Syncing...';
  try {
    await fetch('/api/monthly/sync', { method: 'POST' });
    await loadMonthlyArchives();
  } catch (e) {
    alert('Error syncing monthly archives: ' + e.message);
  }
  btn.disabled = false;
  btn.textContent = 'Sync Archives';
};

async function startNewChat() {
  try {
    const res = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New Conversation' })
    });
    const data = await res.json();
    state.activeConvoId = data.id;
    state.convo = [];
    msgs.innerHTML = '';
    lastDay = '';
    welcome();
    $('#chatsModal').classList.add('hidden');
    await loadConversations();
    input.focus();
  } catch (err) {
    alert('Error creating new chat: ' + err.message);
  }
}

$('#newChatBtn').onclick = startNewChat;
$('#modalNewChatBtn').onclick = startNewChat;

$('#openChatsBtn').onclick = () => {
  loadConversations();
  $('#chatsModal').classList.remove('hidden');
};
$('#cancelChats').onclick = () => $('#chatsModal').classList.add('hidden');
$('#closeChatsBtn').onclick = () => $('#chatsModal').classList.add('hidden');

async function openMacFolder(opts = {}) {
  try {
    const res = await fetch('/api/open-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts)
    });
    const data = await res.json();
    if (data.path) {
      const el = $('#folderPathText');
      if (el) el.textContent = data.path;
    }
  } catch (err) {
    console.error('Error opening folder:', err);
  }
}

$('#openFolderBtn').onclick = () => {
  openMacFolder();
  loadConversations();
  $('#chatsModal').classList.remove('hidden');
};
$('#revealFinderBtn').onclick = () => openMacFolder({ target: 'data' });
$('#revealConvosBtn').onclick = () => openMacFolder({ target: 'conversations' });
$('#revealMonthlyBtn').onclick = () => openMacFolder({ target: 'monthly-root' });

$('#copyPathBtn').onclick = () => {
  const p = $('#folderPathText').textContent.trim();
  navigator.clipboard.writeText(p).then(() => {
    const btn = $('#copyPathBtn');
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy Path'; }, 2000);
  });
};

// ---------- Sacred Codex & Apple Books Style Full-Book Reader ----------
function setCodexView(viewMode = 'reader') {
  const modal = $('#codexReaderModal');
  if (modal) modal.dataset.view = viewMode;
  if (viewMode === 'shelf') {
    if (!codexStatusFilter) codexStatusFilter = 'ALL';
    if (!codexCategoryFilter) codexCategoryFilter = 'ALL';
    renderCodexShelf();
  } else {
    renderCodexReaderChamber();
  }
}

function openCodexReader(bookId = null, chapterNum = null, viewMode = null) {
  const books = state.brain?.books || [];
  if (!books.length) return;

  if (bookId) {
    const targetBook = books.find(b => b.id === bookId) || books[0];
    selectedCodexBookId = targetBook.id;
    selectedCodexChapterNum = Number(chapterNum || targetBook.bookmarkedChapter || 1);
    viewMode = 'reader';
  } else if (!viewMode) {
    viewMode = 'shelf';
  }

  if (viewMode === 'shelf') {
    codexStatusFilter = 'ALL';
    codexCategoryFilter = 'ALL';
    codexSearchQuery = '';
    const sInput = $('#codexBookSearch');
    if (sInput) sInput.value = '';
  }

  $('#codexReaderModal')?.classList.remove('hidden');
  setCodexView(viewMode);
}

function renderCodexShelf() {
  const books = state.brain?.books || [];
  const activeBm = state.brain?.activeBookmark;
  const gridEl = $('#codexShelfGrid');
  if (!gridEl) return;

  const readingCount = books.filter(bk => getBookReadingStatus(bk) === 'reading').length;
  const completedCount = books.filter(bk => getBookReadingStatus(bk) === 'completed').length;
  const wantCount = books.filter(bk => getBookReadingStatus(bk) === 'want_to_read').length;

  if (!codexStatusFilter) codexStatusFilter = 'ALL';
  if (!codexCategoryFilter) codexCategoryFilter = 'ALL';

  // Update Apple Books Status Shelf tab counts
  document.querySelectorAll('.codex-status-btn').forEach(btn => {
    const st = btn.dataset.status || 'ALL';
    btn.classList.toggle('active', st === codexStatusFilter);
    if (st === 'ALL') btn.textContent = `All Books (${books.length})`;
    else if (st === 'reading') btn.textContent = `Reading Now (${readingCount})`;
    else if (st === 'completed') btn.textContent = `Completed (${completedCount})`;
    else if (st === 'want_to_read') btn.textContent = `Want to Read (${wantCount})`;
    btn.onclick = () => {
      codexStatusFilter = st;
      renderCodexShelf();
    };
  });

  // Render dynamic Category tabs based on all actual categories present in books
  const catTabsEl = $('#codexCategoryTabs');
  if (catTabsEl) {
    const catCounts = {};
    books.forEach(bk => {
      const c = (bk.category || 'Sacred Relic').trim();
      catCounts[c] = (catCounts[c] || 0) + 1;
    });
    const sortedCats = Object.keys(catCounts).sort();

    const isAllCatActive = !codexCategoryFilter || codexCategoryFilter === 'ALL';
    let catHtml = `<button class="codex-cat-btn ${isAllCatActive ? 'active' : ''}" type="button" data-cat="ALL">All Categories (${books.length})</button>`;
    sortedCats.forEach(cat => {
      const count = catCounts[cat];
      const isActive = !isAllCatActive && codexCategoryFilter.trim().toLowerCase() === cat.trim().toLowerCase() ? 'active' : '';
      catHtml += `<button class="codex-cat-btn ${isActive}" type="button" data-cat="${esc(cat)}">${esc(cat)} (${count})</button>`;
    });
    catTabsEl.innerHTML = catHtml;

    catTabsEl.querySelectorAll('.codex-cat-btn').forEach(btn => {
      btn.onclick = () => {
        codexCategoryFilter = btn.dataset.cat || 'ALL';
        renderCodexShelf();
      };
    });
  }

  // Search input handling
  const searchInput = $('#codexBookSearch');
  if (searchInput && !searchInput.dataset.wired) {
    searchInput.dataset.wired = 'true';
    searchInput.oninput = () => {
      codexSearchQuery = (searchInput.value || '').trim().toLowerCase();
      renderCodexShelf();
    };
  }

  const query = (searchInput ? searchInput.value : (codexSearchQuery || '')).trim().toLowerCase();
  const currentCat = (codexCategoryFilter || 'ALL').trim();
  const currentStatus = (codexStatusFilter || 'ALL').trim();
  const isAllCat = currentCat.toUpperCase() === 'ALL';
  const isAllStat = currentStatus.toUpperCase() === 'ALL';

  let filtered = books;
  if (!isAllCat || !isAllStat || query) {
    filtered = books.filter(bk => {
      if (!bk) return false;
      if (!isAllStat && getBookReadingStatus(bk) !== currentStatus) return false;
      if (!isAllCat) {
        const bkCat = String(bk.category || 'Sacred Relic').trim().toLowerCase();
        if (bkCat !== currentCat.toLowerCase()) return false;
      }
      if (!query) return true;
      const chTitles = (bk.chapters || []).map(c => (c && c.title) || '').join(' ');
      const hay = `${bk.title || ''} ${bk.author || ''} ${bk.category || ''} ${bk.summary || ''} ${chTitles}`.toLowerCase();
      return hay.includes(query);
    });
  }

  if (!filtered.length) {
    gridEl.innerHTML = `
      <div class="empty" style="grid-column:1/-1; padding:40px 16px; text-align:center;">
        <div style="font-size:18px; margin-bottom:8px; color:var(--gold);">No books found matching your current shelf or search filter.</div>
        <p style="color:var(--text-muted); font-size:13.5px; margin-bottom:16px;">Try clearing search keywords or selecting All Books and All Categories.</p>
        <button type="button" class="primary action-btn" id="resetCodexShelfFiltersBtn" style="padding:8px 18px;">Show All ${books.length} Books</button>
      </div>`;
    const rBtn = $('#resetCodexShelfFiltersBtn');
    if (rBtn) {
      rBtn.onclick = () => {
        codexStatusFilter = 'ALL';
        codexCategoryFilter = 'ALL';
        codexSearchQuery = '';
        if (searchInput) searchInput.value = '';
        renderCodexShelf();
      };
    }
    return;
  }

  const cardsHtml = filtered.map(bk => {
    try {
      if (!bk) return '';
      const isLiveBm = activeBm && activeBm.bookId === bk.id;
      const chaps = Array.isArray(bk.chapters) ? bk.chapters : [];
      const totalCh = chaps.length || 1;
      const doneArr = Array.isArray(bk.completedChapters) ? bk.completedChapters : [];
      const doneCh = doneArr.length;
      const bmCh = Number(bk.bookmarkedChapter || 1);
      const rStatus = getBookReadingStatus(bk);
      const pct = rStatus === 'completed' ? 100 : Math.min(100, Math.round((doneCh / totalCh) * 100));
      const statusLabel = rStatus === 'completed' ? 'COMPLETED' : rStatus === 'reading' ? 'READING NOW' : 'WANT TO READ';
      const cleanSummary = String(bk.summary || '').slice(0, 180);

      return `
        <div class="card apple-book-card ${isLiveBm ? 'active-bm-book' : ''}" id="shelf-book-${esc(bk.id)}">
          <div class="book-card-meta-row">
            <span class="date-badge">${esc(bk.category || 'Sacred Relic')}${bk.totalPages ? ` · ${bk.totalPages}p` : ''}</span>
            <span class="apple-status-badge status-${esc(rStatus)}">${statusLabel} · ${pct}%</span>
          </div>
          <h4 class="apple-book-title">${esc(bk.title || 'Sacred Relic')}</h4>
          <div class="apple-book-author">${esc(bk.author || 'Ancient Tradition')}${bk.year ? ` (${esc(bk.year)})` : ''}</div>
          <div class="apple-progress-track" style="margin:6px 0 10px;">
            <div class="apple-progress-fill" style="width:${rStatus === 'completed' ? 100 : Math.max(doneCh ? 8 : 0, pct)}%;"></div>
          </div>
          <p class="book-summary" style="margin-bottom:12px;">${esc(cleanSummary)}${String(bk.summary || '').length > 180 ? '...' : ''}</p>
          <div class="book-card-footer-actions" style="margin-top:auto;">
            <button type="button" class="primary action-btn open-shelf-read-btn" data-book="${esc(bk.id)}" data-chap="${bmCh}">
              ${rStatus === 'reading' ? `Continue: Ch.${bmCh} →` : `Read Book (${totalCh} Ch)`}
            </button>
            <select class="book-status-select shelf-status-select" data-book="${esc(bk.id)}" title="Move to another shelf">
              <option value="reading" ${rStatus === 'reading' ? 'selected' : ''}>Shelf: Reading Now</option>
              <option value="completed" ${rStatus === 'completed' ? 'selected' : ''}>Shelf: Completed</option>
              <option value="want_to_read" ${rStatus === 'want_to_read' ? 'selected' : ''}>Shelf: Want to Read</option>
            </select>
            ${bk.pdfFile ? `<button type="button" class="ghost action-btn shelf-pdf-btn" data-book="${esc(bk.id)}" title="Open original PDF">PDF</button>` : ''}
          </div>
        </div>
      `;
    } catch (err) {
      console.error('Failed to render shelf book card:', bk?.id, err);
      return '';
    }
  }).join('');

  gridEl.innerHTML = cardsHtml;

  gridEl.querySelectorAll('.open-shelf-read-btn').forEach(btn => {
    btn.onclick = () => {
      const bId = btn.dataset.book;
      const cNum = Number(btn.dataset.chap || 1);
      openCodexReader(bId, cNum, 'reader');
    };
  });

  gridEl.querySelectorAll('.shelf-status-select').forEach(sel => {
    sel.onchange = () => {
      const bId = sel.dataset.book;
      const nextSt = sel.value;
      saveBookmarkToServer(bId, 1, { readingStatus: nextSt });
      renderCodexShelf();
      toast('Book shelf updated', 'gold');
    };
  });

  gridEl.querySelectorAll('.shelf-pdf-btn').forEach(btn => {
    btn.onclick = () => {
      const bId = btn.dataset.book;
      window.open(`/api/books/pdf/${encodeURIComponent(bId)}`, '_blank');
    };
  });
}

function applyReaderAppearance() {
  const mainEl = $('#codexMainReader');
  if (!mainEl) return;

  mainEl.className = `codex-main-reader theme-${codexTheme} font-${codexFontFamily}`;
  const inner = mainEl.querySelector('.reader-chamber-inner');
  if (inner) {
    inner.style.setProperty('--reader-font-size', `${codexFontSize}px`);
  }

  const pctStr = `${Math.round((codexFontSize / 16) * 100)}%`;
  document.querySelectorAll('#readerFontPct, .font-pct-label').forEach(el => {
    el.textContent = pctStr;
  });

  document.querySelectorAll('#readerFontFamilySelect').forEach(sel => {
    sel.value = codexFontFamily;
  });

  document.querySelectorAll('[data-rtheme]').forEach(dot => {
    dot.classList.toggle('active', dot.dataset.rtheme === codexTheme);
  });
}

function renderCodexReaderChamber() {
  const mainEl = $('#codexMainReader');
  if (!mainEl) return;
  const books = state.brain?.books || [];
  const book = books.find(b => b.id === selectedCodexBookId) || books[0];
  if (!book) {
    mainEl.innerHTML = '<div class="empty">No book selected.</div>';
    return;
  }
  selectedCodexBookId = book.id;

  const chapters = book.chapters || [];
  const currentChap = chapters.find(c => Number(c.number) === Number(selectedCodexChapterNum)) || chapters[0] || {
    number: 1,
    title: 'Chapter 1',
    pageRange: 'Pages 1-25',
    summary: book.summary || '',
    fullText: book.summary || '',
    poseidonLesson: (book.corePrinciples || [])[0] || '',
    howToAct: (book.tacticalLaws || []).join('\n') || ''
  };
  selectedCodexChapterNum = Number(currentChap.number || 1);

  // Update Top Bar Meta
  if ($('#crhBookTitle')) $('#crhBookTitle').textContent = book.title;
  if ($('#crhBookMeta')) $('#crhBookMeta').textContent = `${book.author || 'Ancient Tradition'} · Chapter ${selectedCodexChapterNum} of ${chapters.length}${currentChap.pageRange ? ` (${currentChap.pageRange})` : ''}`;
  if ($('#ccsChapCount')) $('#ccsChapCount').textContent = `${chapters.length} Ch`;

  // Update Status Dropdown in top bar
  const rStatus = getBookReadingStatus(book);
  const statusSel = $('#codexBookStatusSelect');
  if (statusSel) {
    statusSel.value = rStatus;
    statusSel.onchange = () => {
      const nextSt = statusSel.value;
      saveBookmarkToServer(book.id, selectedCodexChapterNum, { readingStatus: nextSt });
      renderCodexReaderChamber();
      toast(`Shelf updated: ${nextSt === 'completed' ? 'Completed' : nextSt === 'reading' ? 'Reading Now' : 'Want to Read'}`, 'gold');
    };
  }

  // Update PDF button in top bar
  const pdfBtn = $('#codexStreamPdfBtn');
  if (pdfBtn) {
    pdfBtn.style.display = book.pdfFile ? 'inline-block' : 'none';
    pdfBtn.onclick = () => window.open(`/api/books/pdf/${encodeURIComponent(book.id)}`, '_blank');
  }

  // Render Table of Contents in Left Sidebar
  const chapListEl = $('#codexChapterList');
  if (chapListEl) {
    chapListEl.innerHTML = chapters.map(ch => {
      const cNum = Number(ch.number);
      const isCur = cNum === selectedCodexChapterNum;
      const isDone = (book.completedChapters || []).includes(cNum);
      const isBm = Number(book.bookmarkedChapter || 1) === cNum;
      return `
        <button type="button" class="ccs-chap-item ${isCur ? 'active' : ''} ${isDone ? 'completed' : ''}" data-chap="${cNum}">
          <span class="ccs-chap-num">${isDone ? '✓' : cNum < 10 ? '0' + cNum : cNum}</span>
          <div class="ccs-chap-info">
            <div class="ccs-chap-title">${esc(ch.title.replace(/^Chapter\s+\d+:\s*/i, ''))}</div>
            <div class="ccs-chap-pages">${esc(ch.pageRange || `Section ${cNum}`)}${isBm ? ' · 🔖 Current' : ''}</div>
          </div>
        </button>
      `;
    }).join('');

    chapListEl.querySelectorAll('.ccs-chap-item').forEach(btn => {
      btn.onclick = () => {
        selectedCodexChapterNum = Number(btn.dataset.chap);
        saveBookmarkToServer(book.id, selectedCodexChapterNum, {});
        renderCodexReaderChamber();
      };
    });

    // Auto-scroll active chapter into sidebar view
    requestAnimationFrame(() => {
      const activeItem = chapListEl.querySelector('.ccs-chap-item.active');
      if (activeItem && activeItem.scrollIntoView) {
        activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  }

  // Render Mobile Chapters Drawer List
  const mobListEl = $('#codexMobileChapterList');
  if (mobListEl) {
    mobListEl.innerHTML = chapters.map(ch => {
      const cNum = Number(ch.number);
      const isCur = cNum === selectedCodexChapterNum;
      const isDone = (book.completedChapters || []).includes(cNum);
      return `
        <button type="button" class="ccs-chap-item ${isCur ? 'active' : ''} ${isDone ? 'completed' : ''}" data-chap="${cNum}">
          <span class="ccs-chap-num">${isDone ? '✓' : cNum}</span>
          <div class="ccs-chap-info">
            <div class="ccs-chap-title">${esc(ch.title)}</div>
            <div class="ccs-chap-pages">${esc(ch.pageRange || '')}</div>
          </div>
        </button>
      `;
    }).join('');

    mobListEl.querySelectorAll('.ccs-chap-item').forEach(btn => {
      btn.onclick = () => {
        selectedCodexChapterNum = Number(btn.dataset.chap);
        saveBookmarkToServer(book.id, selectedCodexChapterNum, {});
        $('#codexMobileChaptersDrawer')?.classList.add('hidden');
        renderCodexReaderChamber();
      };
    });
  }

  // Filter chapters inside sidebar
  const chapSearch = $('#codexChapterSearch');
  if (chapSearch && !chapSearch.dataset.wired) {
    chapSearch.dataset.wired = 'true';
    chapSearch.oninput = () => {
      const q = chapSearch.value.trim().toLowerCase();
      chapListEl?.querySelectorAll('.ccs-chap-item').forEach(item => {
        const txt = item.textContent.toLowerCase();
        item.style.display = txt.includes(q) ? 'flex' : 'none';
      });
    };
  }

  // Render Main Reading Chamber
  mainEl.className = `codex-main-reader theme-${codexTheme}`;
  const isChapCompleted = (book.completedChapters || []).includes(selectedCodexChapterNum);
  const currentNote = (book.userNotes && book.userNotes[String(selectedCodexChapterNum)]) || '';

  mainEl.innerHTML = `
    <div class="reader-chamber-inner" style="--reader-font-size:${codexFontSize}px;">
      <!-- Pinned Reading Mode Toolbar -->
      <div class="apple-reader-toolbar">
        <div class="art-modes" role="tablist">
          <button type="button" class="art-mode-btn ${codexReadMode === 'masterclass' ? 'active' : ''}" data-rmode="masterclass">Full Deep Masterclass</button>
          <button type="button" class="art-mode-btn ${codexReadMode === 'fulltext' ? 'active' : ''}" data-rmode="fulltext">Original Archival Text</button>
          <button type="button" class="art-mode-btn ${codexReadMode === 'howto' ? 'active' : ''}" data-rmode="howto">How-To &amp; Action Protocol</button>
        </div>
        <div class="art-appearance mobile-only-appearance">
          <div class="art-font-stepper">
            <button type="button" class="art-font-btn font-dec-btn" title="Smaller text">A-</button>
            <span class="art-font-pct font-pct-label">100%</span>
            <button type="button" class="art-font-btn font-inc-btn" title="Larger text">A+</button>
          </div>
          <div class="art-themes-row">
            <button type="button" class="art-theme-dot theme-abyss" data-rtheme="abyss" title="Abyss"></button>
            <button type="button" class="art-theme-dot theme-sepia" data-rtheme="sepia" title="Sepia"></button>
            <button type="button" class="art-theme-dot theme-paper" data-rtheme="paper" title="Paper"></button>
            <button type="button" class="art-theme-dot theme-onyx" data-rtheme="onyx" title="Onyx"></button>
          </div>
        </div>
      </div>

      <!-- Chapter Heading Banner -->
      <div class="ccr-chap-banner">
        <span class="ccr-step-tag">CHAPTER ${selectedCodexChapterNum} OF ${chapters.length}${currentChap.pageRange ? ` · ${esc(currentChap.pageRange).toUpperCase()}` : ''}</span>
        <h3 class="ccr-chap-title">${esc(currentChap.title)}</h3>
        <div class="ccr-banner-actions">
          <button id="deepDiveChapBtn" type="button" class="ghost action-btn" title="Have Poseidon perform live AI deep-dive expansion">AI Deep-Dive</button>
          <button id="toggleChapCompleteBtn" type="button" class="ghost action-btn ${isChapCompleted ? 'chap-done-active' : ''}">
            ${isChapCompleted ? '✓ Chapter Completed' : 'Mark Chapter Read'}
          </button>
          <button id="discussChapBtn" type="button" class="primary action-btn">Discuss With Poseidon</button>
        </div>
      </div>

      ${codexReadMode === 'masterclass' ? `
        <!-- I. Exhaustive Chapter Summary & Page-by-Page Breakdown -->
        <div class="ccr-section summary-section">
          <div class="ccr-sec-head">I. EXHAUSTIVE CHAPTER SUMMARY &amp; PAGE-BY-PAGE BREAKDOWN</div>
          <div class="ccr-sec-body reader-prose">${md(currentChap.summary || '')}</div>
        </div>

        <!-- II. How To & What To Do -->
        <div class="ccr-section act-section">
          <div class="ccr-sec-head">II. HOW TO &amp; WHAT TO DO · CONCRETE STEP-BY-STEP EXECUTION PROTOCOL</div>
          <div class="ccr-sec-body reader-prose">${md(currentChap.howToAct || '')}</div>
        </div>

        <!-- III. Poseidon's Inner Mechanism -->
        <div class="ccr-section lesson-section">
          <div class="ccr-sec-head">III. POSEIDON'S DEEP LESSON &amp; HIDDEN MECHANISM</div>
          <div class="ccr-sec-body reader-prose">${md(currentChap.poseidonLesson || '')}</div>
        </div>

        <!-- IV. Verbatim Passages -->
        ${currentChap.fullText ? `
          <div class="ccr-section fulltext-section">
            <div class="ccr-sec-head">IV. VERBATIM PASSAGES FROM THE ORIGINAL BOOK (${esc(currentChap.pageRange || 'Archival Pages')})</div>
            <div class="ccr-sec-body reader-prose verbatim-prose">${md(currentChap.fullText)}</div>
          </div>
        ` : ''}
      ` : ''}

      ${codexReadMode === 'fulltext' ? `
        <div class="ccr-section fulltext-section">
          <div class="ccr-sec-head">ORIGINAL BOOK TEXT &amp; ARCHIVAL PASSAGES · ${esc(currentChap.pageRange || `CHAPTER ${selectedCodexChapterNum}`)}</div>
          <div class="ccr-sec-body reader-prose verbatim-prose">${md(currentChap.fullText || currentChap.summary || '')}</div>
        </div>
        <div class="ccr-section summary-section">
          <div class="ccr-sec-head">CHAPTER SYNTHESIS &amp; KEY TAKEAWAYS</div>
          <div class="ccr-sec-body reader-prose">${md(currentChap.summary || '')}</div>
        </div>
      ` : ''}

      ${codexReadMode === 'howto' ? `
        <div class="ccr-section act-section">
          <div class="ccr-sec-head">STEP-BY-STEP HOW-TO &amp; ACTION PROTOCOL · CHAPTER ${selectedCodexChapterNum}</div>
          <div class="ccr-sec-body reader-prose">${md(currentChap.howToAct || '')}</div>
        </div>
        <div class="ccr-section lesson-section">
          <div class="ccr-sec-head">POSEIDON'S OPERATIONAL COUNSEL</div>
          <div class="ccr-sec-body reader-prose">${md(currentChap.poseidonLesson || '')}</div>
        </div>
      ` : ''}

      <!-- Personal Study Notes & Navigation -->
      <div class="ccr-section notes-section">
        <div class="ccr-sec-head">YOUR PERSONAL STUDY NOTES ON CHAPTER ${selectedCodexChapterNum} (SYNCED WITH POSEIDON)</div>
        <textarea id="chapNoteInput" rows="2" placeholder="Write your realizations, experiments, or how this chapter applies to your next move in Zimbabwe...">${esc(currentNote)}</textarea>
        <div class="ccr-bottom-nav">
          <div class="row" style="gap:8px; flex-wrap:wrap;">
            ${selectedCodexChapterNum > 1 ? `<button id="prevChapBtn" type="button" class="ghost action-btn">← Prev Chapter (Ch ${selectedCodexChapterNum - 1})</button>` : ''}
            ${selectedCodexChapterNum < chapters.length
              ? `<button id="nextChapBtn" type="button" class="primary action-btn">Complete &amp; Next (Ch ${selectedCodexChapterNum + 1}) →</button>`
              : `<button id="finishBookBtn" type="button" class="primary action-btn">✓ Mark Entire Book Completed</button>`}
          </div>
          <button id="saveChapNoteBtn" type="button" class="ghost action-btn">Save Note</button>
        </div>
      </div>
    </div>
  `;

  // Scroll to top
  mainEl.scrollTo({ top: 0, behavior: 'smooth' });

  // Wire Reading Modes
  mainEl.querySelectorAll('[data-rmode]').forEach(btn => {
    btn.onclick = () => {
      codexReadMode = btn.dataset.rmode;
      renderCodexReaderChamber();
    };
  });

  applyReaderAppearance();

  // Wire Toggle Complete
  const compBtn = $('#toggleChapCompleteBtn');
  if (compBtn) {
    compBtn.onclick = () => {
      saveBookmarkToServer(book.id, selectedCodexChapterNum, { toggleComplete: true });
      renderCodexReaderChamber();
    };
  }

  // Wire AI Deep Dive
  const deepDiveBtn = $('#deepDiveChapBtn');
  if (deepDiveBtn) {
    deepDiveBtn.onclick = async () => {
      deepDiveBtn.disabled = true;
      deepDiveBtn.textContent = 'Reading Full Chapter...';
      try {
        const res = await fetch('/api/books/deep-dive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookId: book.id, chapterNumber: selectedCodexChapterNum })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Deep dive failed');
        if (data.chapter) {
          Object.assign(currentChap, data.chapter);
          saveLocalVault();
          renderCodexReaderChamber();
          toast('Chapter expanded with deep masterclass and execution protocol', 'gold');
        }
      } catch (err) {
        toast('Deep dive error: ' + err.message, 'gold');
        deepDiveBtn.disabled = false;
        deepDiveBtn.textContent = 'AI Deep-Dive';
      }
    };
  }

  // Wire Discuss Chapter With Poseidon
  const discBtn = $('#discussChapBtn');
  if (discBtn) {
    discBtn.onclick = () => {
      saveBookmarkToServer(book.id, selectedCodexChapterNum, {});
      $('#codexReaderModal')?.classList.add('hidden');
      discussChapterWithPoseidon(book.id, selectedCodexChapterNum);
    };
  }

  // Wire Save Note
  const saveNoteBtn = $('#saveChapNoteBtn');
  if (saveNoteBtn) {
    saveNoteBtn.onclick = () => {
      const noteVal = ($('#chapNoteInput')?.value || '').trim();
      saveNoteBtn.disabled = true;
      saveNoteBtn.textContent = 'Saved';
      saveBookmarkToServer(book.id, selectedCodexChapterNum, { note: noteVal });
      setTimeout(() => {
        if ($('#saveChapNoteBtn')) {
          $('#saveChapNoteBtn').disabled = false;
          $('#saveChapNoteBtn').textContent = 'Save Note';
        }
      }, 1000);
    };
  }

  // Wire Prev / Next / Finish
  if ($('#prevChapBtn')) {
    $('#prevChapBtn').onclick = () => {
      selectedCodexChapterNum = Math.max(1, selectedCodexChapterNum - 1);
      saveBookmarkToServer(book.id, selectedCodexChapterNum, {});
      renderCodexReaderChamber();
    };
  }
  if ($('#nextChapBtn')) {
    $('#nextChapBtn').onclick = () => {
      const nextNum = Math.min(chapters.length, selectedCodexChapterNum + 1);
      saveBookmarkToServer(book.id, selectedCodexChapterNum, { markComplete: true });
      selectedCodexChapterNum = nextNum;
      saveBookmarkToServer(book.id, selectedCodexChapterNum, {});
      renderCodexReaderChamber();
    };
  }
  if ($('#finishBookBtn')) {
    $('#finishBookBtn').onclick = () => {
      saveBookmarkToServer(book.id, selectedCodexChapterNum, { markComplete: true, readingStatus: 'completed' });
      renderCodexReaderChamber();
      toast(`Completed "${book.title}"! Moved to Completed Books shelf.`, 'gold');
    };
  }
}

// Delegated Global Listeners for Reader Themes, Font Stepper & Font Family
document.addEventListener('click', (e) => {
  const themeBtn = e.target.closest('[data-rtheme]');
  if (themeBtn) {
    e.preventDefault();
    e.stopPropagation();
    codexTheme = themeBtn.dataset.rtheme;
    try { localStorage.setItem('poseidon_reader_theme', codexTheme); } catch {}
    applyReaderAppearance();
    toast(`Reader theme: ${codexTheme === 'sepia' ? 'Sepia Parchment' : codexTheme === 'paper' ? 'Clean Paper' : codexTheme === 'onyx' ? 'Onyx Midnight' : 'Abyss Dark'}`, 'gold');
    return;
  }

  const decBtn = e.target.closest('.font-dec-btn, #readerFontDecBtn');
  if (decBtn) {
    e.preventDefault();
    e.stopPropagation();
    codexFontSize = Math.max(12, Math.round((codexFontSize - 1.6) * 10) / 10);
    try { localStorage.setItem('poseidon_reader_font', String(codexFontSize)); } catch {}
    applyReaderAppearance();
    return;
  }

  const incBtn = e.target.closest('.font-inc-btn, #readerFontIncBtn');
  if (incBtn) {
    e.preventDefault();
    e.stopPropagation();
    codexFontSize = Math.min(26, Math.round((codexFontSize + 1.6) * 10) / 10);
    try { localStorage.setItem('poseidon_reader_font', String(codexFontSize)); } catch {}
    applyReaderAppearance();
    return;
  }
});

document.addEventListener('change', (e) => {
  if (e.target.matches('#readerFontFamilySelect')) {
    codexFontFamily = e.target.value;
    try { localStorage.setItem('poseidon_reader_font_family', codexFontFamily); } catch {}
    applyReaderAppearance();
    toast(`Typeface: ${e.target.options[e.target.selectedIndex]?.text || codexFontFamily}`, 'gold');
  }
});

function saveBookmarkToServer(bookId, chapterNumber, extra = {}) {
  const book = (state.brain?.books || []).find(x => String(x.id) === String(bookId));
  if (book) {
    const chapNum = Number(chapterNumber || book.bookmarkedChapter || 1);
    book.bookmarkedChapter = chapNum;
    book.completedChapters = Array.isArray(book.completedChapters) ? book.completedChapters : [];
    book.userNotes = book.userNotes || {};
    if (extra.toggleComplete) {
      const idx = book.completedChapters.indexOf(chapNum);
      if (idx >= 0) book.completedChapters.splice(idx, 1);
      else book.completedChapters.push(chapNum);
    } else if (extra.markComplete && !book.completedChapters.includes(chapNum)) {
      book.completedChapters.push(chapNum);
    }
    if (extra.readingStatus) {
      book.readingStatus = extra.readingStatus;
      if (extra.readingStatus === 'completed') {
        book.completedChapters = (book.chapters || []).map(c => Number(c.number));
      }
    } else if ((book.completedChapters || []).length >= (book.chapters || []).length && (book.chapters || []).length > 0) {
      book.readingStatus = 'completed';
    } else if (book.readingStatus !== 'completed') {
      book.readingStatus = 'reading';
    }
    if (typeof extra.note === 'string') {
      book.userNotes[String(chapNum)] = extra.note.trim();
    }
    const chapObj = (book.chapters || []).find(c => Number(c.number) === chapNum) || (book.chapters || [])[0] || {};
    state.brain.activeBookmark = {
      bookId: book.id,
      bookTitle: book.title,
      author: book.author,
      category: book.category || 'Sacred Relic',
      chapterNumber: chapNum,
      chapterTitle: chapObj.title || ('Chapter ' + chapNum),
      chapterSummary: chapObj.summary || book.summary || '',
      poseidonLesson: chapObj.poseidonLesson || '',
      howToAct: chapObj.howToAct || '',
      updatedAt: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    };
    syncLiveBookmarkBanner();
    saveLocalVault();
    if ($('#deep')?.classList.contains('open')) {
      requestAnimationFrame(() => renderBrain());
    }
  }

  // Non-blocking background sync to server
  fetch('/api/books/bookmark', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookId, chapterNumber, ...extra })
  }).catch(() => {});
}

function discussChapterWithPoseidon(bookId, chapterNumber) {
  const books = state.brain?.books || [];
  const book = books.find(b => b.id === bookId) || books[0];
  if (!book) return;
  const ch = (book.chapters || []).find(c => Number(c.number) === Number(chapterNumber)) || (book.chapters || [])[0] || {};
  const promptText = `I am currently bookmarked at "${book.title}" (${book.author}), studying ${ch.title || ('Chapter ' + chapterNumber)}. Break down the deepest spiritual lesson of this chapter for my life in Zimbabwe and tell me how to act and execute this specific way today.`;
  $('#codexReaderModal')?.classList.add('hidden');
  send(promptText);
}

// Wire Top-bar & Banner buttons for Codex Reader
if ($('#openCodexBtn')) {
  $('#openCodexBtn').onclick = () => openCodexReader(null, null, 'shelf');
}
if ($('#openCodexFromLibBtn')) {
  $('#openCodexFromLibBtn').onclick = () => openCodexReader(null, null, 'shelf');
}
if ($('#closeCodexReader')) {
  $('#closeCodexReader').onclick = () => $('#codexReaderModal')?.classList.add('hidden');
}
if ($('#closeCodexReader2')) {
  $('#closeCodexReader2').onclick = () => $('#codexReaderModal')?.classList.add('hidden');
}
if ($('#codexBackToShelfBtn')) {
  $('#codexBackToShelfBtn').onclick = () => setCodexView('shelf');
}
if ($('#codexMobChapDrawerBtn')) {
  $('#codexMobChapDrawerBtn').onclick = () => $('#codexMobileChaptersDrawer')?.classList.remove('hidden');
}
if ($('#closeMobChaptersDrawerBtn')) {
  $('#closeMobChaptersDrawerBtn').onclick = () => $('#codexMobileChaptersDrawer')?.classList.add('hidden');
}
if ($('#openAncientFolderBtn')) {
  $('#openAncientFolderBtn').onclick = async () => {
    await fetch('/api/open-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath: '/Users/h/Downloads/Ancient Books' })
    });
  };
}
if ($('#bmBarReadBtn')) {
  $('#bmBarReadBtn').onclick = () => {
    const bm = state.brain?.activeBookmark;
    openCodexReader(bm?.bookId, bm?.chapterNumber, 'reader');
  };
}
if ($('#bmBarLeftTap')) {
  $('#bmBarLeftTap').onclick = () => {
    const bm = state.brain?.activeBookmark;
    openCodexReader(bm?.bookId, bm?.chapterNumber, 'reader');
  };
}
if ($('#bmBarDiscussBtn')) {
  $('#bmBarDiscussBtn').onclick = () => {
    const bm = state.brain?.activeBookmark;
    discussChapterWithPoseidon(bm?.bookId, bm?.chapterNumber);
  };
}

// ---------- Collapsible Sidebar (Desktop) & Slide-Out Drawer (Mobile) ----------
function applySidebarCollapsedState(collapsed) {
  const appEl = $('.app');
  if (!appEl) return;
  appEl.classList.toggle('sidebar-collapsed', !!collapsed);
  try {
    localStorage.setItem('poseidon_sidebar_collapsed', collapsed ? '1' : '0');
  } catch {}
}

function toggleSidebarCollapsed() {
  const appEl = $('.app');
  if (!appEl) return;
  const next = !appEl.classList.contains('sidebar-collapsed');
  applySidebarCollapsedState(next);
}

try {
  if (localStorage.getItem('poseidon_sidebar_collapsed') === '1') {
    applySidebarCollapsedState(true);
  }
} catch {}

if ($('#collapseSidebarBtn')) {
  $('#collapseSidebarBtn').onclick = (e) => {
    e.stopPropagation();
    toggleSidebarCollapsed();
  };
}

if ($('#sidebarBrandToggle')) {
  $('#sidebarBrandToggle').onclick = () => {
    if ($('.app')?.classList.contains('sidebar-collapsed') && window.innerWidth > 900) {
      applySidebarCollapsedState(false);
    }
  };
}

function openGptDrawer() {
  $('#gptSidebarDrawer')?.classList.add('open');
  $('#gptDrawerBackdrop')?.classList.remove('hidden');
  renderDrawerConversations($('#drawerSearchInput')?.value || '');
}

function closeGptDrawer() {
  $('#gptSidebarDrawer')?.classList.remove('open');
  $('#gptDrawerBackdrop')?.classList.add('hidden');
}

function switchDeepTab(tabName) {
  document.querySelectorAll('.tabs .tab, .panel').forEach(x => x.classList.remove('active'));
  const t = document.querySelector(`.tabs .tab[data-tab="${tabName}"]`);
  if (t) t.classList.add('active');
  const p = $('#tab-' + tabName);
  if (p) p.classList.add('active');
}

if ($('#openSidebarBtn')) {
  $('#openSidebarBtn').onclick = () => {
    if (window.innerWidth > 900) {
      toggleSidebarCollapsed();
    } else {
      openGptDrawer();
    }
  };
}
if ($('#closeDrawerBtn')) $('#closeDrawerBtn').onclick = closeGptDrawer;
if ($('#gptDrawerBackdrop')) $('#gptDrawerBackdrop').onclick = closeGptDrawer;

if ($('#headerBrandClick')) {
  $('#headerBrandClick').onclick = () => {
    const bm = state.brain?.activeBookmark;
    openCodexReader(bm?.bookId, bm?.chapterNumber, 'reader');
  };
}

if ($('#mobileCodexTopBtn')) {
  $('#mobileCodexTopBtn').onclick = () => {
    const bm = state.brain?.activeBookmark;
    openCodexReader(bm?.bookId, bm?.chapterNumber, 'reader');
  };
}
if ($('#mobileDeepTopBtn')) {
  $('#mobileDeepTopBtn').onclick = () => {
    $('#deep')?.classList.add('open');
    renderBrain();
  };
}
if ($('#mobileNewChatTopBtn')) {
  $('#mobileNewChatTopBtn').onclick = startNewChat;
}

if ($('#drawerNewChatBtn')) {
  $('#drawerNewChatBtn').onclick = () => { closeGptDrawer(); startNewChat(); };
}
if ($('#drawerNewConvoRow')) {
  $('#drawerNewConvoRow').onclick = () => { closeGptDrawer(); startNewChat(); };
}
if ($('#drawerCodexBtn')) {
  $('#drawerCodexBtn').onclick = () => { closeGptDrawer(); openCodexReader(null, null, 'shelf'); };
}
if ($('#drawerOpenBmBtn')) {
  $('#drawerOpenBmBtn').onclick = () => {
    closeGptDrawer();
    const bm = state.brain?.activeBookmark;
    openCodexReader(bm?.bookId, bm?.chapterNumber, 'reader');
  };
}
if ($('#drawerBookmarkCard')) {
  $('#drawerBookmarkCard').onclick = (e) => {
    if (e.target.closest('button')) return;
    closeGptDrawer();
    const bm = state.brain?.activeBookmark;
    openCodexReader(bm?.bookId, bm?.chapterNumber, 'reader');
  };
}
if ($('#drawerDeepBtn')) {
  $('#drawerDeepBtn').onclick = () => {
    closeGptDrawer();
    $('#deep')?.classList.add('open');
    renderBrain();
  };
}
if ($('#drawerForesightBtn')) {
  $('#drawerForesightBtn').onclick = () => {
    closeGptDrawer();
    $('#deep')?.classList.add('open');
    switchDeepTab('oracle');
    renderBrain();
  };
}
if ($('#drawerMonthlyBtn')) {
  $('#drawerMonthlyBtn').onclick = () => {
    closeGptDrawer();
    $('#chatsModal')?.classList.remove('hidden');
    $('#subTabMonthly')?.click();
  };
}
if ($('#drawerLogDreamBtn')) {
  $('#drawerLogDreamBtn').onclick = () => { closeGptDrawer(); $('#openAddDream')?.click(); };
}
if ($('#drawerLogRantBtn')) {
  $('#drawerLogRantBtn').onclick = () => { closeGptDrawer(); $('#openAddRant')?.click(); };
}
if ($('#drawerIngestBookBtn')) {
  $('#drawerIngestBookBtn').onclick = () => { closeGptDrawer(); $('#openAddBook')?.click(); };
}
if ($('#drawerAllChatsModalBtn')) {
  $('#drawerAllChatsModalBtn').onclick = () => { closeGptDrawer(); $('#openChatsBtn')?.click(); };
}
if ($('#drawerMobileSyncBtn')) {
  $('#drawerMobileSyncBtn').onclick = () => { closeGptDrawer(); openMobileModal(); };
}
if ($('#drawerSettingsBtn')) {
  $('#drawerSettingsBtn').onclick = () => { closeGptDrawer(); openSettings(); };
}
if ($('#drawerSearchInput')) {
  $('#drawerSearchInput').addEventListener('input', e => {
    renderDrawerConversations(e.target.value || '');
  });
}

// Close the sidebar after any navigation tap (phone)
$('#gptSidebarDrawer')?.addEventListener('click', e => {
  if (e.target.closest('button') && !e.target.closest('#collapseSidebarBtn') && window.innerWidth <= 900) {
    setTimeout(closeGptDrawer, 0);
  }
});

// Composer "+" Quick Action Sheet
function closeActionSheet() {
  $('#composerActionSheet')?.classList.add('hidden');
  $('#composerPlusBtn')?.classList.remove('active');
}

if ($('#composerPlusBtn')) {
  $('#composerPlusBtn').onclick = (e) => {
    e.stopPropagation();
    const sheet = $('#composerActionSheet');
    const isHidden = sheet?.classList.contains('hidden');
    if (isHidden) {
      sheet.classList.remove('hidden');
      $('#composerPlusBtn').classList.add('active');
    } else {
      closeActionSheet();
    }
  };
}

document.addEventListener('click', e => {
  if (!e.target.closest('#composerActionSheet') && !e.target.closest('#composerPlusBtn')) {
    closeActionSheet();
  }
});

document.querySelectorAll('#composerActionSheet [data-sheet-action]').forEach(btn => {
  btn.onclick = () => {
    const act = btn.dataset.sheetAction;
    closeActionSheet();
    const bm = state.brain?.activeBookmark;
    if (act === 'attach-image') {
      $('#imageInput')?.click();
    } else if (act === 'read-chapter') {
      openCodexReader(bm?.bookId, bm?.chapterNumber, 'reader');
    } else if (act === 'discuss-chapter') {
      discussChapterWithPoseidon(bm?.bookId, bm?.chapterNumber);
    } else if (act === 'log-dream') {
      $('#openAddDream')?.click();
    } else if (act === 'log-rant') {
      $('#openAddRant')?.click();
    } else if (act === 'foresight') {
      send('Calculate my Steins;Gate world line divergences, unpredictable anomalies, and tactical protocols:');
    } else if (act === 'patterns') {
      send('Look across everything I have shared so far. Where do the pieces connect?');
    } else if (act === 'ingest-book') {
      $('#openAddBook')?.click();
    }
  };
});

// Floating Scroll-to-Bottom Button (ChatGPT style)
if (msgs && $('#scrollBottomBtn')) {
  msgs.addEventListener('scroll', () => {
    const distFromBottom = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight;
    $('#scrollBottomBtn').classList.toggle('hidden', distFromBottom < 200);
  });
  $('#scrollBottomBtn').onclick = () => {
    msgs.scrollTo({ top: msgs.scrollHeight, behavior: 'smooth' });
  };
}

// Touch Edge-Swipe Gesture to open/close ChatGPT Drawer on Phone
let touchStartX = 0;
let touchStartY = 0;
document.addEventListener('touchstart', e => {
  if (!e.touches || e.touches.length !== 1) return;
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}, { passive: true });

document.addEventListener('touchend', e => {
  if (!e.changedTouches || e.changedTouches.length !== 1) return;
  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = Math.abs(e.changedTouches[0].clientY - touchStartY);
  if (dy > 60) return;
  const drawerOpen = $('#gptSidebarDrawer')?.classList.contains('open');
  if (!drawerOpen && touchStartX < 28 && dx > 65) {
    openGptDrawer();
  } else if (drawerOpen && dx < -65) {
    closeGptDrawer();
  }
}, { passive: true });

// ---------- Mobile Access, Permanent Domain & Automatic Worldwide Beacon ----------
const BEACON_TOPIC = 'poseidon_nembaz_sanctum_v1';

async function resolvePermanentCloudBeacon() {
  try {
    let resp = await fetch(`https://ntfy.sh/${BEACON_TOPIC}/json?poll=1&since=24h`).catch(() => null);
    if (!resp || !resp.ok) {
      resp = await fetch(`https://ntfy.sh/${BEACON_TOPIC}/json?poll=1`).catch(() => null);
    }
    if (!resp || !resp.ok) return null;
    const text = await resp.text();
    const lines = text.trim().split('\n').filter(Boolean).reverse();
    for (const line of lines) {
      try {
        const outer = JSON.parse(line);
        if (outer.event === 'message' && outer.message) {
          let tunnelUrl = '';
          if (typeof outer.message === 'string' && outer.message.trim().startsWith('http')) {
            tunnelUrl = outer.message.trim();
          } else {
            const inner = JSON.parse(outer.message);
            if (inner && inner.tunnelUrl && inner.tunnelUrl.startsWith('http')) {
              tunnelUrl = inner.tunnelUrl;
            }
          }
          if (tunnelUrl) {
            localStorage.setItem('poseidon_live_beacon_url', tunnelUrl);
            return { tunnelUrl };
          }
        }
      } catch {}
    }
  } catch {}
  return null;
}

async function openMobileModal() {
  $('#mobileModal').classList.remove('hidden');
  await refreshMobileLinks(false);
}

async function refreshMobileLinks(forceStart = false) {
  const tunnelEl = $('#mobileTunnelUrl');
  const lanEl = $('#mobileLanUrl');
  const tunnelQr = $('#mobileTunnelQrWrap');
  const lanQr = $('#mobileLanQrWrap');
  const permBadge = $('#permStatusBadge');
  const domainInput = $('#ngrokDomainInput');
  const removePermBtn = $('#removePermanentBtn');

  if (tunnelEl) tunnelEl.textContent = forceStart ? 'Building a fresh worldwide link (up to 30s)...' : 'Checking worldwide link is live...';
  if (tunnelQr) tunnelQr.innerHTML = '';

  try {
    let res;
    if (forceStart) {
      res = await fetch('/api/mobile/tunnel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'restart' }) });
    } else {
      res = await fetch('/api/mobile');
    }
    let data = await res.json();
    if (!data.tunnelUrl && !forceStart) {
      res = await fetch('/api/mobile/tunnel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'start' }) });
      data = await res.json();
    }

    if (permBadge) {
      if (data.isPermanent && data.ngrokDomain) {
        permBadge.textContent = `PERMANENT STATIC DOMAIN ACTIVE (${data.ngrokDomain})`;
      } else {
        permBadge.textContent = 'PERMANENT CLOUD BEACON ACTIVE';
      }
    }
    if (domainInput && data.ngrokDomain) domainInput.value = data.ngrokDomain;
    if (removePermBtn) removePermBtn.style.display = data.isPermanent ? 'inline-flex' : 'none';

    if (lanEl && data.lanUrl) {
      lanEl.textContent = data.lanUrl;
      if (lanQr) {
        lanQr.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&bgcolor=071524&color=1cd4b6&data=${encodeURIComponent(data.lanUrl)}" alt="Wi-Fi QR" style="border-radius:8px; border:1px solid var(--teal-border); padding:6px; background:#071524;" />`;
      }
    }

    if (tunnelEl) {
      if (data.tunnelUrl) {
        tunnelEl.textContent = data.tunnelUrl;
        if (tunnelQr) {
          tunnelQr.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&bgcolor=071524&color=d4af37&data=${encodeURIComponent(data.tunnelUrl)}" alt="Worldwide QR" style="border-radius:8px; border:1px solid var(--gold-border); padding:6px; background:#071524;" />`;
        }
      } else {
        tunnelEl.textContent = 'Click "Refresh Tunnel" to generate a live worldwide link.';
      }
    }
  } catch (e) {
    // Check permanent cloud beacon if local Mac API was unreachable
    const beacon = await resolvePermanentCloudBeacon();
    if (beacon && beacon.tunnelUrl && tunnelEl) {
      tunnelEl.textContent = beacon.tunnelUrl;
      if (tunnelQr) {
        tunnelQr.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&bgcolor=071524&color=d4af37&data=${encodeURIComponent(beacon.tunnelUrl)}" alt="Worldwide QR" style="border-radius:8px; border:1px solid var(--gold-border); padding:6px; background:#071524;" />`;
      }
    } else if (tunnelEl) {
      tunnelEl.textContent = 'Currently in Autonomous Offline/Pocket Mode (Mac off).';
    }
  }
}

if ($('#openMobileBtn')) $('#openMobileBtn').onclick = openMobileModal;
if ($('#closeMobileModal')) $('#closeMobileModal').onclick = () => $('#mobileModal').classList.add('hidden');
if ($('#closeMobileBtnBottom')) $('#closeMobileBtnBottom').onclick = () => $('#mobileModal').classList.add('hidden');

if ($('#savePermanentBtn')) {
  $('#savePermanentBtn').onclick = async () => {
    const token = ($('#ngrokTokenInput')?.value || '').trim();
    const domain = ($('#ngrokDomainInput')?.value || '').trim();
    if (!token || !domain) {
      toast('Enter both your Ngrok Authtoken and Static Domain, or use the automatic Worldwide Link above.', 'gold');
      return;
    }
    const btn = $('#savePermanentBtn');
    btn.disabled = true;
    btn.textContent = 'Activating Permanent Link...';
    try {
      const res = await fetch('/api/mobile/permanent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, domain })
      });
      const data = await res.json();
      if (data.tunnelUrl) {
        toast('Permanent Static Link Activated: ' + data.tunnelUrl, 'gold');
      }
      await refreshMobileLinks(false);
    } catch (err) {
      toast('Error activating permanent domain: ' + err.message, 'gold');
    }
    btn.disabled = false;
    btn.textContent = 'Activate Permanent Link';
  };
}

if ($('#removePermanentBtn')) {
  $('#removePermanentBtn').onclick = async () => {
    const btn = $('#removePermanentBtn');
    btn.disabled = true;
    try {
      await fetch('/api/mobile/permanent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove' })
      });
      toast('Switched back to automatic Worldwide Beacon Tunnel', 'teal');
      await refreshMobileLinks(false);
    } catch {}
    btn.disabled = false;
  };
}

if ($('#refreshTunnelBtn')) {
  $('#refreshTunnelBtn').onclick = async () => {
    const btn = $('#refreshTunnelBtn');
    btn.disabled = true;
    btn.textContent = 'Starting...';
    await refreshMobileLinks(true);
    btn.disabled = false;
    btn.textContent = 'Refresh Tunnel';
  };
}

if ($('#copyTunnelBtn')) {
  $('#copyTunnelBtn').onclick = () => {
    const txt = ($('#mobileTunnelUrl')?.textContent || '').trim();
    if (!txt.startsWith('http')) return;
    navigator.clipboard.writeText(txt).then(() => {
      const btn = $('#copyTunnelBtn');
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = 'Copy Worldwide Link'; }, 2000);
    });
  };
}

if ($('#copyLanBtn')) {
  $('#copyLanBtn').onclick = () => {
    const txt = ($('#mobileLanUrl')?.textContent || '').trim();
    if (!txt.startsWith('http')) return;
    navigator.clipboard.writeText(txt).then(() => {
      const btn = $('#copyLanBtn');
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = 'Copy Local Wi-Fi Link'; }, 2000);
    });
  };
}

// ---------- Register Service Worker for Offline / Mac-Off Access ----------
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').then(reg => {
    reg.update().catch(() => {});
  }).catch(() => {});
}

// ---------- PWA Install Banner and Modal Guide ----------
let deferredInstallPrompt = null;
const isAppStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (!isAppStandalone) {
    showPwaBanner();
  }
});

function showPwaBanner() {
  if (isAppStandalone) return;
  const dismissedAt = Number(localStorage.getItem('poseidon_pwa_dismissed') || 0);
  if (Date.now() - dismissedAt < 86400000 * 2) return;
  const b = $('#pwaInstallBanner');
  if (b) b.classList.remove('hidden');
}

function hidePwaBanner(permanent = false) {
  const b = $('#pwaInstallBanner');
  if (b) b.classList.add('hidden');
  if (permanent) {
    try { localStorage.setItem('poseidon_pwa_dismissed', String(Date.now())); } catch {}
  }
}

function openPwaGuideModal() {
  const m = $('#pwaInstallModal');
  if (m) m.classList.remove('hidden');
}

function closePwaGuideModal() {
  const m = $('#pwaInstallModal');
  if (m) m.classList.add('hidden');
}

if ($('#pwaInstallActionBtn')) {
  $('#pwaInstallActionBtn').onclick = () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      deferredInstallPrompt.userChoice.then(() => {
        deferredInstallPrompt = null;
        hidePwaBanner(true);
      });
    } else {
      openPwaGuideModal();
    }
  };
}

if ($('#sidebarInstallBtn')) {
  $('#sidebarInstallBtn').onclick = () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      deferredInstallPrompt.userChoice.then(() => {
        deferredInstallPrompt = null;
      });
    } else {
      openPwaGuideModal();
    }
  };
}

if ($('#pwaInstallDismissBtn')) {
  $('#pwaInstallDismissBtn').onclick = () => hidePwaBanner(true);
}
if ($('#closePwaGuideBtn')) {
  $('#closePwaGuideBtn').onclick = closePwaGuideModal;
}
if ($('#pwaGuideDoneBtn')) {
  $('#pwaGuideDoneBtn').onclick = closePwaGuideModal;
}

if (!isAppStandalone && (window.innerWidth <= 860 || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent))) {
  setTimeout(showPwaBanner, 3000);
}

// Multi-endpoint discovery and periodic auto-sync
async function getEffectiveSyncEndpoints() {
  const endpoints = [];
  const origin = window.location.origin;
  const isGh = origin && origin.includes('github.io');

  if (!isGh && origin && origin.startsWith('http')) {
    endpoints.push(origin.replace(/\/+$/, ''));
  }

  const custom = localStorage.getItem('poseidon_custom_sync_url');
  if (custom && custom.startsWith('http')) endpoints.push(custom.trim().replace(/\/+$/, ''));

  const cachedBeacon = localStorage.getItem('poseidon_live_beacon_url');
  if (cachedBeacon && cachedBeacon.startsWith('http')) endpoints.push(cachedBeacon.trim().replace(/\/+$/, ''));

  if (isGh) {
    try {
      const b = await resolvePermanentCloudBeacon();
      if (b && b.tunnelUrl && b.tunnelUrl.startsWith('http')) {
        endpoints.unshift(b.tunnelUrl.trim().replace(/\/+$/, ''));
      }
    } catch {}
  }

  endpoints.push('https://discs-utilities-knit-convinced.trycloudflare.com');
  endpoints.push('https://occupied-tel-identity-implementation.trycloudflare.com');
  endpoints.push('http://192.168.100.48:7777');

  return [...new Set(endpoints.filter(u => u && u.startsWith('http')))];
}

async function attemptCloudBrainSync(manual = false) {
  const cachedVault = loadLocalVault() || {};
  const currentConvo = Array.isArray(state.convo) ? state.convo : [];
  const vaultConvo = Array.isArray(cachedVault.convo) ? cachedVault.convo : [];
  const convoToSend = currentConvo.length >= vaultConvo.length ? currentConvo : vaultConvo;
  const bmBook = (state.brain?.books || cachedVault.brain?.books || []).find(x => x.id === (state.brain?.activeBookmark?.bookId || cachedVault.brain?.activeBookmark?.bookId));

  const payload = {
    convo: convoToSend,
    activeBookmark: state.brain?.activeBookmark || cachedVault.brain?.activeBookmark,
    completedChapters: bmBook?.completedChapters,
    userNotes: bmBook?.userNotes,
    pendingDreams: state.pendingDreams?.length ? state.pendingDreams : (cachedVault.pendingDreams || []),
    pendingRants: state.pendingRants?.length ? state.pendingRants : (cachedVault.pendingRants || []),
    pendingMessages: state.pendingMessages?.length ? state.pendingMessages : (cachedVault.pendingMessages || [])
  };

  const endpoints = await getEffectiveSyncEndpoints();
  let syncSuccess = false;

  for (const ep of endpoints) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 6500);
      const syncRes = await fetch(`${ep}/api/mobile/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(tid);

      if (syncRes && syncRes.ok) {
        const j = await syncRes.json();
        if (j && j.ok) {
          syncSuccess = true;
          localStorage.setItem('poseidon_live_beacon_url', ep);
          if (Array.isArray(j.convo) && j.convo.length >= state.convo.length) {
            state.convo = j.convo;
          }
          if (j.brain) state.brain = j.brain;
          state.pendingDreams = [];
          state.pendingRants = [];
          state.pendingMessages = [];
          saveLocalVault();
          if ($('#drawerSyncStatus')) $('#drawerSyncStatus').textContent = 'Live Brain Synced';
          renderBrain();
          if (manual && typeof toast === 'function') {
            toast(`Synced with Mac. ${j.totalCount || state.convo.length} chats in Sanctum.`, 'teal');
          }
          break;
        }
      }
    } catch (e) {}
  }

  if (!syncSuccess && manual && typeof toast === 'function') {
    toast('Could not reach Mac server directly. Use Copy Chats to transfer.', 'gold');
  }
  return syncSuccess;
}

window.addEventListener('online', () => attemptCloudBrainSync(false));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') attemptCloudBrainSync(false);
});
setInterval(() => attemptCloudBrainSync(false), 60000);

// ---------- Vault Transfer & Phone Sync Handlers ----------
function openVaultTransferModal() {
  const modal = $('#vaultTransferModal');
  if (!modal) return;
  modal.classList.remove('hidden');

  const cachedVault = loadLocalVault() || {};
  const msgsList = (state.convo && state.convo.length) ? state.convo : (cachedVault.convo || []);
  const count = msgsList.length;
  const lastMsg = count ? msgsList[count - 1] : null;
  const lastDate = lastMsg?.ts ? new Date(lastMsg.ts).toLocaleString() : 'No timestamp';
  const lastTxt = lastMsg?.content ? String(lastMsg.content).slice(0, 90) : 'None';

  const isPhone = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth <= 860;
  const isPwa = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

  if ($('#vtDeviceBadge')) {
    $('#vtDeviceBadge').textContent = isPwa ? 'Phone Standalone App' : (isPhone ? 'Mobile Browser' : 'Mac Desktop');
  }

  if ($('#vtStatsText')) {
    $('#vtStatsText').innerHTML = `
      <strong>${count}</strong> total chats saved in this device storage.<br>
      <span style="font-size:11.5px;">Last Active: ${lastDate}</span><br>
      <span style="font-size:11.5px; opacity:0.8;">Latest: "${escapeHtml(lastTxt)}..."</span>
    `;
  }

  const cachedBeacon = localStorage.getItem('poseidon_live_beacon_url') || 'https://occupied-tel-identity-implementation.trycloudflare.com';
  if ($('#vtServerUrl') && !$('#vtServerUrl').value) {
    $('#vtServerUrl').value = cachedBeacon;
  }
}

function closeVaultTransferModal() {
  const modal = $('#vaultTransferModal');
  if (modal) modal.classList.add('hidden');
}

async function copyVaultChatsToClipboard() {
  const cachedVault = loadLocalVault() || {};
  const convoToExport = (state.convo && state.convo.length) ? state.convo : (cachedVault.convo || []);
  const exportData = {
    exportedAt: new Date().toISOString(),
    sourceDevice: navigator.userAgent,
    convoCount: convoToExport.length,
    convo: convoToExport,
    brain: state.brain || cachedVault.brain || {}
  };
  const jsonStr = JSON.stringify(exportData, null, 2);

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(jsonStr);
      if (typeof toast === 'function') toast(`Copied ${convoToExport.length} chats to clipboard.`, 'teal');
    } else {
      const ta = document.createElement('textarea');
      ta.value = jsonStr;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      if (typeof toast === 'function') toast(`Copied ${convoToExport.length} chats to clipboard.`, 'teal');
    }
  } catch (e) {
    if ($('#vtPasteArea')) {
      $('#vtPasteArea').value = jsonStr;
      $('#vtPasteArea').select();
      if (typeof toast === 'function') toast('Selected JSON. Long-press to copy.', 'gold');
    }
  }
}

function downloadVaultBackupFile() {
  const cachedVault = loadLocalVault() || {};
  const convoToExport = (state.convo && state.convo.length) ? state.convo : (cachedVault.convo || []);
  const exportData = {
    exportedAt: new Date().toISOString(),
    sourceDevice: navigator.userAgent,
    convoCount: convoToExport.length,
    convo: convoToExport,
    brain: state.brain || cachedVault.brain || {}
  };
  const jsonStr = JSON.stringify(exportData, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });

  if (navigator.canShare && navigator.canShare({ files: [new File([blob], 'poseidon-chats.json', { type: 'application/json' })] })) {
    const file = new File([blob], 'poseidon-chats.json', { type: 'application/json' });
    navigator.share({
      title: 'Poseidon Sanctum Chats',
      text: 'Poseidon conversation backup',
      files: [file]
    }).catch(() => {});
    return;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `poseidon-chats-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  if (typeof toast === 'function') toast('Vault file downloaded.', 'teal');
}

async function pushVaultToMacServer() {
  const inputUrl = ($('#vtServerUrl')?.value || '').trim().replace(/\/+$/, '');
  if (!inputUrl) {
    if (typeof toast === 'function') toast('Enter Mac URL first.', 'gold');
    return;
  }
  localStorage.setItem('poseidon_custom_sync_url', inputUrl);
  const statusEl = $('#vtSyncStatus');
  if (statusEl) statusEl.textContent = 'Connecting to Mac...';

  const cachedVault = loadLocalVault() || {};
  const convoToSend = (state.convo && state.convo.length) ? state.convo : (cachedVault.convo || []);
  const bmBook = (state.brain?.books || []).find(x => x.id === state.brain?.activeBookmark?.bookId);

  try {
    const res = await fetch(`${inputUrl}/api/mobile/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        convo: convoToSend,
        activeBookmark: state.brain?.activeBookmark,
        completedChapters: bmBook?.completedChapters,
        userNotes: bmBook?.userNotes,
        pendingDreams: state.pendingDreams || [],
        pendingRants: state.pendingRants || [],
        pendingMessages: state.pendingMessages || []
      })
    });
    if (res.ok) {
      const j = await res.json();
      if (j && j.ok) {
        if (Array.isArray(j.convo)) state.convo = j.convo;
        if (j.brain) state.brain = j.brain;
        saveLocalVault();
        if (statusEl) statusEl.textContent = `Success. Synced ${j.syncedCount || 0} chats into Mac (Total: ${j.totalCount || state.convo.length}).`;
        if (typeof toast === 'function') toast('Success: Synced with Mac Sanctum.', 'teal');
        return;
      }
    }
    if (statusEl) statusEl.textContent = `Error: Server returned HTTP ${res.status}`;
  } catch (e) {
    if (statusEl) statusEl.textContent = 'Failed to connect. Check URL or Wi-Fi.';
  }
}

async function mergeImportedVaultText(rawText) {
  if (!rawText || !rawText.trim()) {
    if (typeof toast === 'function') toast('Please paste conversation JSON first.', 'gold');
    return;
  }
  try {
    const parsed = JSON.parse(rawText.trim());
    let res = await fetch('/api/convo/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed)
    }).catch(() => null);

    if (!res || !res.ok) {
      let incoming = [];
      if (Array.isArray(parsed)) incoming = parsed;
      else if (Array.isArray(parsed.convo)) incoming = parsed.convo;
      else if (Array.isArray(parsed.messages)) incoming = parsed.messages;

      if (incoming.length) {
        const existingTs = new Set((state.convo || []).map(m => m.ts));
        for (const m of incoming) {
          if (m && !existingTs.has(m.ts)) {
            state.convo.push(m);
            existingTs.add(m.ts);
          }
        }
        state.convo.sort((a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0));
        saveLocalVault();
        location.reload();
        return;
      }
    } else {
      const j = await res.json();
      if (j && j.ok) {
        if (Array.isArray(j.convo)) state.convo = j.convo;
        if (j.brain) state.brain = j.brain;
        saveLocalVault();
        if (typeof toast === 'function') toast(`Merged ${j.importedCount || 0} chats into Sanctum. Total: ${j.totalCount}.`, 'teal');
        setTimeout(() => location.reload(), 800);
      }
    }
  } catch (e) {
    if (typeof toast === 'function') toast('Invalid JSON format.', 'gold');
  }
}

// Attach Vault Transfer UI Event Listeners
if ($('#vaultTransferBtn')) $('#vaultTransferBtn').onclick = openVaultTransferModal;
if ($('#topSyncBtn')) $('#topSyncBtn').onclick = () => attemptCloudBrainSync(true);
if ($('#settingsVaultTransferBtn')) $('#settingsVaultTransferBtn').onclick = openVaultTransferModal;
if ($('#closeVaultTransferModal')) $('#closeVaultTransferModal').onclick = closeVaultTransferModal;
if ($('#closeVaultTransferBtn')) $('#closeVaultTransferBtn').onclick = closeVaultTransferModal;
if ($('#vtCopyBtn')) $('#vtCopyBtn').onclick = copyVaultChatsToClipboard;
if ($('#vtDownloadBtn')) $('#vtDownloadBtn').onclick = downloadVaultBackupFile;
if ($('#vtPushBtn')) $('#vtPushBtn').onclick = pushVaultToMacServer;
if ($('#vtMergeBtn')) {
  $('#vtMergeBtn').onclick = () => {
    const val = $('#vtPasteArea')?.value || '';
    mergeImportedVaultText(val);
  };
}
if ($('#vtFileInput')) {
  $('#vtFileInput').onchange = async e => {
    const f = e.target.files[0];
    if (!f) return;
    const txt = await f.text();
    mergeImportedVaultText(txt);
  };
}

// ---------- Boot ----------
(async () => {
  const cachedVault = loadLocalVault();
  try {
    let loadedState = null;
    try {
      const sRes = await fetch('/api/state');
      if (sRes && sRes.ok) loadedState = await sRes.json();
    } catch {}

    if (!loadedState) {
      try {
        const dRes = await fetch('./data_state.json');
        if (dRes && dRes.ok) loadedState = await dRes.json();
      } catch {}
    }

    if (loadedState) {
      state = loadedState;
      if (cachedVault && Array.isArray(cachedVault.convo) && cachedVault.convo.length) {
        const existingTs = new Set((state.convo || []).map(m => m.ts));
        const existingTexts = new Set((state.convo || []).map(m => `${m.role}:${String(m.content || '').trim().slice(0, 100)}`));
        let added = 0;
        for (const m of cachedVault.convo) {
          if (!m || !m.content) continue;
          const textKey = `${m.role}:${String(m.content || '').trim().slice(0, 100)}`;
          if ((m.ts && existingTs.has(m.ts)) || existingTexts.has(textKey)) continue;
          state.convo.push(m);
          if (m.ts) existingTs.add(m.ts);
          existingTexts.add(textKey);
          added++;
        }
        if (added > 0) {
          state.convo.sort((a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0));
        }
      }
      if (cachedVault && cachedVault.brain?.activeBookmark) {
        state.brain.activeBookmark = cachedVault.brain.activeBookmark;
      }
      if (state.settings?.directKey) {
        try { localStorage.setItem('poseidon_direct_key', state.settings.directKey); } catch {}
      }
      state.pendingDreams = cachedVault?.pendingDreams || [];
      state.pendingRants = cachedVault?.pendingRants || [];
      state.pendingMessages = cachedVault?.pendingMessages || [];
      saveLocalVault();
      if ($('#drawerSyncStatus')) $('#drawerSyncStatus').textContent = 'Live Brain Synced';
    } else if (cachedVault) {
      state = cachedVault;
      if ($('#drawerSyncStatus')) $('#drawerSyncStatus').textContent = 'Autonomous Mobile Mode';
    }

    if (state.settings?.directKey) {
      try { localStorage.setItem('poseidon_direct_key', state.settings.directKey); } catch {}
    }
  } catch {
    if (cachedVault) {
      state = cachedVault;
    }
    if ($('#drawerSyncStatus')) $('#drawerSyncStatus').textContent = 'Autonomous Mobile Mode';
  }

  if (state.convo && state.convo.length) {
    ensureChatHistoryBanner();
    state.convo.forEach(m => addMsg(m.role, m.content, m.ts, '', m.images));
    setTimeout(() => { msgs.scrollTop = msgs.scrollHeight; }, 40);
  } else {
    welcome();
  }
  renderBrain();
  updateLastInChatStatus();
  if (typeof loadConversations === 'function') loadConversations();
  if (!state.settings?.hasKey && !state.settings?.directKey && state.settings?.provider !== 'ollama') {
    openSettings();
  }
  if (window.innerWidth > 860) {
    input.focus();
  }

  // Auto-sync in background after render
  setTimeout(() => attemptCloudBrainSync(false), 1500);
})();



