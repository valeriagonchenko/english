/* Word Cottage — original vanilla-JS mini game. Static hosting; optional Firebase multiplayer. */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const WORDS = window.WORDS, WORD_BY_ID = Object.fromEntries(WORDS.map(w => [w.id,w]));
const TODAY = () => new Date().toLocaleDateString('en-CA');
const nextDate = (days) => {let d=new Date();d.setDate(d.getDate()+days);return d.toLocaleDateString('en-CA')};
const DEMO_KEY = 'word-cottage-local-v2';
const SHOP = [
 {id:'lantern',emoji:'🏮',name:'Фонарик у домика',price:30,desc:'Для тёплых вечеров'},
 {id:'flowers',emoji:'🪴',name:'Горшок с цветами',price:25,desc:'На уютное крыльцо'},
 {id:'birdhouse',emoji:'🐦',name:'Домик для птиц',price:40,desc:'Для маленьких гостей'},
 {id:'mushrooms',emoji:'🍄',name:'Лесные грибочки',price:35,desc:'Украшение сада'},
 {id:'lights',emoji:'✨',name:'Огоньки на крыше',price:65,desc:'Настоящее волшебство'},
 {id:'ball',emoji:'🧶',name:'Клубок для котика',price:20,desc:'Любимая игрушка'}
];
let room=null, myId=null, online=false, firebaseReady=false, fb=null, unsubscribe=null, roomId='', lastSave='local', currentMode='create', chosenLevel='A0', activeModal=null, quiz=null, wrongThisQuestion=false, toastTimeout=null;
const small = s => String(s??'');
const esc = s => small(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const pad = n=>String(n).padStart(2,'0');
const shuffle = (arr, seed) => {let a=[...arr], s=seed>>>0;for(let i=a.length-1;i>0;i--){s=(s*1664525+1013904223)>>>0;let j=s%(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;};
const hash = s => {let h=2166136261;for(const c of s){h=Math.imul(h ^ c.charCodeAt(0),16777619);}return h>>>0;};
const uid = () => crypto?.randomUUID?.() || 'id'+Date.now().toString(36)+Math.random().toString(36).slice(2);
function player(name,level){return {name:name.trim().slice(0,18)||'Садовод',level,dailyDate:'',dailyDone:0,dailyIds:[],completedIds:[],knownIds:[],reviews:{},sentDate:''};}
function newRoom(code, owner, name, level, local=false){let players={[owner]:player(name,level)};if(local)players['local-b']=player('Друг',level==='A0'?'A2':'A0');return {code,owner,guest:local?'local-b':null,players,coins:0,plants:Array.from({length:6},()=>({wordId:null,stage:0})),pet:{name:'Печенька',mood:'idle'},decor:[],gifts:[],updatedAt:Date.now()};}
function me(){return room?.players?.[myId]}
function partnerId(){return Object.keys(room?.players||{}).find(id=>id!==myId)||null}
function isDemo(){return !online}
function normalizeRoom(r){if(!r)return r;r.plants??=Array.from({length:6},()=>({wordId:null,stage:0}));r.decor??=[];r.gifts??=[];r.pet??={name:'Печенька',mood:'idle'};return r}
function saveLocal(){localStorage.setItem(DEMO_KEY,JSON.stringify({room,myId}));lastSave='local';}
function status(msg){$('saveStatus').textContent=msg||(!online?'● Локальное сохранение':'● Сохранено в облаке')}
async function mutate(change){if(!room)return false;
 if(!online){let copy=structuredClone(room);let done=change(copy);if(done===false)return false;room=normalizeRoom(copy);room.updatedAt=Date.now();saveLocal();render();return true;}
 try{let next=null;const committed=await fb.runTransaction(fb.db,async trx=>{let snap=await trx.get(fb.doc(fb.db,'rooms',roomId));if(!snap.exists())throw new Error('Комната не найдена');let draft=normalizeRoom(structuredClone(snap.data()));if(change(draft)===false)return false;draft.updatedAt=Date.now();trx.set(fb.doc(fb.db,'rooms',roomId),draft);next=draft;return true;});if(committed){room=next;render();}return committed;}catch(err){console.error(err);toast('Не удалось сохранить: '+(err.code==='permission-denied'?'нет доступа':err.message));return false;}
}
function getDailyIds(p, id){const date=TODAY(), known=new Set(p.knownIds||[]), all=shuffle(WORDS,hash(id+date));const due=all.filter(w=>known.has(w.id)&&(p.reviews[w.id]?.nextReview||'')<=date).sort((a,b)=>(p.reviews[a.id]?.nextReview||'').localeCompare(p.reviews[b.id]?.nextReview||''));const fresh=all.filter(w=>!known.has(w.id));const other=all.filter(w=>known.has(w.id)&&!due.includes(w));return [...due,...fresh,...other].slice(0,5).map(w=>w.id);}
async function ensureDaily(){const p=me();if(!p)return;let t=TODAY();if(p.dailyDate!==t||!Array.isArray(p.dailyIds)||p.dailyIds.length!==5){await mutate(r=>{const q=r.players[myId];if(q.dailyDate===t&&q.dailyIds?.length===5)return false;q.dailyIds=getDailyIds(q,myId);q.dailyDate=t;q.dailyDone=0;q.completedIds=[];});}}
function speak(word){try{if(!('speechSynthesis'in window)){toast('Произношение недоступно в браузере');return}speechSynthesis.cancel();let utter=new SpeechSynthesisUtterance(word);utter.lang='en-US';utter.rate=.82;speechSynthesis.speak(utter);}catch(e){toast('Не удалось воспроизвести слово')}}
function toast(message){const t=$('toast');t.textContent=message;t.classList.add('show');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>t.classList.remove('show'),3000)}
function showModal(title,eyebrow,html,type){activeModal=type;$('modalTitle').textContent=title;$('modalEyebrow').textContent=eyebrow;$('modalBody').innerHTML=html;$('modalOverlay').classList.remove('hidden');}
function closeModal(){$('modalOverlay').classList.add('hidden');activeModal=null;quiz=null;}
function showOnboarding(){$('onboarding').classList.remove('hidden');$('playerName').value='';$('modeDescription').textContent=firebaseReady?'Общий мир будет доступен вам обоим по коду.':'Локальная демоверсия: прогресс сохраняется только в этом браузере. Для двух устройств подключи Firebase по README.';switchEntryTab('create')}
function switchEntryTab(mode){currentMode=mode;document.querySelectorAll('.mode-tab').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));$('joinCodeRow').hidden=mode!=='join';$('startButton').textContent=mode==='create'?'Создать уютный мир ✨':'Присоединиться к миру 🌷';if(mode==='join'&&!firebaseReady)$('modeDescription').textContent='Для игры по коду нужно настроить Firebase. Пока доступна локальная демоверсия.';else $('modeDescription').textContent=firebaseReady?'Вы сможете играть вдвоём с разных устройств.':'Деморежим: прогресс сохраняется только на этом устройстве.';}
function getCode(){const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';const a=new Uint32Array(7);if(window.crypto?.getRandomValues)crypto.getRandomValues(a);else a.forEach((_,i)=>a[i]=Math.random()*0xFFFFFFFF);return [...a].map(n=>alphabet[n%alphabet.length]).join('')}
async function startGame(){const name=$('playerName').value.trim();if(!name){toast('Сначала напиши своё имя');$('playerName').focus();return;}const button=$('startButton');button.disabled=true;try{
 if(currentMode==='join'){
  if(!firebaseReady){toast('Подключи Firebase, чтобы играть вдвоём');return}
  const code=$('joinCode').value.trim().toUpperCase().replace(/\s/g,'');if(!/^[A-Z2-9]{7}$/.test(code)){toast('Введи семизначный код комнаты');return}
  const ref=fb.doc(fb.db,'rooms',code);
  // Guest cannot read the room before becoming a member. Rules permit ONLY the atomic join update.
  try{await fb.updateDoc(ref,{guest:myId,['players.'+myId]:player(name,chosenLevel),updatedAt:Date.now()});}
  catch(err){if(err.code==='permission-denied'){toast('Комната не найдена, уже занята или доступ запрещён');return}throw err}
  roomId=code;online=true;localStorage.setItem('word-cottage-room-code',code);subscribe();
 }else if(firebaseReady){const code=getCode();roomId=code;online=true;await fb.setDoc(fb.doc(fb.db,'rooms',code),newRoom(code,myId,name,chosenLevel));localStorage.setItem('word-cottage-room-code',code);subscribe();}
 else{myId='local-a';roomId='DEMO';room=newRoom('DEMO',myId,name,chosenLevel,true);online=false;saveLocal();render();}
 $('onboarding').classList.add('hidden');toast('Добро пожаловать домой, '+name+'!');
 }catch(e){console.error(e);toast('Ошибка подключения: '+e.message);online=false;}finally{button.disabled=false;}}
function subscribe(){if(unsubscribe)unsubscribe();status('◌ Подключаемся…');unsubscribe=fb.onSnapshot(fb.doc(fb.db,'rooms',roomId),snap=>{if(!snap.exists()){toast('Мир не найден');return}room=normalizeRoom(snap.data());status('● Синхронизировано');render();},err=>{console.error(err);status('● Нет связи');toast('Синхронизация временно недоступна')});}
async function initFirebase(){const cfg=window.WORD_COTTAGE_FIREBASE_CONFIG;if(!cfg?.apiKey||!cfg?.projectId)return;
 try{const [appM,authM,fsM]=await Promise.all([import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js'),import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js'),import('https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js')]);let app=appM.initializeApp(cfg),auth=authM.getAuth(app),db=fsM.getFirestore(app);await authM.signInAnonymously(auth);myId=auth.currentUser.uid;fb={db,doc:fsM.doc,setDoc:fsM.setDoc,updateDoc:fsM.updateDoc,onSnapshot:fsM.onSnapshot,runTransaction:fsM.runTransaction};firebaseReady=true;status('● Firebase подключён');
 const previous=localStorage.getItem('word-cottage-room-code');if(previous){try{const snap=await fsM.getDoc(fsM.doc(db,'rooms',previous));if(snap.exists()&&(snap.data().owner===myId||snap.data().guest===myId)){roomId=previous;online=true;subscribe();$('onboarding').classList.add('hidden');return}}catch(e){console.debug('Old room not accessible',e)}}
 }catch(e){console.error('Firebase init failed',e);firebaseReady=false;status('● Firebase недоступен');}}
