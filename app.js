// ================== 전역 상태 ==================
let GEMINI_KEY = "AQ.Ab8RN6KlWRLYofYcVTz6mqlpboolxYOkk4yZopEJZLZNoVlZpw";
const GEMINI_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-3.5-flash'
];
let geminiIdx = 0;

let decks = [];              // 암기장 목록
let currentDeckId = null;    // 현재 열람 중인 암기장
let currentWords = [];       // 현재 암기장의 단어들
let pendingPreview = [];     // 추가 대기 중인 단어 미리보기
let addTargetDeckId = null;  // 단어를 추가할 대상 암기장

// 학습 세션 상태
let studyQueue = [];   // 오늘 학습할 카드 목록
let studyIdx = 0;
let studyStage = 'flip'; // flip -> quiz -> spell
let studyStats = { total: 0, correct: 0 };
let currentCard = null;

const DAILY_LIMIT = 20; // 하루 학습 개수 캡

// ================== 유틸 ==================
function $(id){ return document.getElementById(id); }
function show(id){ $(id).classList.remove('hidden'); }
function hide(id){ $(id).classList.add('hidden'); }
function showScreen(id){
  ['screen-home','screen-deck','screen-study','screen-done','screen-add','screen-newdeck'].forEach(s=>{
    if(s===id) $(s).classList.remove('hidden'); else $(s).classList.add('hidden');
  });
}
function toast(msg){
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 1800);
}
function loading(on, text){
  if(on){ $('loading-text').textContent = text||'처리 중...'; show('loading-overlay'); }
  else hide('loading-overlay');
}
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,8); }

// ================== Firestore 경로 ==================
// vocab/{deckId}  (deck meta)
// vocab/{deckId}/words/{wordId}
const { db, collection, doc, setDoc, getDocs, addDoc, deleteDoc, updateDoc, query, orderBy, writeBatch, serverTimestamp, onSnapshot } = window.__fb;

function decksCol(){ return collection(db, 'vocab'); }
function wordsCol(deckId){ return collection(db, 'vocab', deckId, 'words'); }

// ================== 암기장 목록 ==================
async function loadDecks(){
  loading(true, '불러오는 중...');
  try{
    const snap = await getDocs(decksCol());
    decks = [];
    snap.forEach(d=>decks.push({ id:d.id, ...d.data() }));
    // 단어 개수 세기
    for(const dk of decks){
      const wsnap = await getDocs(wordsCol(dk.id));
      dk.wordCount = wsnap.size;
      let due = 0;
      const now = Date.now();
      wsnap.forEach(w=>{
        const data = w.data();
        if(!data.nextReview || data.nextReview <= now) due++;
      });
      dk.dueCount = due;
    }
    renderDeckList();
  }catch(e){
    console.error(e);
    toast('불러오기 실패');
  }
  loading(false);
}

function renderDeckList(){
  const wrap = $('deck-list');
  if(decks.length===0){
    wrap.innerHTML = `<div class="empty-state">
      <div class="big">📚</div>
      <div class="msg">아직 암기장이 없어요.<br>아래 버튼으로 첫 암기장을 만들어보세요.</div>
    </div>`;
  } else {
    wrap.innerHTML = decks.map(dk=>`
      <div class="deck-card" onclick="openDeck('${dk.id}')">
        <div class="left">
          <div class="deck-name">${escapeHtml(dk.name||'이름없음')}</div>
          <div class="deck-meta">전체 ${dk.wordCount||0}개</div>
        </div>
        <div class="deck-badge">${dk.dueCount||0}</div>
      </div>
    `).join('');
  }
  renderHomeFab();
}

function renderHomeFab(){
  let fab = document.getElementById('home-fab');
  if(fab) fab.remove();
  fab = document.createElement('div');
  fab.className = 'fab';
  fab.id = 'home-fab';
  fab.innerHTML = `<button class="secondary" onclick="goNewDeck()">+ 암기장 만들기</button>`;
  document.getElementById('app').appendChild(fab);
}

window.goHome = function(){
  showScreen('screen-home');
  removeStudyFab();
  loadDecks();
};

window.goNewDeck = function(){
  $('new-deck-name').value = '';
  showScreen('screen-newdeck');
};

