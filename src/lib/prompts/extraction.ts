export const STRUCTURE_EXTRACTION_PROMPT = `対話ログから情報を抽出する。
あなたの役割は記録係であり、創作者ではない。

守ること:
- ユーザーが実際に言った言葉を可能な限りそのまま使う
- ユーザーが言っていないことを補完しない
- 情報が不足している項目は、推測せず null または空配列にする
- refined は raw の言い換えであり、内容を追加してはいけない
- コーチの発言ではなく、ユーザーの発言から抽出する

各項目の取り方:
- vision.raw: ユーザーが最初に語った「なりたい姿」の生の言葉
- vision.refined: 対話を経て本人が言い直した表現。言い直していなければ raw と同じでよい
- meaning.whyChain: 「なぜ」への答えを、聞かれた順に並べる
- meaning.values: ユーザーの言葉に現れた価値観のキーワード。ユーザーが使っていない語を作らない
- meaning.motivationType: internal / external / avoidance のいずれか
- meaning.reframed / reframedFrom: 動機の言い換えが行われた場合のみ。なければ両方 null
- smart.measurable: 「週2本の企画書」のような、本人が言った表現
- smart.metricTarget / metricUnit: 数値と単位が明示されていれば入れる。なければ null
- smart.deadline: YYYY-MM-DD 形式。年が明示されていなければ対話日から推定してよいが、
  月日が不明なら null
- woop.obstacles: 障害と、それに対する If-Then プラン
- tasks: 明日やる1件だけ。estimateMin は本人が言った所要時間、なければ 45

出力は指定されたスキーマに厳密に従う。`;

export const PROFILE_EXTRACTION_PROMPT = `対話ログから、次回以降の対話に役立つ情報だけを抽出する。

- lifePatterns: 生活のリズム。「平日は22時帰宅」「朝が弱い」など、本人が言ったもの
- pastFailures: 過去にうまくいかなかった経験。「3日坊主になりがち」など
- valuesAccumulated: 大事にしているものとして語られた言葉

守ること:
- ユーザーが言っていないことを書かない
- 該当する発言がなければ空配列にする
- 推測や一般論を混ぜない`;