function render(){if(!room)return;normalizeRoom(room);const p=me();if(!p)return;$('coinCount').textContent=(room.coins||0).toLocaleString('ru-RU');$('roomCodeDisplay').textContent=online?'КОМНАТА '+roomId:'ЛОКАЛЬНЫЙ МИР';$('roomCodeDisplay').title=online?'Нажми, чтобы скопировать код':'Демо без синхронизации';$('playersSection').innerHTML=Object.entries(room.players).map(([id,q],i)=>`<div class="player-card ${id===myId?'me':''}"><div class="player-avatar">${i===0?'🧑‍🌾':'👩‍🌾'}</div><div class="player-content"><div class="player-title"><strong>${esc(q.name)} ${id===myId?'(ты)':''}</strong><span class="player-level">${q.level==='A0'?'A0':'A2–B1'}</span></div><div class="player-meta">Сегодня ${q.dailyDate===TODAY()?q.dailyDone:0}/5 заданий</div><div class="progress-track"><span style="width:${(q.dailyDate===TODAY()?q.dailyDone:0)*20}%"></span></div></div>${!online&&id!==myId?`<button class="player-swap" data-switch="${esc(id)}">Играть →</button>`:''}</div>`).join('')+(Object.keys(room.players).length===1?'<div class="player-card"><div class="player-avatar">💌</div><div class="player-content"><strong>Место для друга</strong><div class="player-meta">Поделись кодом приглашения</div></div></div>':'');
 const giftCount=room.gifts.filter(g=>g.to===myId&&!g.done).length;$('giftDot').hidden=!giftCount;
 $('learnButton').querySelector('small').textContent=p.dailyDate===TODAY()&&p.dailyDone===5?'На сегодня всё!':'5 минут для себя';
 drawScene();}