window.createDeck = async function(){
  const name = $('new-deck-name').value.trim();
  if(!name){ toast('암기장 이름을 입력하세요'); return; }
  loading(true, '만드는 중...');
  try{
    const ref = doc(decksCol());
    await setDoc(ref, { name, createdAt: Date.now() });
    loading(false);
    goHome();
  }catch(e){
    console.error(e); loading(false); toast('생성 실패');
  }
};

// ================== 암기장 상세 ==================
window.openDeck = async function(deckId){
  currentDeckId = deckId;
  const dk = decks.find(d=>d.id===deckId);
  $('deck-title').textContent = dk ? dk.name : '';
  showScreen('screen-deck');
  loading(true, '단어 불러오는 중...');
  try{
    const snap = await getDocs(query(wordsCol(deckId), orderBy('createdAt','desc')));
    currentWords = [];
    snap.forEach(w=>currentWords.push({ id:w.id, ...w.data() }));
    renderWordList();
  }catch(e){ console.error(e); toast('불러오기 실패'); }
  loading(false);
  renderDeckFab();
};

function renderWordList(){
  const wrap = $('word-list');
  if(currentWords.length===0){
    wrap.innerHTML = `<div class="empty-state">
      <div class="big">✏️</div>
      <div class="msg">단어를 추가해보세요.</div>
    </div>`;
    return;
  }
  wrap.innerHTML = currentWords.map(w=>`
    <div class="word-row">
      <div>
        <div class="wt">${escapeHtml(w.term)}</div>
        <div class="wm">${escapeHtml(w.meaning)}</div>
      </div>
      <button class="icon-btn" onclick="deleteWord('${w.id}')" style="color:var(--bad);">✕</button>
    </div>
  `).join('');
}

window.deleteWord = async function(wordId){
  try{
    await deleteDoc(doc(wordsCol(currentDeckId), wordId));
    currentWords = currentWords.filter(w=>w.id!==wordId);
    renderWordList();
    toast('삭제됐어요');
  }catch(e){ console.error(e); toast('삭제 실패'); }
};

window.openDeleteDeck = async function(){
  if(!confirm('이 암기장을 통째로 삭제할까요? 안의 단어도 모두 삭제됩니다.')) return;
  loading(true, '삭제하는 중...');
  try{
    const snap = await getDocs(wordsCol(currentDeckId));
    const batch = writeBatch(db);
    snap.forEach(w=>batch.delete(w.ref));
    await batch.commit();
    await deleteDoc(doc(decksCol(), currentDeckId));
    loading(false);
    goHome();
  }catch(e){ console.error(e); loading(false); toast('삭제 실패'); }
};

function renderDeckFab(){
  let fab = document.getElementById('deck-fab');
  if(fab) fab.remove();
  fab = document.createElement('div');
  fab.className = 'fab';
  fab.id = 'deck-fab';
  const hasWords = currentWords.length > 0;
  fab.innerHTML = `
    <button class="secondary" onclick="goAddWords('${currentDeckId}')">+ 단어 추가</button>
    ${hasWords ? `<button class="primary" onclick="startStudy('${currentDeckId}')">학습 시작</button>` : ''}
  `;
  document.getElementById('app').appendChild(fab);
}

function removeStudyFab(){
  ['home-fab','deck-fab'].forEach(id=>{ const el=document.getElementById(id); if(el) el.remove(); });
}

// ================== 단어 추가 ==================
window.goAddWords = function(deckId){
  addTargetDeckId = deckId;
  pendingPreview = [];
  $('add-title').textContent = '단어 추가';
  switchAddTab('photo');
  hide('preview-wrap');
  $('text-input').value = '';
  $('photo-input').value = '';
  showScreen('screen-add');
  const fab = document.getElementById('deck-fab'); if(fab) fab.remove();
  const hfab = document.getElementById('home-fab'); if(hfab) hfab.remove();
};

window.goBackFromAdd = function(){
  if(currentDeckId) openDeck(currentDeckId); else goHome();
};

window.switchAddTab = function(tab){
  $('tab-photo').classList.toggle('active', tab==='photo');
  $('tab-text').classList.toggle('active', tab==='text');
  $('add-photo').classList.toggle('hidden', tab!=='photo');
  $('add-text').classList.toggle('hidden', tab!=='text');
};

