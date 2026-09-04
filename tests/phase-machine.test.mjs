import { PhaseTokenFilter, resolvePhase, nextPhase, invalidateFrom } from '../src/lib/phase-machine.ts';
import { FLOW } from '../src/types/goal.ts';
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

// --- token filter: 想定外のID（実機でモデルが step1 と書いて本文に漏れた） ---
f=new PhaseTokenFilter();
out=f.push('本文です。<<<PHASE:step1>>>')+f.flush();
eq(out,'本文です。','数字入りの想定外IDでも本文に漏らさない');
eq(f.phase,'step1','検出はする（採用可否は isValidPhase 側で弾く）');

// --- token filter: no token ---
f=new PhaseTokenFilter();
out=f.push('トークンなしの本文')+f.flush();
eq(out,'トークンなしの本文','トークンが無ければ素通し');
eq(f.phase,null,'検出なし');

// --- small は diverge → smart → woop_wbs の3ステップ ---
// meaning / reframe（なぜ大事か）は big_why に集約したので small からは外れている。
// 以前は5フェーズ最大39ターンあり「いつまで続くのか」という実使用の声を受けて短縮した。
eq(FLOW.small.length, 3, 'small は3ステップ');
eq(FLOW.small.includes('meaning'), false, 'meaning は small フローから外れている');
eq(FLOW.small.includes('reframe'), false, 'reframe は small フローから外れている');

// --- 最低ターン数に満たなければ進まない ---
// 1ターン目はそのステップの問いかけ自体が消費する（ユーザー未回答）
eq(resolvePhase({mode:'small',current:'diverge',claimed:'smart',turnsInPhase:1}),{phase:'diverge',forced:false},'問いかけ直後(1ターン目)では進まない');
eq(resolvePhase({mode:'small',current:'diverge',claimed:'smart',turnsInPhase:2}),{phase:'smart',forced:false},'ユーザーが答えた2ターン目で進む');
eq(resolvePhase({mode:'small',current:'smart',claimed:'woop_wbs',turnsInPhase:2}),{phase:'smart',forced:false},'smart は3ターン未満では進まない');
eq(resolvePhase({mode:'small',current:'smart',claimed:'woop_wbs',turnsInPhase:3}),{phase:'woop_wbs',forced:false},'smart は3ターン到達で進む');

// --- 上限で強制遷移 ---
eq(resolvePhase({mode:'small',current:'diverge',claimed:'diverge',turnsInPhase:3}),{phase:'diverge',forced:false},'diverge は3ターン目ではまだ上限に達しない');
eq(resolvePhase({mode:'small',current:'diverge',claimed:'diverge',turnsInPhase:4}),{phase:'smart',forced:true},'diverge は上限4で遷移を提案する');
eq(resolvePhase({mode:'small',current:'smart',claimed:'smart',turnsInPhase:5}),{phase:'woop_wbs',forced:true},'smart は上限5で強制遷移');

// --- 後退させない ---
eq(resolvePhase({mode:'small',current:'smart',claimed:'diverge',turnsInPhase:5}),{phase:'woop_wbs',forced:true},'後退申告は無視（上限側が優先）');
eq(resolvePhase({mode:'small',current:'smart',claimed:'diverge',turnsInPhase:3}),{phase:'smart',forced:false},'後退申告では動かない');

// --- 飛ばさせない ---
eq(resolvePhase({mode:'small',current:'diverge',claimed:'woop_wbs',turnsInPhase:2}),{phase:'smart',forced:false},'2つ以上先は1つずつに丸める');

// --- 最終フェーズ ---
eq(resolvePhase({mode:'small',current:'woop_wbs',claimed:'done',turnsInPhase:3}),{phase:'done',forced:false},'woop_wbs から done へ');

// --- mode対応: nextPhase / resolvePhase ---
eq(nextPhase('small', 'diverge'), 'smart', 'smallモードは diverge の次が smart');
eq(nextPhase('small', 'woop_wbs'), 'done', 'smallモード最終ステップの次は done');
eq(nextPhase('big', 'big_vision'), 'big_why', 'bigモードはFLOW.big通りに進む');
eq(nextPhase('big', 'big_position'), 'done', 'bigモード最終フェーズの次はdone');

// bigモードの各フェーズは「1ターン目=問いかけ（ユーザー未回答）」を消費するため、
// min=1だとユーザーが答える前に進んでしまう不具合があった（実機検証で発覚）。
// min=2にして「問いかけ(1)+回答を受けた返信(2)」で初めて進めるようにする。
eq(
  resolvePhase({ mode: 'big', current: 'big_vision', claimed: 'big_why', turnsInPhase: 1 }),
  { phase: 'big_vision', forced: false },
  'bigモードは問いかけ直後(1ターン目)では進まない（ユーザー未回答のため）',
);
eq(
  resolvePhase({ mode: 'big', current: 'big_vision', claimed: 'big_why', turnsInPhase: 2 }),
  { phase: 'big_why', forced: false },
  'bigモードはユーザーの回答を受けた2ターン目で進める',
);
eq(
  resolvePhase({ mode: 'big', current: 'big_vision', claimed: 'big_vision', turnsInPhase: 3 }),
  { phase: 'big_why', forced: true },
  'bigモードのvisionは上限3で強制遷移',
);
eq(
  resolvePhase({ mode: 'big', current: 'big_why', claimed: 'big_why', turnsInPhase: 4 }),
  { phase: 'big_position', forced: true },
  'bigモードのwhyは上限4で強制遷移',
);

// --- invalidateFrom ---
const staleSession = {
  id: 's1',
  mode: 'small',
  coachId: 'kaede',
  currentPhase: 'woop_wbs',
  phaseTurnCounts: { diverge: 2, smart: 3, woop_wbs: 1 },
  phaseStatus: { diverge: 'done', smart: 'done', woop_wbs: 'current' },
  messages: [
    { role: 'assistant', content: 'a', phase: 'diverge', timestamp: 't1' },
    { role: 'user', content: 'b', phase: 'smart', timestamp: 't2' },
  ],
  startedAt: 't0',
  completedAt: null,
  variant: { commitmentStep: false, deliberateDelay: false },
  phaseEnteredAt: {},
};
const afterInvalidate = invalidateFrom(staleSession, 'diverge');
eq(afterInvalidate.currentPhase, 'diverge', 'invalidateFromはcurrentPhaseを対象ステップへ戻す');
eq(afterInvalidate.phaseStatus.smart, 'stale', '後続ステップはstaleになる');
eq(afterInvalidate.phaseStatus.woop_wbs, 'stale', 'woop_wbsもstaleになる');
eq(afterInvalidate.phaseTurnCounts.smart, 0, '後続ステップのターン数は0にリセットされる');
eq(afterInvalidate.messages[1].invalidated, true, '対象ステップ以降のメッセージはinvalidatedになる');
eq(afterInvalidate.messages.length, 2, 'メッセージは削除されず残る');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