function drawScene(){const canvas=$('scene'),ctx=canvas.getContext('2d');if(!ctx)return;ctx.imageSmoothingEnabled=false;const R=(x,y,w,h,c)=>{ctx.fillStyle=c;ctx.fillRect(x,y,w,h)},line=(pts,c)=>{ctx.fillStyle=c;pts.forEach(([x,y,w,h])=>ctx.fillRect(x,y,w,h))};
 // Pixel countryside
 R(0,0,480,260,'#a4d0cf');R(0,0,480,92,'#b8dddd');R(0,15,480,30,'#b2dad7');
 const cloud=(x,y)=>{R(x+10,y,48,11,'#f8f6df');R(x+18,y-9,28,10,'#fff8ec');R(x,y+9,76,9,'#f7f4e4');R(x+17,y+18,42,4,'#d0e9de')};cloud(20,29);cloud(343,20);cloud(241,57);
 line([[0,128,54,25],[33,115,68,38],[91,130,65,26],[150,118,85,40],[224,130,65,30],[284,106,95,50],[375,116,105,45]],'#86b7a7');line([[0,153,480,107]],'#9bc189');R(0,175,480,85,'#92ba7c');R(0,218,480,42,'#86b374');
 // Ground texture / wild flowers
 for(let i=0;i<70;i++){let x=(i*103+23)%480,y=160+(i*43)%93;R(x,y,4,2,i%3===0?'#7eaf6b':'#a9cd89');if(i%8===0){R(x,y-3,3,3,i%2?'#fff1c4':'#fff4e6');R(x+1,y-1,2,2,'#e4be67')}}
 // Distant trees
 const tree=(x,y)=>{R(x+17,y+39,12,60,'#876d4e');R(x+8,y+19,31,35,'#629b73');R(x,y+30,50,29,'#659b70');R(x+13,y,25,27,'#75a980');R(x+5,y+20,38,8,'#76ac7e');R(x+13,y+33,5,5,'#8abd88')};tree(-10,90);tree(438,92);
 // Fence behind scene
 for(let i=0;i<22;i++){let x=i*23;R(x,170,6,27,'#ead5a7');R(x+1,167,4,5,'#f4e4ba')}R(0,176,480,5,'#dfc99d');R(0,190,480,5,'#dcc397');
 // Cottage shadow
 R(40,211,180,12,'#729868');R(61,110,136,99,'#efe0bb');R(68,119,123,89,'#f7e6bf');R(61,202,137,10,'#b18a67');
 // Chimney
 R(151,65,25,43,'#b67764');R(148,61,31,8,'#8e594f');R(155,72,6,10,'#d89b7a');R(168,84,5,9,'#d89b7a');
 // Stepped roof pixel silhouette
 for(let step=0;step<12;step++){let x=34+step*8,y=117-step*6;R(x,y,166-step*14,8,'#885e58');R(x,y+6,166-step*14,4,'#ad7364')}
 // roof main triangles fill alternate algorithm
 for(let i=0;i<13;i++){let x=36+i*7,y=114-i*5;R(x,y,164-i*14,7,i%3?'#ac7162':'#985e58')}
 R(96,54,22,8,'#b77b67');R(91,62,32,5,'#aa6c5c');
 // Roof edging
 R(31,113,173,9,'#794e4a');R(35,122,164,6,'#b47764');
 // Windows
 R(79,145,37,35,'#996d55');R(83,149,29,27,'#fce3a2');R(96,149,4,27,'#ad7b5c');R(83,159,29,4,'#ad7b5c');R(79,176,37,6,'#e6c29a');R(153,145,27,37,'#996d55');R(157,149,19,28,'#b8d7bb');R(165,149,3,28,'#9a7c5e');R(157,164,19,4,'#9a7c5e');
 // Door
 R(121,162,26,48,'#8b6451');R(126,166,17,44,'#a4765f');R(138,187,4,4,'#f7cd72');R(118,208,35,6,'#cba17b');
 // flowers by windows
 R(77,185,42,7,'#bd8466');R(79,182,38,4,'#fff2bc');for(let i=0;i<4;i++){R(82+i*9,172,3,12,'#6b9e60');R(79+i*9,168,9,8,i%2?'#edacac':'#fff1ad')}
 // Walkway
 const stones=[[132,221,41,15],[151,239,49,16],[183,254,39,12]];stones.forEach(([x,y,w,h])=>{R(x,y,w,h,'#d9c29d');R(x+3,y+2,w-6,h-5,'#ecdaba')});
 // The garden plots (3 x 2)
 const beds=room?.plants||[];beds.forEach((p,i)=>{let x=329+(i%3)*47,y=174+Math.floor(i/3)*40;R(x-4,y+22,42,13,'#8b684c');R(x,y+19,35,10,'#a67755');R(x+2,y+22,31,5,'#71563c');R(x-5,y+19,45,3,'#d9b287');
 if(p.wordId){const stage=p.stage??0;if(stage===0){R(x+14,y+13,7,5,'#594b37');R(x+16,y+12,4,3,'#e0c78b');}else if(stage===1){R(x+16,y+1,4,19,'#507d4e');R(x+9,y+5,10,7,'#5f9c63');R(x+20,y+9,10,7,'#70a874');R(x+15,y-3,6,8,'#82b77b');}else{R(x+17,y-4,4,24,'#42794a');R(x+8,y+9,11,7,'#639969');R(x+20,y+5,11,7,'#77ac77');let petal=['#ffe1a2','#f4aeb6','#d8c6ee','#fff6bd','#fad4a3','#f3c6d1'][i];R(x+13,y-14,12,17,petal);R(x+8,y-9,22,8,petal);R(x+17,y-17,5,23,petal);R(x+17,y-8,5,5,'#e0a859');}}else{R(x+13,y+14,8,4,'#634f3a');R(x+15,y+12,4,3,'#bca174');}});
 // Kitty body
 const px=265,py=189, fur='#d9a17b',dark='#9f6856';R(px+5,py+12,31,24,fur);R(px+31,py+18,12,13,fur);R(px+40,py+11,7,16,fur);R(px+43,py+3,6,15,dark);R(px+1,py-4,33,25,fur);R(px+2,py-11,10,14,fur);R(px+24,py-11,10,14,fur);R(px+5,py-8,6,7,'#eabbad');R(px+26,py-8,6,7,'#eabbad');R(px+6,py+5,5,5,'#503b35');R(px+24,py+5,5,5,'#503b35');R(px+16,py+10,4,3,'#ab6768');R(px+12,py+17,13,2,'#fbe0c6');R(px+7,py+32,10,9,fur);R(px+24,py+32,10,9,fur);R(px+6,py+40,13,3,dark);R(px+23,py+40,13,3,dark);
 // Shop decorations: persistent scene objects
 const has=id=>room?.decor?.includes(id);
 if(has('lantern')){R(226,146,4,58,'#776b52');R(215,143,27,4,'#665944');R(222,154,17,22,'#eecc75');R(225,157,11,16,'#f8e6a8');R(227,176,7,4,'#745642')}
 if(has('flowers')){R(195,194,22,17,'#bd7961');R(198,189,16,5,'#dd9d75');for(let i=0;i<3;i++){R(201+i*5,183,2,11,'#548559');R(199+i*6,180,7,6,i%2?'#fff2b5':'#eab1ab')}}
 if(has('birdhouse')){R(443,139,4,38,'#8e785d');R(436,139,18,17,'#f2dab2');R(433,136,24,5,'#bd7e63');R(441,145,7,7,'#856045')}
 if(has('mushrooms')){R(311,230,5,11,'#fff5da');R(300,234,5,9,'#fff5da');R(305,225,16,8,'#d9827b');R(295,230,16,8,'#be6f65');R(311,228,3,3,'#f9dcc3')}
 if(has('lights'))for(let i=0;i<11;i++){let x=48+i*14,y=111-Math.max(0,6-Math.abs(i-5))*5;R(x,y,5,5,i%3===0?'#ffe4a5':i%3===1?'#ffb5a3':'#e4e69b')}
 if(has('ball')){R(302,235,12,12,'#aa9dca');R(305,233,6,3,'#d7c4e9');R(306,238,3,9,'#e4cbdc')}
 if(room?.pet?.mood==='happy'){R(295,173,9,8,'#f2a9af');R(294,170,5,5,'#f4c0ba');R(302,170,5,5,'#f4c0ba')}
 if(room?.pet?.mood==='sleepy'){ctx.font='bold 12px monospace';ctx.fillStyle='#5f7d76';ctx.fillText('z z',298,177)}
}
function chooseDistractors(w,n=2){const pool=WORDS.filter(x=>x.id!==w.id&&(x.topic===w.topic||n===3));let a=shuffle(pool,hash(w.id+TODAY()));return a.slice(0,n)}
function startQuiz(kind='daily',giftId=null){const p=me();if(!p)return;if(kind==='daily'&&p.dailyDone>=5){showComplete();return}let index=kind==='daily'?p.dailyDone:0;let id=kind==='daily'?p.dailyIds[index]:room.gifts.find(g=>g.id===giftId)?.wordId;if(!id)return;quiz={kind,giftId,index,wordId:id,mode: p.level==='A0'?index%3: index%3,selected:[],locked:false};wrongThisQuestion=false;renderQuiz();}
function quizData(){const q=quiz,w=WORD_BY_ID[q.wordId],p=me(),A0=p.level==='A0',mode=q.mode;let sentence=w.sentence.replace(/[.!?]$/,'');let words=sentence.split(/\s+/);let choices,question,highlight=w.en;
 if(A0){if(mode===0){question='Выбери правильный перевод';choices=shuffle([w,...chooseDistractors(w)],hash(w.id+'r')).map(x=>({value:x.id,label:x.ru}));}
 else if(mode===1){question='Какая картинка означает это слово?';choices=shuffle([w,...chooseDistractors(w)],hash(w.id+'p')).map(x=>({value:x.id,label:`${x.emoji}  ${x.ru}`}));}
 else{question='Собери английское слово из букв';choices=null;}}
 else{if(mode===0){question='Какое слово пропущено в предложении?';choices=shuffle([w,...chooseDistractors(w)],hash(w.id+'c')).map(x=>({value:x.id,label:x.en}));highlight=sentence.replace(new RegExp('\\b'+w.en+'\\b','i'),'______');}
 else if(mode===1){question='Собери английское предложение в правильном порядке';choices=null;highlight='«'+w.ru+'»';}
 else{question=`Какое предложение содержит слово «${w.ru}»?`;choices=shuffle([w,...chooseDistractors(w)],hash(w.id+'s')).map(x=>({value:x.id,label:x.sentence}));highlight='Выбери подходящий контекст';}}
 return {w,p,A0,mode,choices,question,highlight,words,sentence};}