$('photo-input').addEventListener('change', async (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const base64 = await fileToBase64(file);
  await extractFromImage(base64, file.type);
});

function fileToBase64(file){
  return new Promise((resolve,reject)=>{
    const r = new FileReader();
    r.onload = ()=>resolve(r.result.split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function extractFromImage(base64, mime){
  loading(true, 'AI가 단어를 인식하는 중...');
  const prompt = `이 이미지는 학생의 영어 단어 숙제 또는 학습 자료입니다.
이미지 안에서 "단어(또는 개념)"와 "뜻(또는 설명)" 쌍을 모두 찾아서 JSON 배열로만 반환하세요.
다른 설명, 마크다운, 코드블록 표시 없이 순수 JSON 배열만 출력하세요.
형식 예시: [{"term":"achieve","meaning":"이루다, 성취하다"},{"term":"consider","meaning":"고려하다"}]
읽기 어려운 글자는 문맥상 가장 자연스러운 단어로 추정해서 채우세요.`;

  try{
    const result = await callGemini([
      { text: prompt },
      { inline_data: { mime_type: mime||'image/jpeg', data: base64 } }
    ]);
    const items = parseJsonArray(result);
    if(!items || items.length===0){
      loading(false);
      toast('단어를 찾지 못했어요. 다시 촬영해보세요.');
      return;
    }
    pendingPreview = items.map(it=>({ id: uid(), term: (it.term||'').trim(), meaning: (it.meaning||'').trim() }))
      .filter(it=>it.term && it.meaning);
    loading(false);
    renderPreview();
  }catch(e){
    console.error(e);
    loading(false);
    toast('인식 실패. 다시 시도해주세요.');
  }
}

window.parseTextInput = function(){
  const raw = $('text-input').value.trim();
  if(!raw){ toast('내용을 입력하세요'); return; }
  const lines = raw.split('\n').map(l=>l.trim()).filter(Boolean);
  const items = [];
  for(const line of lines){
    let term, meaning;
    if(line.includes(',')){
      const idx = line.indexOf(',');
      term = line.slice(0,idx).trim();
      meaning = line.slice(idx+1).trim();
    } else {
      const idx = line.indexOf(' ');
      if(idx===-1) continue;
      term = line.slice(0,idx).trim();
      meaning = line.slice(idx+1).trim();
    }
    if(term && meaning) items.push({ id: uid(), term, meaning });
  }
  if(items.length===0){ toast('형식을 확인해주세요 (단어, 뜻)'); return; }
  pendingPreview = items;
  renderPreview();
};

function renderPreview(){
  show('preview-wrap');
  const wrap = $('preview-list');
  wrap.innerHTML = pendingPreview.map(it=>`
    <div class="preview-item" data-id="${it.id}">
      <input class="term-input" value="${escapeHtmlAttr(it.term)}" onchange="updatePreview('${it.id}','term',this.value)">
      <input class="meaning-input" value="${escapeHtmlAttr(it.meaning)}" onchange="updatePreview('${it.id}','meaning',this.value)">
      <button class="preview-del" onclick="removePreview('${it.id}')">✕</button>
    </div>
  `).join('');
}

window.updatePreview = function(id, field, value){
  const it = pendingPreview.find(p=>p.id===id);
  if(it) it[field] = value;
};

window.removePreview = function(id){
  pendingPreview = pendingPreview.filter(p=>p.id!==id);
  if(pendingPreview.length===0) hide('preview-wrap');
  else renderPreview();
};

window.saveWords = async function(){
  const valid = pendingPreview.filter(p=>p.term.trim() && p.meaning.trim());
  if(valid.length===0){ toast('저장할 단어가 없어요'); return; }
  loading(true, '저장하는 중...');
  try{
    const batch = writeBatch(db);
    for(const it of valid){
      const ref = doc(wordsCol(addTargetDeckId));
      batch.set(ref, {
        term: it.term.trim(),
        meaning: it.meaning.trim(),
        createdAt: Date.now(),
        interval: 0,
        ease: 2.3,
        nextReview: 0,
        wrongStreak: 0
      });
    }
    await batch.commit();
    loading(false);
    toast(`${valid.length}개 저장 완료`);
    pendingPreview = [];
    openDeck(addTargetDeckId);
  }catch(e){
    console.error(e); loading(false); toast('저장 실패');
  }
};

// ================== 간격반복(SM-2 간소화) ==================
// wrongStreak 기반 + 간단 간격: 0 -> 1일 -> 3일 -> 7일 -> 16일 -> 35일 ...
const INTERVALS = [0, 1, 3, 7, 16, 35, 60]; // days

function nextIntervalDays(currentIdx, correct){
  if(correct){
    const idx = Math.min(currentIdx+1, INTERVALS.length-1);
    return { idx, days: INTERVALS[idx] };
  } else {
    return { idx: 0, days: INTERVALS[0] };
  }
}

// ================== 학습 세션 ==================
window.startStudy = async function(deckId){
  currentDeckId = deckId;
  const now = Date.now();
  // 복습 대상 우선, 부족하면 새 단어로 채움
  const due = currentWords.filter(w=> !w.nextReview || w.nextReview <= now);
  const notDue = currentWords.filter(w=> w.nextReview && w.nextReview > now);
  let queue = due.slice(0, DAILY_LIMIT);
  if(queue.length < DAILY_LIMIT){
    queue = queue.concat(notDue.slice(0, DAILY_LIMIT - queue.length));
  }
  if(queue.length===0){
    toast('학습할 단어가 없어요');
    return;
  }
  studyQueue = shuffle(queue.map(w=>({...w, wasWrong:false})));
  studyIdx = 0;
  studyStats = { total: 0, correct: 0 };
  const dk = decks.find(d=>d.id===deckId);
  $('study-deck-name').textContent = dk ? dk.name : '';
  showScreen('screen-study');
  const fab = document.getElementById('deck-fab'); if(fab) fab.remove();
  showCard();
};

window.exitStudy = function(){
  openDeck(currentDeckId);
};

function shuffle(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}

function updateProgress(){
  const pct = Math.round((studyIdx/studyQueue.length)*100);
  $('progress-fill').style.width = pct+'%';
  $('study-count').textContent = `${studyIdx} / ${studyQueue.length}`;
}

function showCard(){
  if(studyIdx >= studyQueue.length){
    finishStudy();
    return;
  }
  currentCard = studyQueue[studyIdx];
  studyStage = 'flip';
  updateProgress();
  $('stage-card').classList.remove('hidden');
  $('stage-quiz').classList.add('hidden');
  $('stage-spell').classList.add('hidden');

  $('card-term').textContent = currentCard.term;
  $('card-meaning').textContent = currentCard.meaning;
  hide('card-meaning');
  show('tap-hint');
  hide('answer-row');
  const wtag = $('wrong-tag');
  if(currentCard.wasWrong) wtag.classList.remove('hidden'); else wtag.classList.add('hidden');
  const card = $('flash-card');
  card.classList.remove('flip-out');
}

$('flash-card').addEventListener('click', ()=>{
  if(studyStage!=='flip') return;
  const meaning = $('card-meaning');
  if(meaning.classList.contains('hidden')){
    meaning.classList.remove('hidden');
    hide('tap-hint');
    show('answer-row');
  }
});

window.answerCard = function(known){
  if(known){
    // 뜻 확인 단계 통과 -> 4지선다로
    goQuiz();
  } else {
    currentCard.wasWrong = true;
    goQuiz(); // 모른다고 해도 퀴즈에서 다시 기회를 줌 (재생 연습)
  }
};

function goQuiz(){
  studyStage = 'quiz';
  $('stage-card').classList.add('hidden');
  $('stage-quiz').classList.remove('hidden');

  $('quiz-q').textContent = '뜻에 맞는 단어를 고르세요';
  $('quiz-term').textContent = currentCard.meaning;

  const pool = currentWords.filter(w=>w.id!==currentCard.id).map(w=>w.term);
  const distractors = shuffle(pool).slice(0,3);
  const options = shuffle([currentCard.term, ...distractors]);

  const wrap = $('quiz-options');
  wrap.innerHTML = '';
  options.forEach(opt=>{
    const btn = document.createElement('button');
    btn.className = 'quiz-opt';
    btn.textContent = opt;
    btn.onclick = ()=>selectQuizOption(btn, opt, options);
    wrap.appendChild(btn);
  });
}

function selectQuizOption(btn, opt, allOptions){
  const buttons = Array.from($('quiz-options').children);
  buttons.forEach(b=>b.disabled = true);
  const isCorrect = opt === currentCard.term;
  if(isCorrect){
    btn.classList.add('correct');
  } else {
    btn.classList.add('wrong');
    currentCard.wasWrong = true;
    buttons.find(b=>b.textContent===currentCard.term)?.classList.add('correct');
  }
  setTimeout(()=>{ goSpell(); }, 700);
}

function goSpell(){
  studyStage = 'spell';
  $('stage-quiz').classList.add('hidden');
  $('stage-spell').classList.remove('hidden');
  $('spell-meaning').textContent = currentCard.meaning;
  const input = $('spell-input');
  input.value = '';
  input.className = 'spell-input';
  $('spell-answer').textContent = '';
  $('spell-submit').textContent = '확인';
  $('spell-submit').onclick = submitSpell;
  setTimeout(()=>input.focus(), 100);
}

$('spell-input').addEventListener('keydown', (e)=>{
  if(e.key==='Enter') submitSpell();
});

window.submitSpell = function(){
  const input = $('spell-input');
  if(input.disabled) return;
  const val = input.value.trim().toLowerCase();
  const answer = currentCard.term.trim().toLowerCase();
  const correct = val === answer;
  input.disabled = true;
  if(correct){
    input.className = 'spell-input correct';
    studyStats.correct++;
  } else {
    input.className = 'spell-input wrong';
    currentCard.wasWrong = true;
    $('spell-answer').textContent = `정답: ${currentCard.term}`;
  }
  studyStats.total++;
  $('spell-submit').textContent = '다음';
  $('spell-submit').onclick = ()=>{
    updateCardSchedule(!currentCard.wasWrong);
    studyIdx++;
    showCard();
  };
};

async function updateCardSchedule(correct){
  try{
    const currentIntervalIdx = INTERVALS.indexOf(currentCard.interval ? currentCard.interval : 0);
    const baseIdx = currentIntervalIdx===-1 ? 0 : currentIntervalIdx;
    const { idx, days } = nextIntervalDays(baseIdx, correct);
    const nextReview = Date.now() + days*24*60*60*1000;
    await updateDoc(doc(wordsCol(currentDeckId), currentCard.id), {
      interval: days,
      nextReview,
      wrongStreak: correct ? 0 : (currentCard.wrongStreak||0)+1
    });
  }catch(e){ console.error(e); }
}

function finishStudy(){
  showScreen('screen-done');
  $('done-total').textContent = studyStats.total;
  $('done-correct').textContent = studyStats.correct;
  $('done-sub').textContent = `${currentDeckId ? (decks.find(d=>d.id===currentDeckId)?.name||'') : ''} 학습을 마쳤어요`;
}

// ================== Gemini API 호출 ==================
async function callGemini(parts, retry=0){
  const model = GEMINI_MODELS[geminiIdx % GEMINI_MODELS.length];
  geminiIdx++;
  try{
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'x-goog-api-key': GEMINI_KEY },
      body: JSON.stringify({ contents:[{ parts }] })
    });
    const data = await res.json();
    if(data.error){
      console.warn(model, data.error.message);
      if(retry < GEMINI_MODELS.length-1) return callGemini(parts, retry+1);
      throw new Error(data.error.message);
    }
    const text = data?.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('') || '';
    return text;
  }catch(e){
    if(retry < GEMINI_MODELS.length-1) return callGemini(parts, retry+1);
    throw e;
  }
}

function parseJsonArray(text){
  try{
    const cleaned = text.replace(/```json/g,'').replace(/```/g,'').trim();
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if(start===-1 || end===-1) return null;
    return JSON.parse(cleaned.slice(start, end+1));
  }catch(e){
    console.error('parse fail', e);
    return null;
  }
}

// ================== escape ==================
function escapeHtml(str){
  return String(str||'').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function escapeHtmlAttr(str){ return escapeHtml(str); }

// ================== 초기화 ==================
goHome();
