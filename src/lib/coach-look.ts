import type { CoachId } from "@/types/goal";

/**
 * コーチの見た目（配色・髪型・目つき）。
 *
 * 描画（components/CoachAvatar.tsx）から表だけを分けてあるのは2つの理由から。
 * 1つは、表に無いIDが来たときに画面を落とさない判断をここに置くため。
 * もう1つは、その判断をテストで固定できるようにするため（.tsx はテストから読めない）。
 */
export type EyeStyle = "round" | "sharp" | "sleepy" | "closed" | "happy" | "onehidden";
export type HairStyle = "medium" | "short" | "fluffy" | "long" | "spiky" | "hood";

export interface Look {
  bg: string;
  hair: string;
  hairDark: string;
  cloth: string;
  eyeColor: string;
  eye: EyeStyle;
  hairStyle: HairStyle;
}

export const SKIN = "#F8E0CE";
export const SKIN_SHADE = "#EFCDB6";
export const BLUSH = "#F0A9A0";
export const MOUTH = "#B9705F";

const LOOKS: Record<CoachId, Look> = {
  kaede: {
    bg: "#F7E6D4",
    hair: "#A9714B",
    hairDark: "#8A5A3B",
    cloth: "#EDE0CE",
    eyeColor: "#5A3B2A",
    eye: "round",
    hairStyle: "medium",
  },
  rin: {
    bg: "#DBE3EE",
    hair: "#2E3440",
    hairDark: "#1C212B",
    cloth: "#FBFCFD",
    eyeColor: "#2E3440",
    eye: "sharp",
    hairStyle: "short",
  },
  sou: {
    bg: "#DCE7EA",
    hair: "#8098AB",
    hairDark: "#65798D",
    cloth: "#E8EEF0",
    eyeColor: "#41525F",
    eye: "sleepy",
    hairStyle: "fluffy",
  },
  nagi: {
    bg: "#D8E5DC",
    hair: "#232A2C",
    hairDark: "#151A1C",
    cloth: "#5E7A68",
    eyeColor: "#232A2C",
    eye: "closed",
    hairStyle: "long",
  },
  hinata: {
    bg: "#FBE7C6",
    hair: "#E58A3C",
    hairDark: "#C46F2B",
    cloth: "#F4B860",
    eyeColor: "#7A4418",
    eye: "happy",
    hairStyle: "spiky",
  },
  kuro: {
    bg: "#DFD9E8",
    hair: "#251F30",
    hairDark: "#171320",
    cloth: "#3A3247",
    eyeColor: "#7C5BB0",
    eye: "onehidden",
    hairStyle: "hood",
  },
};


/** 対話で選べるコーチ。表と対話の一覧がずれていないかはテストで見張る */
export const COACH_IDS = Object.keys(LOOKS) as CoachId[];

/** 表を引けなかったときに使うコーチ */
export const DEFAULT_COACH_ID: CoachId = "kaede";

/**
 * コーチの見た目。表に無いIDなら既定のものを返す。
 *
 * ここで undefined を返すと、SVG が look.bg を読んだ時点で例外になり、
 * エラー境界がその画面を丸ごと「うまく表示できませんでした」に差し替える。
 * 目標の一覧・目標の詳細・履歴・大きな物語がそろって開けなくなり、
 * 本人には理由も直し方も分からない。
 *
 * IDは本人が選ぶものだけとは限らない。クラウドの行（mappers.ts は
 * coach_id をそのまま CoachId として扱う）と、設定画面で貼り付けた JSON から
 * 検証なしで入ってくる。アイコン1つのために画面を失うほうが損なので、
 * 知らないIDは既定の顔で描いて先へ進む。
 */
export function coachLook(id: CoachId | string | null | undefined): Look {
  return (id && LOOKS[id as CoachId]) || LOOKS[DEFAULT_COACH_ID];
}