function renderQuiz(){if(!quiz)return;const {w,p,A0,mode,choices,question,highlight,words}=quizData();let total=quiz.kind==='daily'?5:1,done=quiz.kind==='daily'?p.dailyDone:0;
 let markup=`<div class="quiz-progress"><strong>${quiz.kind==='gift'?'💌 Слово-подарок':'Задание '+(done+1)+' из 5'}</strong><span>Уровень ${p.level==='A0'?'A0':'A2–B1'} · +${quiz.kind==='daily'?'10':'0'} 🪙</span></div><div class="progress-track large"><span style="width:${done/total*100}%"></span></div><div class="quiz-card"><div class="word-emoji">${esc(w.emoji)}</div><p class="quiz-question">${esc(question)}</p><div class="quiz-word">${esc(highlight)}</div>${mode!==1&&A0?`<button class="soft-btn" data-action="speak" data-text="${esc(w.en)}">🔊 Послушать</button>`:''}</div>`;
 if(choices){markup+=`<div class="answer-list">${choices.map(c=>`<button class="answer-btn" data-action="answer" data-value="${esc(c.value)}">${esc(c.label)}</button>`).join('')}</div>`;}
 else{const letters=A0?w.en.split(''):words;const scrambled=shuffle(letters.map((v,i)=>({value:v,index:i})),hash(w.id+TODAY()+p.level));const chosen=new Set(quiz.selected);markup+=`<div class="sentence-slots">${quiz.selected.map((ix,j)=>`<button class="chip" data-action="remove-token" data-index="${j}">${esc(letters[ix])} ×</button>`).join('')||'<span class="small-muted">Нажимай на буквы или слова ниже…</span>'}</div><div class="chip-list">${scrambled.map(t=>`<button class="chip" data-action="add-token" data-index="${t.index}" ${chosen.has(t.index)?'disabled':''}>${esc(t.value)}</button>`).join('')}</div><div class="modal-actions"><button class="soft-btn" data-action="clear-tokens">Сбросить</button><button class="primary-btn" data-action="check-tokens" ${quiz.selected.length===letters.length?'':'disabled'}>Проверить →</button></div>`;}
 if(quiz.locked)markup+=quizFeedback(wrongThisQuestion);
 showModal(quiz.kind==='gift'?'Тебе подарили слово 💌':'Немного английского 📖',quiz.kind==='gift'?'ОТ ДРУГА': 'ТВОИ 5 МИНУТ',markup,'quiz');}
