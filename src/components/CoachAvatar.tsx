import type { CoachId } from "@/types/goal";

/**
 * コーチのアイコン。外部画像を持たずSVGで描く。
 * 顔の造作は共通で、髪型・目・配色だけを差し替えて描き分ける。
 */
type EyeStyle = "round" | "sharp" | "sleepy" | "closed" | "happy" | "onehidden";
type HairStyle = "medium" | "short" | "fluffy" | "long" | "spiky" | "hood";

interface Look {
  bg: string;
  hair: string;
  hairDark: string;
  cloth: string;
  eyeColor: string;
  eye: EyeStyle;
  hairStyle: HairStyle;
}

const SKIN = "#F8E0CE";
const SKIN_SHADE = "#EFCDB6";
const BLUSH = "#F0A9A0";
const MOUTH = "#B9705F";

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

export function CoachAvatar({
  id,
  size = 48,
  className = "",
}: {
  id: CoachId;
  size?: number;
  className?: string;
}) {
  const look = LOOKS[id];
  const clip = `clip-${id}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id={clip}>
          <circle cx="32" cy="32" r="32" />
        </clipPath>
      </defs>

      <g clipPath={`url(#${clip})`}>
        <circle cx="32" cy="32" r="32" fill={look.bg} />

        {/* 肩 */}
        <ellipse cx="32" cy="70" rx="26" ry="18" fill={look.cloth} />
        <ellipse cx="32" cy="70" rx="26" ry="18" fill="#000" opacity="0.04" />

        <BackHair look={look} />

        {/* 首 */}
        <rect x="28" y="46" width="8" height="8" rx="3" fill={SKIN_SHADE} />

        {/* 顔 */}
        <ellipse cx="32" cy="34" rx="15" ry="16.5" fill={SKIN} />

        {/* 耳 */}
        <ellipse cx="17.5" cy="35" rx="2.4" ry="3.4" fill={SKIN_SHADE} />
        <ellipse cx="46.5" cy="35" rx="2.4" ry="3.4" fill={SKIN_SHADE} />

        <FrontHair look={look} />

        <Eyes look={look} />

        {/* 頬 */}
        <ellipse cx="22" cy="39.5" rx="3.2" ry="2" fill={BLUSH} opacity="0.5" />
        <ellipse cx="42" cy="39.5" rx="3.2" ry="2" fill={BLUSH} opacity="0.5" />

        <Mouth look={look} />
      </g>
    </svg>
  );
}

function BackHair({ look }: { look: Look }) {
  const { hairStyle, hair, hairDark } = look;

  if (hairStyle === "hood") {
    return (
      <>
        <path
          d="M32 8c-14 0-22 10-22 22 0 8 2 14 5 18h34c3-4 5-10 5-18 0-12-8-22-22-22z"
          fill={hairDark}
        />
        <path d="M12 44c4 4 12 6 20 6s16-2 20-6l4 16H8z" fill={look.cloth} />
      </>
    );
  }

  if (hairStyle === "long") {
    return (
      <path
        d="M32 8C19 8 13 17 13 30v34h8V34c0-2 1-3 2-3h18c1 0 2 1 2 3v30h8V30C51 17 45 8 32 8z"
        fill={hair}
      />
    );
  }

  if (hairStyle === "medium") {
    return (
      <path
        d="M32 8C20 8 14 16 14 29v20c0 2 2 3 4 2V32c0-3 2-5 5-5h18c3 0 5 2 5 5v19c2 1 4 0 4-2V29C50 16 44 8 32 8z"
        fill={hair}
      />
    );
  }

  if (hairStyle === "fluffy") {
    return (
      <>
        <ellipse cx="32" cy="27" rx="21" ry="20" fill={hair} />
        <ellipse cx="16" cy="32" rx="6" ry="8" fill={hair} />
        <ellipse cx="48" cy="32" rx="6" ry="8" fill={hair} />
      </>
    );
  }

  if (hairStyle === "spiky") {
    return (
      <>
        <ellipse cx="32" cy="27" rx="19" ry="18" fill={hair} />
        <path
          d="M13 26l-5-7 9 2zM51 26l5-7-9 2zM32 6l4 8h-8z"
          fill={hairDark}
        />
      </>
    );
  }

  // short
  return <ellipse cx="32" cy="27" rx="19" ry="18" fill={hair} />;
}

