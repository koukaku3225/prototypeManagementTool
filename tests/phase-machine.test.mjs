import { PhaseTokenFilter, resolvePhase } from '../src/lib/phase-machine.ts';
let pass=0, fail=0;
const eq=(a,b,m)=>{const ok=JSON.stringify(a)===JSON.stringify(b); ok?pass++:(fail++,console.log('FAIL',m,'got',JSON.stringify(a),'want',JSON.stringify(b)));};

// --- token filter: split across chunks ---
let f=new PhaseTokenFilter();
let out='';
for (const c of ['なぜそれが','大事なんですか?\n<<<PHA','SE:meaning>>>']) out+=f.push(c);
out+=f.flush();
eq(out,'なぜそれが大事なんですか?\n','トークンが分割されても除去できる');
eq(f.phase,'meaning','分割されたトークンからフェーズを検出');

// --- token filter: single chunk ---
f=new PhaseTokenFilter();
out=f.push('本文です。<<<PHASE:done>>>')+f.flush();
eq(out,'本文です。','1チャンク内のトークン除去');
eq(f.phase,'done','done を検出');

// --- token filter: no token ---
f=new PhaseTokenFilter();
out=f.push('トークンなしの本文')+f.flush();
eq(out,'トークンなしの本文','トークンが無ければ素通し');
eq(f.phase,null,'検出なし');

// --- 最低ターン数に満たなければ進まない ---
eq(resolvePhase({current:'meaning',claimed:'reframe',turnsInPhase:2}),{phase:'meaning',forced:false},'meaning は3ターン未満では進まない');
eq(resolvePhase({current:'meaning',claimed:'reframe',turnsInPhase:3}),{phase:'reframe',forced:false},'3ターン到達で進む');

// --- 上限で強制遷移 ---
eq(resolvePhase({current:'meaning',claimed:'meaning',turnsInPhase:10}),{phase:'reframe',forced:true},'上限10で強制遷移');

// --- 後退させない ---
eq(resolvePhase({current:'smart',claimed:'diverge',turnsInPhase:9}),{phase:'woop_wbs',forced:true},'後退申告は無視（上限側が優先）');
eq(resolvePhase({current:'smart',claimed:'diverge',turnsInPhase:5}),{phase:'smart',forced:false},'後退申告では動かない');

// --- 飛ばさせない ---
eq(resolvePhase({current:'diverge',claimed:'woop_wbs',turnsInPhase:4}),{phase:'meaning',forced:false},'2つ以上先は1つずつに丸める');

// --- 最終フェーズ ---
eq(resolvePhase({current:'woop_wbs',claimed:'done',turnsInPhase:4}),{phase:'done',forced:false},'woop_wbs から done へ');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