function quizFeedback(wrong){return `<div class="feedback ${wrong?'error':''}">${wrong?'Пока не получилось. Правильный ответ: <b>'+esc(WORD_BY_ID[quiz.wordId].en)+'</b>. Попробуй ещё раз!':'Верно! Продолжай в том же духе.'}</div><button class="primary-btn" data-action="retry">Попробовать ещё раз</button>`;}
async function checkQuizAnswer(correct){if(!quiz||quiz.locked)return;if(!correct){quiz.locked=true;wrongThisQuestion=true;await mutate(r=>{let p=r.players[myId];let v=p.reviews[quiz.wordId]||{correct:0};p.reviews[quiz.wordId]={...v,nextReview:nextDate(1),missed:true};});renderQuiz();return;}
 const q={...quiz};quiz.locked=true;
 const saved=await mutate(r=>{let p=r.players[myId],wid=q.wordId;
  if(q.kind==='daily'){
   if(p.dailyDate!==TODAY()||p.completedIds.includes(wid)||p.dailyDone>=5)return false;
   p.dailyDone++;p.completedIds.push(wid);r.coins+=10;
  }else{const gift=r.gifts.find(g=>g.id===q.giftId);if(!gift||gift.to!==myId||gift.done)return false;gift.done=true;gift.doneAt=Date.now();}
  if(!p.knownIds.includes(wid))p.knownIds.push(wid);
  const prev=p.reviews[wid]||{correct:0};const count=prev.missed?1:(prev.correct||0)+1;
  p.reviews[wid]={correct:count,nextReview:nextDate(count<=1?1:count===2?3:7),missed:false};
  let plot=r.plants.find(b=>b.wordId===wid);if(plot){plot.stage=Math.min(2,(plot.stage||0)+1)}else{plot=r.plants.find(b=>!b.wordId);if(plot){plot.wordId=wid;plot.stage=0}}
  r.pet.mood='happy';return true;
 });
 if(!saved){quiz=null;showLearn();return}
 const p=me();if(q.kind==='gift'){quiz=null;showGifts();toast('Подарок получен! 💌');return}
 if(p.dailyDone>=5){quiz=null;showComplete();return}quiz={kind:'daily',giftId:null,index:p.dailyDone,wordId:p.dailyIds[p.dailyDone],mode:p.level==='A0'?p.dailyDone%3:p.dailyDone%3,selected:[],locked:false};wrongThisQuestion=false;renderQuiz();toast('+10 монет и новое слово! 🌱');}