function FrontHair({ look }: { look: Look }) {
  const { hairStyle, hair, hairDark } = look;

  if (hairStyle === "hood") {
    // フードの縁が額に落ちる
    return (
      <path
        d="M32 12c-12 0-19 8-19 18 0 1 0 2 1 3 2-8 8-13 18-13s16 5 18 13c1-1 1-2 1-3 0-10-7-18-19-18z"
        fill={hairDark}
      />
    );
  }

  if (hairStyle === "long") {
    return (
      <path
        d="M32 12c-11 0-17 7-17 16 3-6 8-9 17-9s14 3 17 9c0-9-6-16-17-16z"
        fill={hair}
      />
    );
  }

  if (hairStyle === "medium") {
    return (
      <>
        <path
          d="M32 12c-11 0-17 7-17 16 2-7 7-11 12-11 3 0 4 2 8 2s6-3 9-2c4 1 5 6 5 11 0-9-6-16-17-16z"
          fill={hair}
        />
        <path d="M20 28c1-6 5-10 9-10-4 3-6 6-6 12z" fill={hairDark} opacity="0.5" />
      </>
    );
  }

  if (hairStyle === "fluffy") {
    return (
      <path
        d="M32 13c-11 0-17 7-17 16 2-6 6-9 10-9 3 0 5 3 9 3s7-4 10-3c4 1 5 4 5 9 0-9-6-16-17-16z"
        fill={hair}
      />
    );
  }

  if (hairStyle === "spiky") {
    return (
      <path
        d="M32 12c-11 0-17 7-17 16 3-5 5-7 8-7l3 5 3-6 4 6 4-5 3 5c3 0 6 2 9 7 0-12-6-21-17-21z"
        fill={hair}
      />
    );
  }

  // short（リン）: 前髪をまっすぐ切りそろえる
  return (
    <path
      d="M32 12c-11 0-17 7-17 16 0-6 3-8 6-8h22c3 0 6 2 6 8 0-9-6-16-17-16z"
      fill={hair}
    />
  );
}

function Eyes({ look }: { look: Look }) {
  const c = look.eyeColor;
  const L = 25.5;
  const R = 38.5;
  const y = 35;

  switch (look.eye) {
    case "round":
      return (
        <>
          {[L, R].map((x) => (
            <g key={x}>
              <ellipse cx={x} cy={y} rx="2.7" ry="3.4" fill={c} />
              <circle cx={x + 0.9} cy={y - 1.2} r="1" fill="#fff" opacity="0.9" />
            </g>
          ))}
        </>
      );

    case "sharp":
      // まぶたを別の線にすると眉のように浮くので、切れ長の形そのもので描く
      return (
        <>
          <ellipse cx={L} cy={y} rx="2.9" ry="2.1" fill={c} transform={`rotate(-10 ${L} ${y})`} />
          <ellipse cx={R} cy={y} rx="2.9" ry="2.1" fill={c} transform={`rotate(10 ${R} ${y})`} />
        </>
      );

    case "sleepy":
      // 目の上半分を肌色で伏せて半目にする
      return (
        <>
          {[L, R].map((x) => (
            <g key={x}>
              <ellipse cx={x} cy={y} rx="2.7" ry="3.1" fill={c} />
              <rect x={x - 3} y={y - 3.6} width="6" height="2.9" fill={SKIN} />
              <path
                d={`M${x - 2.9} ${y - 0.8}h5.8`}
                stroke={c}
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </g>
          ))}
        </>
      );

    case "closed":
      return (
        <>
          {[L, R].map((x) => (
            <path
              key={x}
              d={`M${x - 3.4} ${y - 0.5}q3.4 3 6.8 0`}
              stroke={c}
              strokeWidth="1.7"
              strokeLinecap="round"
              fill="none"
            />
          ))}
        </>
      );

    case "happy":
      return (
        <>
          {[L, R].map((x) => (
            <path
              key={x}
              d={`M${x - 3.4} ${y + 1.4}q3.4 -4.4 6.8 0`}
              stroke={c}
              strokeWidth="1.9"
              strokeLinecap="round"
              fill="none"
            />
          ))}
        </>
      );

    case "onehidden":
      return (
        <>
          {/* 右目だけ見えている。左は前髪で隠れる */}
          <ellipse cx={R} cy={y} rx="2.5" ry="3.2" fill={c} />
          <circle cx={R + 0.8} cy={y - 1.1} r="0.9" fill="#fff" opacity="0.85" />
          {/* 左目にかかる前髪の束 */}
          <path
            d="M16 13c1 12 5 21 13 27l6-6C27 29 21 22 20 11z"
            fill={look.hair}
          />
        </>
      );
  }
}

function Mouth({ look }: { look: Look }) {
  const y = 43.5;

  // 挑発型は片方だけ上がった薄い笑み
  if (look.eye === "onehidden") {
    return (
      <path
        d={`M29 ${y}q3 2.2 6 -1`}
        stroke={MOUTH}
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
    );
  }

  // 応援型は口を開けて笑う
  if (look.eye === "happy") {
    return <path d={`M28.5 ${y - 0.6}q3.5 4.4 7 0z`} fill={MOUTH} />;
  }

  // 沈黙型・直球型は真一文字に近い
  if (look.eye === "closed" || look.eye === "sharp") {
    return (
      <path
        d={`M29.5 ${y}h5`}
        stroke={MOUTH}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    );
  }

  return (
    <path
      d={`M29.5 ${y - 0.6}q2.5 2.6 5 0`}
      stroke={MOUTH}
      strokeWidth="1.5"
      strokeLinecap="round"
      fill="none"
    />
  );
}
