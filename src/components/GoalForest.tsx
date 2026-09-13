"use client";

import { useId, useMemo } from "react";
import { drawForest, GROUND_Y, VIEW_W } from "@/lib/forest-draw";
import type { ForestModel } from "@/lib/forest";

/**
 * 目標の森。木1本 = 目標、小枝 = 中間目標、葉 = 習慣、地下の根 = 価値観。
 * 形の計算は lib/forest-draw.ts。ここは描くだけ。
 *
 * single は目標詳細の上に出す1本だけの木。選択は常にその木。
 */
export function GoalForest({
  model,
  selectedId,
  onSelect,
  single = false,
  label,
}: {
  model: ForestModel;
  selectedId?: string | null;
  onSelect?: (cardId: string) => void;
  single?: boolean;
  label: string;
}) {
  const g = useMemo(() => drawForest(model, { single }), [model, single]);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const id = (name: string) => `${name}-${uid}`;
  const selected = single ? model.trees[0]?.cardId : selectedId;
  const litValues = new Set(model.trees.find((t) => t.cardId === selected)?.links ?? []);

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${g.height}`}
      role="img"
      aria-label={label}
      className="goal-forest block h-auto w-full"
    >
      <defs>
        <linearGradient id={id("sky")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--tree-sky-top)" }} />
          <stop offset="1" style={{ stopColor: "var(--tree-sky-bot)" }} />
        </linearGradient>
        <radialGradient id={id("sun")}>
          <stop offset="0" style={{ stopColor: "var(--tree-sun)" }} />
          <stop offset="1" style={{ stopColor: "var(--tree-sun)", stopOpacity: 0 }} />
        </radialGradient>
        <linearGradient id={id("soil")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--tree-soil1)" }} />
          <stop offset="1" style={{ stopColor: "var(--tree-soil2)" }} />
        </linearGradient>
        <linearGradient id={id("bark")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" style={{ stopColor: "var(--tree-bark1)" }} />
          <stop offset="0.55" style={{ stopColor: "var(--tree-bark2)" }} />
          <stop offset="1" style={{ stopColor: "var(--tree-bark1)" }} />
        </linearGradient>
      </defs>

      <rect width={VIEW_W} height={GROUND_Y + 4} fill={`url(#${id("sky")})`} />
      <circle cx={318} cy={60} r={90} fill={`url(#${id("sun")})`} />
      <path
        className="gf-hill"
        d={`M0,${GROUND_Y - 30}C70,${GROUND_Y - 60} 140,${GROUND_Y - 38} 210,${GROUND_Y - 50}C280,${GROUND_Y - 62} 340,${GROUND_Y - 40} 400,${GROUND_Y - 54}L400,${GROUND_Y + 4}L0,${GROUND_Y + 4}Z`}
      />
      <rect y={GROUND_Y} width={VIEW_W} height={g.height - GROUND_Y} fill={`url(#${id("soil")})`} />
      <path className="gf-groundline" d={`M0,${GROUND_Y + 1}C100,${GROUND_Y - 3} 300,${GROUND_Y + 5} 400,${GROUND_Y}`} />
      <path className="gf-grass" d={g.grass} />

      {g.roots.map((r, i) => (
        <path
          key={`r${i}`}
          d={r.d}
          className={r.cardId === selected ? "gf-sap" : "gf-mycel"}
          style={{ stroke: r.color }}
        />
      ))}
      {g.nodes.map((n) => (
        <g key={`n${n.index}`}>
          <circle
            cx={n.cx}
            cy={n.cy}
            r={n.r}
            className={litValues.has(n.index) ? "gf-node gf-lit" : "gf-node"}
            style={{ fill: n.color }}
          />
          <text
            x={n.cx}
            y={n.ly}
            textAnchor="middle"
            className={litValues.has(n.index) ? "gf-rootlab gf-lit" : "gf-rootlab"}
          >
            {n.label}
          </text>
        </g>
      ))}

      {g.fallen.map((t, i) => (
        <path key={`f${i}`} className="gf-fallen" d="M0,0C2,-2.4 5,-2.4 7,0C5,2.4 2,2.4 0,0Z" transform={t} />
      ))}
      {g.shade.map((e, i) => (
        <ellipse key={`s${i}`} className="gf-canopy" cx={e.cx} cy={e.cy} rx={e.rx} ry={e.ry} />
      ))}
      {g.wood.map((w, i) => (
        <g key={`w${i}`}>
          <path d={w.d} fill={`url(#${id("bark")})`} />
          {w.hi && <polyline className="gf-barkhi" points={w.hi} strokeWidth={w.hiW} />}
        </g>
      ))}
      {g.leaves.map((l, i) => (
        <path key={`l${i}`} d={l.d} fill={l.fill} transform={l.transform} />
      ))}
      {g.buds.map((b, i) => (
        <circle key={`b${i}`} className="gf-bud" cx={b.cx} cy={b.cy} r={b.r} strokeWidth={b.sw} />
      ))}
      {g.flowers.map((f, i) => (
        <g key={`fl${i}`}>
          {f.petals.map((p, k) => (
            <circle key={k} className="gf-petal" cx={p.cx} cy={p.cy} r={p.r} />
          ))}
          <circle className="gf-pistil" cx={f.cx} cy={f.cy} r={f.r} />
        </g>
      ))}
      {g.fruits.map((f, i) => (
        <g key={`fr${i}`}>
          <path className="gf-stem" d={`M${f.x},${f.y}l0,${6 * f.s}`} />
          <circle className="gf-fruit" cx={f.x} cy={f.y + 11 * f.s} r={5.5 * f.s} />
          <circle className="gf-fruit-hi" cx={f.x - 1.8 * f.s} cy={f.y + 9 * f.s} r={1.5 * f.s} />
        </g>
      ))}

      {!single &&
        g.hits.map((h) => {
          const on = h.cardId === selected;
          return (
            <g
              key={h.cardId}
              role="button"
              tabIndex={0}
              aria-pressed={on}
              aria-label={`${h.label}の木を選ぶ`}
              className="gf-hit"
              onClick={() => onSelect?.(h.cardId)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect?.(h.cardId);
                }
              }}
            >
              <rect x={h.x} y={h.y} width={h.w} height={h.h} fill="transparent" />
              <text
                x={h.labelX}
                y={h.labelY}
                textAnchor="middle"
                className={on ? "gf-treelab gf-lit" : "gf-treelab"}
              >
                {h.label}
              </text>
            </g>
          );
        })}
    </svg>
  );
}