function handleAnswer(value){if(!quiz)return;checkQuizAnswer(value===quiz.wordId);}
function handleTokens(){if(!quiz)return;const d=quizData();const tokens=d.A0?d.w.en.split(''):d.words;let answer=quiz.selected.map(i=>tokens[i]).join(d.A0?'':' ');let expected=tokens.join(d.A0?'':' ');checkQuizAnswer(answer===expected);}
async function showLearn(){await ensureDaily();if(!me())return;startQuiz('daily');}
function showComplete(){showModal('На сегодня всё! 🌟','ОТЛИЧНАЯ РАБОТА',`<div class="pet-preview">🌷 🐈 🌷<p>Все 5 упражнений завершены.</p></div><p style="text-align:center">Ты заработал(а) <strong>50 общих монет</strong>. Завтра тебя будут ждать новые слова и повторения. Никаких штрафов за пропуски!</p><div class="modal-actions"><button class="soft-btn" data-action="garden">Посмотреть сад</button><button class="primary-btn" data-action="close">К домику</button></div>`,'complete');}
function showGarden(){let content=`<p class="small-muted">У каждого слова три стадии роста: семечко → росток → цветок. Повторяй слова, чтобы помочь растениям цвести. Нажми на грядку для подробностей.</p><div class="garden-grid">${room.plants.map((plot,i)=>{let w=WORD_BY_ID[plot.wordId],visual=!w?'🟤':plot.stage===0?'🌰':plot.stage===1?'🌱':'🌼';return `<button class="plant-tile" data-action="plot" data-index="${i}"><div class="plant-visual">${visual}</div><strong>${w?esc(w.en):'Свободно'}</strong><small>${w?['Семечко','Росток','Цветок'][plot.stage]:'Грядка '+(i+1)}</small></button>`}).join('')}</div><p class="muted-note">Изучено слов: ${me()?.knownIds.length||0} из ${WORDS.length}. На грядках — любимые слова двух игроков.</p>`;showModal('Сад слов 🌱','ТВОИ МАЛЕНЬКИЕ ПОБЕДЫ',content,'garden');}
function showPlot(index){let b=room.plants[index],w=WORD_BY_ID[b.wordId];let members=Object.values(room.players);let dates=members.map(p=>p.reviews[b.wordId]?.nextReview).filter(Boolean).sort();let known=[...new Set(members.flatMap(p=>p.knownIds||[]))].map(id=>WORD_BY_ID[id]).filter(Boolean);let content=w?`<div class="quiz-card"><div class="word-emoji">${w.emoji}</div><div class="quiz-word">${esc(w.en)}</div><p>${esc(w.ru)}</p><p class="small-muted">${esc(w.sentence)}</p><button class="soft-btn" data-action="speak" data-text="${esc(w.en)}">🔊 Произнести</button></div><p class="small-muted">Рост: <b>${['семечко','росток','цветок'][b.stage]}</b>${dates.length?' · следующее повторение: '+esc(dates[0]):''}</p>`:`<p class="small-muted">Эта грядка пока свободна. Здесь можно посадить любое уже изученное слово.</p>`;
 content+=`<p><b>${w?'Пересадить другое слово':'Выбери слово для посадки'}</b></p><div class="chip-list">${known.slice(0,40).map(x=>`<button class="chip" data-action="replant" data-index="${index}" data-word="${x.id}">${x.emoji} ${esc(x.en)}</button>`).join('')||'<span class="small-muted">Сначала выучи хотя бы одно слово!</span>'}</div><div class="modal-actions"><button class="soft-btn" data-action="garden">← Назад в сад</button></div>`;
 showModal('Грядка '+(index+1),'НАШИ СЛОВА',content,'plot');}
