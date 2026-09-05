/* ───────── 분류 ───────── */
const CATS = {
  지출: {
    식비:      ['장보기','외식','카페','배달','술'],
    생활:      ['생필품','의류','미용','세탁','가전가구','반려동물'],
    주거통신:  ['월세','관리비','공과금','통신비','구독료'],
    교통:      ['대중교통','택시','기차·버스','주유·주차'],
    의료건강:  ['진료비','약국','보험료','운동'],
    문화여가:  ['취미재료','게임','도서','영화·공연','여행','모임'],
    자기계발:  ['강의','시험','장비','소프트웨어'],
    경조사:    ['축의·부의','선물','기부'],
    금융세금:  ['이자','수수료','세금','과태료'],
    기타:      ['미분류']
  },
  수입: {
    급여:      ['월급','상여','수당'],
    부업:      ['외주','중고판매','원고료'],
    환급지원:  ['의료비 환급','교통비 환급','세금 환급','지원금'],
    금융수입:  ['이자','배당','투자수익'],
    기타수입:  ['용돈','받은 선물','기타']
  },
  이체: {
    저축:      ['적금','비상금'],
    투자:      ['주식','연금'],
    카드대금:  ['신용카드 결제'],
    현금:      ['현금 인출','계좌 간 이동']
  }
};
const PAYS = ['신용카드','체크카드','계좌이체','현금'];
const DEFAULT_PRESETS = [
  { type:'지출', amount:1550,  cat:'교통', sub:'대중교통', pay:'체크카드', memo:'', label:'지하철' },
  { type:'지출', amount:4500,  cat:'식비', sub:'카페',     pay:'체크카드', memo:'', label:'카페' },
  { type:'지출', amount:12000, cat:'식비', sub:'외식',     pay:'체크카드', memo:'', label:'점심' }
];

/* ───────── 저장소 ───────── */
const K = { tx:'lg.tx', cfg:'lg.cfg', pre:'lg.presets', pay:'lg.lastpay' };
const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { toast('저장 공간이 가득 찼어. 백업 후 정리해줘.'); return false; } };

let TX  = load(K.tx, []);
let CFG = Object.assign({ url:'', token:'', auto:true }, load(K.cfg, {}));
let PRE = load(K.pre, DEFAULT_PRESETS);

const saveTx  = () => save(K.tx, TX);
const saveCfg = () => save(K.cfg, CFG);
const savePre = () => save(K.pre, PRE);

/* ───────── 유틸 ───────── */
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const won = n => (n < 0 ? '-' : '') + Math.abs(Math.round(n)).toLocaleString('ko-KR');
const pad = n => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const ymOf = t => (t.date || '').slice(0, 7);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const live = () => TX.filter(t => !t.deleted);

let toastT;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { el.hidden = true; }, 2000);
}
function buzz(ms) { if (navigator.vibrate) { try { navigator.vibrate(ms); } catch {} } }

/* ───────── 입력 상태 ───────── */
const S = {
  type: '지출',
  digits: '',
  cat: '식비',
  sub: '',
  pay: load(K.pay, '체크카드'),
  date: todayStr(),
  fixed: false,
  editId: null
};
let curYM = todayStr().slice(0, 7);

function accentOf(type) { return type === '수입' ? 'var(--in)' : type === '이체' ? 'var(--tr)' : 'var(--out)'; }
function signOf(type)   { return type === '수입' ? '+' : type === '이체' ? '' : '-'; }

/* ───────── 입력 화면 렌더 ───────── */
function renderSeg() {
  const i = ['지출','수입','이체'].indexOf(S.type);
  $$('.seg-b').forEach(b => b.classList.toggle('is-on', b.dataset.type === S.type));
  $('#segInd').style.transform = `translateX(${i * 100}%)`;
  document.documentElement.style.setProperty('--accent', accentOf(S.type));
  $('#amSign').textContent = signOf(S.type);
  $('#payRow').classList.toggle('off', S.type === '이체');
  $('#fixedWrap').classList.toggle('off', S.type !== '지출');
}

function renderAmount(pop) {
  const box = $('#amountBox');
  $('#amNum').textContent = S.digits ? Number(S.digits).toLocaleString('ko-KR') : '0';
  box.classList.toggle('zero', !S.digits);
  $('#saveBtn').classList.toggle('dim', !S.digits);
  if (pop) { box.classList.remove('pop'); void box.offsetWidth; box.classList.add('pop'); }
}