async function replant(index,id){if(!WORD_BY_ID[id])return;const result=await mutate(r=>{if(!Object.values(r.players).some(p=>p.knownIds.includes(id)))return false;for(let i=0;i<r.plants.length;i++){if(i!==index&&r.plants[i].wordId===id){r.plants[i]={wordId:null,stage:0}}}r.plants[index]={wordId:id,stage:0};});if(result){showPlot(index);toast('Слово посажено 🌱')}}
function showPet(){const done=room.decor||[];let mood=room.pet.mood;let content=`<div class="pet-preview">${mood==='sleepy'?'😽':mood==='happy'?'😻':'🐈'}<p><strong>${esc(room.pet.name)}</strong> · ${mood==='happy'?'Радуется':mood==='sleepy'?'Дремлет':'В хорошем настроении'}</p></div><div class="modal-actions"><button class="soft-btn" data-action="pet">💗 Погладить</button><button class="soft-btn" data-action="sleep">💤 Уложить спать</button></div><p><b>Как зовут питомца?</b></p><div class="inline-row"><input class="field-input" id="petName" maxlength="16" value="${esc(room.pet.name)}" aria-label="Имя котика"><button class="soft-btn" data-action="rename">Сохранить</button></div><div class="divider"></div><p><strong>Маленький магазин</strong> · ${room.coins} 🪙</p><div class="shop-list">${SHOP.map(i=>`<div class="shop-item"><span class="shop-icon">${i.emoji}</span><div class="shop-info"><strong>${esc(i.name)}</strong><small>${esc(i.desc)}</small></div><button data-action="buy" data-id="${i.id}" ${done.includes(i.id)||room.coins<i.price?'disabled':''}>${done.includes(i.id)?'Куплено ✓':i.price+' 🪙'}</button></div>`).join('')}</div>`;showModal('Наш питомец 🐈','УЮТ И МАЛЕНЬКИЕ РАДОСТИ',content,'pet');}
async function shopBuy(id){let item=SHOP.find(x=>x.id===id);if(!item)return;let ok=await mutate(r=>{if(r.decor.includes(id)||r.coins<item.price)return false;r.coins-=item.price;r.decor.push(id);return true});if(ok){showPet();toast('Теперь у вас есть '+item.name.toLowerCase()+'!')}}
async function updatePet(mood){await mutate(r=>{r.pet.mood=mood});showPet();toast(mood==='happy'?'Мур-р-р! 💗':'Сладких снов 💤')}
async function renamePet(){let name=$('petName')?.value?.trim();if(!name){toast('Как же зовут котика?');return}await mutate(r=>{r.pet.name=name.slice(0,16)});showPet();toast('Котик откликается на новое имя!')}
function showGifts(){let gifts=room.gifts.filter(g=>g.to===myId), sent=room.gifts.find(g=>g.from===myId&&g.date===TODAY()),p=me(),other=partnerId();let learned=(p?.knownIds||[]).map(id=>WORD_BY_ID[id]).filter(Boolean);let html=`<p class="small-muted">Один раз в день можно подарить другу изученное слово. Друг решит задание своего уровня — и подарок раскроется. 🎁</p>`;
 const pending=gifts.filter(g=>!g.done);if(pending.length){html+=`<p><b>Для тебя</b></p>${pending.map(g=>`<div class="gift-card"><strong>💌 От ${esc(room.players[g.from]?.name||'друга')}</strong><p>В конверте прячется английское слово.</p><button class="primary-btn" data-action="open-gift" data-id="${esc(g.id)}">Открыть и разгадать →</button></div>`).join('')}`}
 const received=gifts.filter(g=>g.done);if(received.length)html+=`<p class="small-muted">Полученные подарки: ${received.map(g=>WORD_BY_ID[g.wordId]?.emoji+' '+WORD_BY_ID[g.wordId]?.en).join(', ')}</p>`;
 html+=`<div class="divider"></div><p><b>Отправить слово другу</b></p>`;
 if(!other)html+='<p class="small-muted">Пока вы в домике одни. Поделись кодом комнаты с другом!</p>';
 else if(sent)html+=`<div class="feedback">Сегодняшний подарок уже отправлен: <b>${esc(WORD_BY_ID[sent.wordId]?.en||'')}</b> ${sent.done?'✓ получен':'· ждёт друга'}</div>`;
 else if(!learned.length)html+='<p class="small-muted">Сначала выполни хотя бы одно упражнение, чтобы открыть слова для подарков.</p>';
 else html+=`<div class="gift-list">${learned.slice(0,40).map(w=>`<button class="answer-btn" data-action="send-gift" data-word="${w.id}">${w.emoji} ${esc(w.en)} <span class="small-muted">— ${esc(w.ru)}</span></button>`).join('')}</div>`;
 showModal('Подарки друг другу 💌','МАЛЕНЬКОЕ ТЁПЛОЕ СЛОВО',html,'gifts');}