function catOrder(type) {
  const base = Object.keys(CATS[type]);
  const rank = {}; base.forEach((c, i) => { rank[c] = i; });
  const freq = {};
  for (const t of live()) if (t.type === type) freq[t.cat] = (freq[t.cat] || 0) + 1;
  return base.slice().sort((a, b) => (freq[b] || 0) - (freq[a] || 0) || rank[a] - rank[b]);
}

function renderCats() {
  const keys = catOrder(S.type);
  if (!keys.includes(S.cat)) { S.cat = keys[0]; S.sub = ''; }
  $('#catGrid').innerHTML = keys
    .map(c => `<button class="cat${c === S.cat ? ' is-on' : ''}" data-cat="${c}">${c}</button>`).join('');
  renderSubs();
}

function renderSubs() {
  const subs = CATS[S.type][S.cat] || [];
  $('#subRow').innerHTML = subs
    .map(s => `<button class="sub${s === S.sub ? ' is-on' : ''}" data-sub="${s}">${s}</button>`).join('');
}

function renderPays() {
  $('#payRow').innerHTML = PAYS
    .map(p => `<button class="pay${p === S.pay ? ' is-on' : ''}" data-pay="${p}">${p}</button>`).join('');
}

function renderPresets() {
  $('#presetRow').innerHTML = PRE.map((p, i) =>
    `<button class="preset" data-pre="${i}"><span class="p-c">${p.label || p.sub || p.cat}</span><b>${won(p.amount)}</b></button>`
  ).join('');
}

function applyPreset(p) {
  S.type = p.type; S.cat = p.cat; S.sub = p.sub || ''; S.digits = String(p.amount);
  if (p.pay) S.pay = p.pay;
  $('#memo').value = p.memo || '';
  renderAll(); buzz(8);
}

function renderAll() {
  renderSeg(); renderAmount(); renderCats(); renderPays(); renderPresets();
  $('#datePick').value = S.date;
  $('#fixedChk').checked = S.fixed;
  $('#editBar').hidden = !S.editId;
}

function resetInput(keepType) {
  S.digits = ''; S.sub = ''; S.date = todayStr(); S.fixed = false; S.editId = null;
  if (!keepType) S.type = '지출';
  $('#memo').value = '';
  renderAll();
}

/* ───────── 저장 ───────── */
function commit() {
  const amt = Number(S.digits);
  if (!amt) { toast('금액을 입력해줘'); return; }
  const row = {
    id: S.editId || uid(),
    date: S.date,
    type: S.type,
    amount: amt,
    cat: S.cat,
    sub: S.sub || '',
    pay: S.type === '이체' ? '' : S.pay,
    memo: $('#memo').value.trim(),
    fixed: S.type === '지출' && $('#fixedChk').checked,
    deleted: false,
    synced: false,
    updated: Date.now()
  };
  const i = TX.findIndex(t => t.id === row.id);
  if (i >= 0) TX[i] = row; else TX.unshift(row);
  if (S.type !== '이체') { S.pay = row.pay; save(K.pay, row.pay); }
  saveTx();
  curYM = row.date.slice(0, 7);
  buzz(14);
  toast(`${signOf(row.type)}${won(row.amount)}원 ${i >= 0 ? '수정했어' : '기록했어'}`);
  // 수입·이체를 넣은 뒤에는 지출로 되돌린다 (유형이 남아 잘못 분류되는 걸 막기 위해)
  resetInput(S.type === '지출');
  renderTop(); renderList(); renderStat();
  if (CFG.auto && CFG.url) flush(true);
}

function removeTx(id) {
  const t = TX.find(x => x.id === id);
  if (!t) return;
  t.deleted = true; t.synced = false; t.updated = Date.now();
  saveTx(); resetInput(true);
  renderTop(); renderList(); renderStat();
  toast('삭제했어');
  if (CFG.auto && CFG.url) flush(true);
}

function editTx(id) {
  const t = TX.find(x => x.id === id);
  if (!t) return;
  S.editId = t.id; S.type = t.type; S.digits = String(t.amount);
  S.cat = t.cat; S.sub = t.sub; S.pay = t.pay || S.pay; S.date = t.date; S.fixed = !!t.fixed;
  $('#memo').value = t.memo || '';
  go('add'); renderAll();
}

/* ───────── 상단 요약 / 월 선택 ───────── */
function monthsAvailable() {
  const set = new Set(live().map(ymOf).filter(Boolean));
  set.add(todayStr().slice(0, 7));
  return [...set].sort().reverse();
}