async function sendGift(id){const other=partnerId();if(!other)return;let ok=await mutate(r=>{let p=r.players[myId];if(!p.knownIds.includes(id)||r.gifts.some(g=>g.from===myId&&g.date===TODAY())||!r.players[other])return false;r.gifts.push({id:uid(),wordId:id,from:myId,to:other,date:TODAY(),created:Date.now(),done:false});p.sentDate=TODAY();return true});if(ok){showGifts();toast('Подарок отправлен! 💌')}}
function showSettings(){showModal('Настройки мира ⚙','НАШ МАЛЕНЬКИЙ МИР',`<p class="small-muted">Ты играешь как <strong>${esc(me()?.name)}</strong> · ${me()?.level==='A0'?'A0':'A2–B1'}.</p>${online?`<p>Отправь другу этот код, чтобы он присоединился:</p><span class="room-code">${esc(roomId)}</span><div class="modal-actions"><button class="primary-btn" data-action="copy-code">📋 Скопировать код</button></div><p class="warning">Анонимная авторизация привязана к текущему браузеру. Не удаляй данные сайта, иначе можешь потерять доступ к своему персонажу.</p>`:`<p class="feedback">Сейчас включена локальная демоверсия. Кнопка «Играть →» рядом с другим игроком позволяет переключать роли. Для настоящей игры на двух устройствах настрой Firebase.</p><div class="modal-actions"><button class="soft-btn" data-action="switch-player">Сменить игрока</button></div>`}<div class="divider"></div><button class="warn-btn" data-action="reset-world">${online?'Выйти из комнаты':'Начать демо заново'}</button>`,'settings');}
function showHelp(){showModal('Как играть? 🍃','ВСЁ ОЧЕНЬ ПРОСТО',`<p>1. Нажми <b>«Учить слова»</b> и выполни 5 небольших заданий.</p><p>2. За каждый правильный ответ получай <b>10 общих монет</b>. После ошибки можно попытаться ещё раз.</p><p>3. Слова превращаются в растения. Повторения помогают им вырасти до цветка.</p><p>4. Трать монеты в магазине, гладь котика и дари другу по одному слову в день.</p><p>5. У игроков могут быть разные уровни: A0 и A2–B1. Каждый учится в своём темпе. Перерывы ни на что не влияют.</p><div class="modal-actions"><button class="primary-btn" data-action="close">Понятно! 🌷</button></div>`,'help');}
function switchPlayer(id){if(online)return;if(!room.players[id])return;myId=id;saveLocal();render();closeModal();toast('Теперь играешь за '+room.players[id].name)}
function handleModalClick(e){const b=e.target.closest('[data-action]');if(!b)return;const action=b.dataset.action;
 switch(action){case 'close':closeModal();break;case 'speak':speak(b.dataset.text);break;case 'answer':handleAnswer(b.dataset.value);break;case 'add-token':{if(!quiz||quiz.locked)return;let ix=+b.dataset.index;if(!quiz.selected.includes(ix))quiz.selected.push(ix);renderQuiz();break}case 'remove-token':{if(!quiz||quiz.locked)return;quiz.selected.splice(+b.dataset.index,1);renderQuiz();break}case 'clear-tokens':{if(quiz){quiz.selected=[];renderQuiz()}break}case 'check-tokens':handleTokens();break;case 'retry':{if(quiz){quiz.locked=false;quiz.selected=[];renderQuiz()}break}case 'garden':showGarden();break;case 'plot':showPlot(+b.dataset.index);break;case 'replant':replant(+b.dataset.index,b.dataset.word);break;case 'pet':updatePet('happy');break;case 'sleep':updatePet('sleepy');break;case 'rename':renamePet();break;case 'buy':shopBuy(b.dataset.id);break;case 'send-gift':sendGift(b.dataset.word);break;case 'open-gift':startQuiz('gift',b.dataset.id);break;case 'copy-code':copyCode();break;case 'switch-player':switchPlayer(partnerId());break;case 'reset-world':resetWorld();break;}}
async function copyCode(){if(!online)return;try{await navigator.clipboard.writeText(roomId);toast('Код скопирован!')}catch(e){toast('Код комнаты: '+roomId)}}
function resetWorld(){if(!confirm(online?'Выйти из этой комнаты на данном устройстве?':'Удалить локальный прогресс и начать сначала?'))return;closeModal();if(online){localStorage.removeItem('word-cottage-room-code');if(unsubscribe){unsubscribe();unsubscribe=null}room=null;roomId='';online=false;showOnboarding()}else{localStorage.removeItem(DEMO_KEY);room=null;myId=null;showOnboarding()}toast('Можно начать новый мир')}
function attach(){document.querySelectorAll('[data-level]').forEach(b=>b.addEventListener('click',()=>{chosenLevel=b.dataset.level;document.querySelectorAll('[data-level]').forEach(c=>c.classList.toggle('selected',c===b))}));document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>switchEntryTab(b.dataset.mode)));
 $('startButton').addEventListener('click',startGame);$('playerName').addEventListener('keydown',e=>{if(e.key==='Enter')startGame()});$('learnButton').addEventListener('click',showLearn);$('gardenButton').addEventListener('click',showGarden);$('petButton').addEventListener('click',showPet);$('giftButton').addEventListener('click',showGifts);$('houseHotspot').addEventListener('click',showPet);$('petHotspot').addEventListener('click',()=>updatePet('happy'));$('helpButton').addEventListener('click',showHelp);$('settingsButton').addEventListener('click',showSettings);$('closeModal').addEventListener('click',closeModal);$('modalBody').addEventListener('click',handleModalClick);
 $('modalOverlay').addEventListener('click',e=>{if(e.target===$('modalOverlay'))closeModal()});window.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('modalOverlay').classList.contains('hidden'))closeModal()});$('roomCodeDisplay').addEventListener('click',copyCode);
 $('playersSection').addEventListener('click',e=>{let b=e.target.closest('[data-switch]');if(b)switchPlayer(b.dataset.switch)});
 let hot=$('bedHotspots');for(let i=0;i<6;i++){let b=document.createElement('button');b.type='button';b.setAttribute('aria-label','Открыть грядку '+(i+1));b.addEventListener('click',()=>showPlot(i));hot.append(b)};
}
async function boot(){attach();let stored;try{stored=JSON.parse(localStorage.getItem(DEMO_KEY)||'null')}catch(e){}if(stored?.room?.players?.[stored.myId]){room=normalizeRoom(stored.room);myId=stored.myId;render();$('onboarding').classList.add('hidden');status('● Локальное сохранение')}else showOnboarding();await initFirebase();if(firebaseReady){$('modeDescription').textContent='С Firebase можно создать общую комнату и пригласить друга по коду.';if(room&&!online){toast('Локальная игра доступна. Для онлайн-комнаты выбери настройки → новый мир.')}}}
boot();
})();