function renderTop() {
  const rows = live().filter(t => ymOf(t) === curYM);
  const out = rows.filter(t => t.type === '지출').reduce((a, t) => a + t.amount, 0);
  const inc = rows.filter(t => t.type === '수입').reduce((a, t) => a + t.amount, 0);
  $('#sumOut').textContent = won(out);
  $('#sumIn').textContent  = won(inc);
  const [y, m] = curYM.split('-');
  $('#monthLabel').textContent = curYM === todayStr().slice(0, 7) ? '이번 달' : `${y.slice(2)}년 ${Number(m)}월`;
  const sel = $('#monthSel');
  if (sel) sel.innerHTML = monthsAvailable()
    .map(ym => `<option value="${ym}"${ym === curYM ? ' selected' : ''}>${ym.split('-')[0]}년 ${Number(ym.split('-')[1])}월</option>`).join('');
}

/* ───────── 내역 ───────── */
function renderList() {
  const rows = live().filter(t => ymOf(t) === curYM)
    .sort((a, b) => b.date.localeCompare(a.date) || b.updated - a.updated);
  if (!rows.length) {
    $('#listWrap').innerHTML = `<p class="empty">이 달은 아직 비어 있어.<br>입력 탭에서 첫 기록을 남겨봐.</p>`;
    return;
  }
  const byDay = {};
  for (const t of rows) (byDay[t.date] ||= []).push(t);
  const cls = t => t.type === '수입' ? 'in' : t.type === '이체' ? 'tr' : 'out';
  const wk = ['일','월','화','수','목','금','토'];
  $('#listWrap').innerHTML = Object.keys(byDay).map(d => {
    const day = byDay[d];
    const net = day.reduce((a, t) => a + (t.type === '수입' ? t.amount : t.type === '지출' ? -t.amount : 0), 0);
    const dt = new Date(d + 'T00:00:00');
    return `<div class="daygroup">
      <div class="dayhead"><span>${Number(d.slice(5,7))}월 ${Number(d.slice(8,10))}일 ${wk[dt.getDay()]}</span><span>${net >= 0 ? '+' : ''}${won(net)}</span></div>
      ${day.map(t => `<button class="row" data-id="${t.id}">
        <span class="r-p${t.synced ? ' hide' : ''}"></span>
        <span class="r-main">
          <span class="r-t">${esc(t.memo || t.sub || t.cat)}</span>
          <span class="r-s">${t.cat}${t.sub ? ' · ' + t.sub : ''}${t.pay ? ' · ' + t.pay : ''}${t.fixed ? ' · 고정비' : ''}</span>
        </span>
        <span class="r-a ${cls(t)}">${signOf(t.type)}${won(t.amount)}</span>
      </button>`).join('')}
    </div>`;
  }).join('');
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

/* ───────── 통계 ───────── */
function renderStat() {
  const rows = live().filter(t => ymOf(t) === curYM);
  const out = rows.filter(t => t.type === '지출');
  const inc = rows.filter(t => t.type === '수입');
  const sOut = out.reduce((a, t) => a + t.amount, 0);
  const sInc = inc.reduce((a, t) => a + t.amount, 0);
  const fixed = out.filter(t => t.fixed).reduce((a, t) => a + t.amount, 0);

  const group = arr => {
    const g = {};
    for (const t of arr) g[t.cat] = (g[t.cat] || 0) + t.amount;
    return Object.entries(g).sort((a, b) => b[1] - a[1]);
  };
  const bars = (list, total, color) => list.map(([c, v]) => `
    <div class="bar">
      <div class="bar-h"><span>${c}<em>${total ? Math.round(v / total * 100) : 0}%</em></span><span>${won(v)}</span></div>
      <div class="bar-t"><div class="bar-f" style="width:${total ? v / total * 100 : 0}%;background:${color}"></div></div>
    </div>`).join('');

  if (!rows.length) { $('#statWrap').innerHTML = `<p class="empty">이 달 기록이 없어.</p>`; return; }

  $('#statWrap').innerHTML = `
    <div class="bignum">
      <div class="bn"><span>수입</span><strong style="color:var(--in)">${won(sInc)}</strong></div>
      <div class="bn"><span>지출</span><strong style="color:var(--out)">${won(sOut)}</strong></div>
      <div class="bn"><span>남은 돈</span><strong>${won(sInc - sOut)}</strong></div>
    </div>
    <div class="statsec">
      <h2>지출 ${fixed ? `(고정비 ${won(fixed)} / 변동비 ${won(sOut - fixed)})` : ''}</h2>
      ${bars(group(out), sOut, 'var(--out)') || '<p class="hint">지출 기록 없음</p>'}
    </div>
    <div class="statsec">
      <h2>수입</h2>
      ${bars(group(inc), sInc, 'var(--in)') || '<p class="hint">수입 기록 없음</p>'}
    </div>`;
}

/* ───────── 동기화 ───────── */
function setDot(state) { $('#syncDot').className = 'dot' + (state ? ' ' + state : ''); }
function pendingCount() { return TX.filter(t => !t.synced).length; }
function refreshDot() {
  if (!CFG.url) { setDot(''); return; }
  setDot(pendingCount() ? 'pending' : 'ok');
}

async function post(payload) {
  const res = await fetch(CFG.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ token: CFG.token }, payload))
  });
  const txt = await res.text();
  let data;
  try { data = JSON.parse(txt); } catch { throw new Error('시트가 이상한 응답을 보냈어. 배포 설정을 확인해줘.'); }
  if (!data.ok) throw new Error(data.error || '알 수 없는 오류');
  return data;
}

let flushing = false;
async function flush(quiet) {
  if (flushing) return;
  if (!CFG.url) { if (!quiet) toast('설정에서 웹앱 주소를 넣어줘'); return; }
  const queue = TX.filter(t => !t.synced);
  if (!queue.length) { if (!quiet) toast('올릴 게 없어'); refreshDot(); return; }
  flushing = true; setDot('pending');
  try {
    for (let i = 0; i < queue.length; i += 100) {
      const chunk = queue.slice(i, i + 100);
      await post({ rows: chunk.map(t => ({ ...t, synced: undefined })) });
      for (const t of chunk) t.synced = true;
    }
    TX = TX.filter(t => !(t.deleted && t.synced));
    saveTx(); refreshDot(); renderList();
    if (!quiet) toast(`${queue.length}건 올렸어`);
  } catch (e) {
    setDot('err');
    if (!quiet) toast(e.message);
    else toast('시트 전송 실패. 휴대폰에는 저장됐어.');
  } finally { flushing = false; }
}

/* ───────── 내보내기 ───────── */
function download(name, text, mime) {
  const url = URL.createObjectURL(new Blob(['\ufeff' + text], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
function toCsv() {
  const head = ['id','날짜','유형','금액','대분류','소분류','결제수단','메모','고정비'];
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const body = live().sort((a, b) => a.date.localeCompare(b.date))
    .map(t => [t.id, t.date, t.type, t.amount, t.cat, t.sub, t.pay, t.memo, t.fixed ? 'Y' : ''].map(q).join(','));
  return [head.map(q).join(','), ...body].join('\r\n');
}

/* ───────── 화면 전환 ───────── */
function go(view) {
  $$('.view').forEach(v => { v.hidden = v.dataset.view !== view; });
  $$('.tab').forEach(b => b.classList.toggle('is-on', b.dataset.go === view));
  if (view === 'list') renderList();
  if (view === 'stat') renderStat();
  if (view === 'set')  renderSettings();
}

/* ───────── 설정 화면 ───────── */
function renderSettings() {
  $('#cfgUrl').value = CFG.url;
  $('#cfgToken').value = CFG.token;
  $('#cfgAuto').checked = !!CFG.auto;
  $('#presetEdit').innerHTML = PRE.map((p, i) =>
    `<div class="pe"><span>${esc(p.label || p.sub || p.cat)} · ${won(p.amount)}원 · ${esc(p.cat)}${p.sub ? '/' + esc(p.sub) : ''}</span><button data-del="${i}" aria-label="삭제">×</button></div>`
  ).join('') || '<p class="hint">등록된 항목 없음</p>';
  $('#syncMsg').textContent = CFG.url ? `대기 중 ${pendingCount()}건` : '연동 안 함';
  $('#dataMsg').textContent = `총 ${live().length}건`;
}

/* ───────── 이벤트 ───────── */
$('#keypad').addEventListener('click', e => {
  const b = e.target.closest('.k'); if (!b) return;
  if (b.id === 'saveBtn') return commit();
  const k = b.dataset.k;
  if (k === 'del') {
    S.digits = S.digits.slice(0, -1);
  } else if (S.digits !== '' || !/^0+$/.test(k)) {
    if (S.digits.length + k.length <= 10) S.digits += k;
  }
  S.digits = S.digits.replace(/^0+/, '');
  renderAmount(true); buzz(6);
});
$('#keypad').addEventListener('contextmenu', e => {
  const b = e.target.closest('[data-k="del"]');
  if (b) { e.preventDefault(); S.digits = ''; renderAmount(true); buzz(12); }
});

$('.seg').addEventListener('click', e => {
  const b = e.target.closest('.seg-b'); if (!b) return;
  S.type = b.dataset.type; S.sub = '';
  renderSeg(); renderAmount(); renderCats();
});
$('#catGrid').addEventListener('click', e => {
  const b = e.target.closest('.cat'); if (!b) return;
  S.cat = b.dataset.cat; S.sub = '';
  renderCats(); buzz(6);
});
$('#subRow').addEventListener('click', e => {
  const b = e.target.closest('.sub'); if (!b) return;
  S.sub = (S.sub === b.dataset.sub) ? '' : b.dataset.sub;
  renderSubs(); buzz(6);
});
$('#payRow').addEventListener('click', e => {
  const b = e.target.closest('.pay'); if (!b) return;
  S.pay = b.dataset.pay; renderPays(); buzz(6);
});
$('#presetRow').addEventListener('click', e => {
  const b = e.target.closest('.preset'); if (!b) return;
  applyPreset(PRE[Number(b.dataset.pre)]);
});
$('#datePick').addEventListener('change', e => { S.date = e.target.value || todayStr(); });
$('#memo').addEventListener('keydown', e => { if (e.key === 'Enter') { e.target.blur(); commit(); } });
$('#editDel').addEventListener('click', () => { if (S.editId) removeTx(S.editId); });
$('#editCancel').addEventListener('click', () => resetInput(true));

$('#listWrap').addEventListener('click', e => {
  const r = e.target.closest('.row'); if (r) editTx(r.dataset.id);
});

$$('.tab').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
$('#syncBtn').addEventListener('click', () => flush(false));

// 월 선택
(function () {
  const sel = document.createElement('select');
  sel.id = 'monthSel';
  $('#monthPick').appendChild(sel);
  sel.addEventListener('change', () => {
    curYM = sel.value; renderTop(); renderList(); renderStat();
  });
})();

// 설정
$('#cfgUrl').addEventListener('change', e => { CFG.url = e.target.value.trim(); saveCfg(); refreshDot(); });
$('#cfgToken').addEventListener('change', e => { CFG.token = e.target.value.trim(); saveCfg(); });
$('#cfgAuto').addEventListener('change', e => { CFG.auto = e.target.checked; saveCfg(); });
$('#syncNow').addEventListener('click', async () => { await flush(false); renderSettings(); });
$('#testConn').addEventListener('click', async () => {
  if (!CFG.url) return toast('주소를 먼저 넣어줘');
  try { await post({ rows: [] }); toast('연결 됐어'); setDot('ok'); }
  catch (e) { toast(e.message); setDot('err'); }
});
$('#presetAdd').addEventListener('click', () => {
  if (!S.digits) return toast('입력 탭에서 금액과 분류를 먼저 정해줘');
  PRE.push({ type: S.type, amount: Number(S.digits), cat: S.cat, sub: S.sub, pay: S.pay, memo: $('#memo').value.trim(), label: S.sub || S.cat });
  savePre(); renderPresets(); renderSettings(); toast('추가했어');
});
$('#presetEdit').addEventListener('click', e => {
  const b = e.target.closest('[data-del]'); if (!b) return;
  PRE.splice(Number(b.dataset.del), 1); savePre(); renderPresets(); renderSettings();
});
$('#expCsv').addEventListener('click', () => download(`가계부_${todayStr()}.csv`, toCsv(), 'text/csv;charset=utf-8'));
$('#expJson').addEventListener('click', () => download(`가계부_백업_${todayStr()}.json`, JSON.stringify({ tx: TX, presets: PRE }), 'application/json'));
$('#impJson').addEventListener('click', () => $('#impFile').click());
$('#impFile').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    const ids = new Set(TX.map(t => t.id));
    let n = 0;
    for (const t of (d.tx || [])) if (!ids.has(t.id)) { TX.push(t); n++; }
    if (d.presets) { PRE = d.presets; savePre(); }
    saveTx(); renderAll(); renderTop(); renderList(); renderStat(); renderSettings();
    toast(`${n}건 불러왔어`);
  } catch { toast('파일을 읽지 못했어'); }
  e.target.value = '';
});
$('#wipe').addEventListener('click', () => {
  if (!confirm('이 기기의 모든 기록을 지울까? 되돌릴 수 없어.')) return;
  TX = []; saveTx(); renderAll(); renderTop(); renderList(); renderStat(); renderSettings();
  toast('전부 지웠어');
});

window.addEventListener('online', () => { if (CFG.auto && CFG.url) flush(true); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (S.date !== todayStr() && !S.editId) { S.date = todayStr(); $('#datePick').value = S.date; }
    if (CFG.auto && CFG.url) flush(true);
  }
});

/* ───────── 시작 ───────── */
renderAll(); renderTop(); refreshDot();
if (CFG.auto && CFG.url) flush(true);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
