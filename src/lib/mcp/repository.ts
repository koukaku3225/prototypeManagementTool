import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { McpGoalsInputSchema, McpWeeklyInputSchema } from "@/lib/api-schema";
import { decodeMcpCursor, encodeMcpCursor, mcpArgsHash, trimMcpText, weekEndExclusive } from "./data";

const PAGE_SIZE = 100;
const MAX_BYTES = 64 * 1024;
type GoalsInput = z.infer<typeof McpGoalsInputSchema>;
type WeeklyInput = z.infer<typeof McpWeeklyInputSchema>;
type Row = Record<string, unknown>;

function checkedRows(result: { data: unknown; error: unknown }): Row[] {
  if (result.error) throw result.error;
  return (result.data ?? []) as Row[];
}

function short(value: unknown, omitted: Set<string>, field: string): string {
  const result = trimMcpText(value);
  if (result.truncated) omitted.add(field);
  return result.value;
}

export function createMcpRepository(db: SupabaseClient, userId: string, signal: AbortSignal, cursorSecret: string) {
  return {
    async getGoals(input: GoalsInput) {
      const argsHash = mcpArgsHash({ include_big_story: input.include_big_story });
      const state = input.cursor
        ? decodeMcpCursor(input.cursor, cursorSecret, { userId, tool: "goals", argsHash })
        : { goalOffset: 0 };
      const offset = state.goalOffset ?? 0;
      const result = await db.from("goal_cards")
        .select("id,label,status,vision_refined,smart_specific,smart_deadline,meaning_values,updated_at")
        .eq("user_id", userId).order("id", { ascending: true })
        .range(offset, offset + PAGE_SIZE).abortSignal(signal);
      const rows = checkedRows(result);
      const omitted = new Set<string>();
      const goals: Row[] = [];
      for (const row of rows.slice(0, PAGE_SIZE)) {
        const goal = {
          id: row.id,
          label: short(row.label, omitted, "goals.label"),
          status: row.status,
          goal: short(row.smart_specific || row.vision_refined, omitted, "goals.goal"),
          deadline: row.smart_deadline,
          values: Array.isArray(row.meaning_values) ? row.meaning_values.slice(0, 10).map((v) => trimMcpText(v, 200).value) : [],
          updated_at: row.updated_at,
          definition: "current",
        };
        if (goals.length > 0 && Buffer.byteLength(JSON.stringify([...goals, goal]), "utf8") > 20 * 1024) break;
        goals.push(goal);
      }
      let bigStory: unknown = undefined;
      if (input.include_big_story && offset === 0) {
        const storyResult = await db.from("big_stories")
          .select("vision_refined,values,updated_at").eq("user_id", userId).abortSignal(signal).maybeSingle();
        if (storyResult.error) throw storyResult.error;
        const row = storyResult.data as Row | null;
        if (row) bigStory = {
          vision: short(row.vision_refined, omitted, "big_story.vision"),
          values: Array.isArray(row.values) ? row.values.slice(0, 10).map((v) => trimMcpText(v, 200).value) : [],
          updated_at: row.updated_at,
          definition: "current",
        };
      }
      const makeGoalsPayload = () => ({
        schema_version: 1,
        source: "supabase",
        retrieved_at: new Date().toISOString(),
        freshness: "unknown",
        goals,
        ...(bigStory ? { big_story: bigStory } : {}),
        omitted_fields: [...omitted],
        next_cursor: goals.length < rows.length
          ? encodeMcpCursor({ userId, tool: "goals", argsHash, goalOffset: offset + goals.length }, cursorSecret)
          : null,
        warnings: ["現在の目標定義です。クラウドに同期済みの情報だけを返しています。"],
      });
      while (goals.length > 1 && Buffer.byteLength(JSON.stringify(makeGoalsPayload()), "utf8") > 28 * 1024) goals.pop();
      return makeGoalsPayload();
    },

    async getWeeklyActivity(input: WeeklyInput) {
      const end = weekEndExclusive(input.week_start);
      const argsHash = mcpArgsHash({ week_start: input.week_start, goal_id: input.goal_id ?? null });
      const state = input.cursor
        ? decodeMcpCursor(input.cursor, cursorSecret, { userId, tool: "weekly", argsHash })
        : { habitOffset: 0, timeboxOffset: 0 };
      const habitOffset = state.habitOffset ?? 0;
      const timeboxOffset = state.timeboxOffset ?? 0;

      let logsBuilder = db.from("habit_logs").select("habit_id,date,state,at,note,mood,habits!inner(card_id)")
        .eq("user_id", userId).gte("date", input.week_start).lt("date", end)
        .order("date", { ascending: true }).order("habit_id", { ascending: true })
        .range(habitOffset, habitOffset + PAGE_SIZE);
      if (input.goal_id) logsBuilder = logsBuilder.eq("habits.card_id", input.goal_id);
      const logsQuery = logsBuilder.abortSignal(signal);
      let boxesBuilder = db.from("timeboxes").select("id,habit_id,card_id,date,start_time,end_time,title,completed_at,review")
        .eq("user_id", userId).gte("date", input.week_start).lt("date", end)
        .order("date", { ascending: true }).order("id", { ascending: true })
        .range(timeboxOffset, timeboxOffset + PAGE_SIZE);
      if (input.goal_id) boxesBuilder = boxesBuilder.eq("card_id", input.goal_id);
      const boxesQuery = boxesBuilder.abortSignal(signal);

      const [logsResult, boxesResult] = await Promise.all([logsQuery, boxesQuery]);
      const logs = checkedRows(logsResult);
      const boxes = checkedRows(boxesResult);
      const candidates = [
        ...logs.map((row) => ({ source: "habit" as const, row, date: String(row.date), id: String(row.habit_id) })),
        ...boxes.map((row) => ({ source: "timebox" as const, row, date: String(row.date), id: String(row.id) })),
      ].sort((a, b) => a.date.localeCompare(b.date) || a.source.localeCompare(b.source) || a.id.localeCompare(b.id));

      const omitted = new Set<string>();
      const items: Row[] = [];
      let consumedHabits = 0;
      let consumedBoxes = 0;
      for (const candidate of candidates) {
        if (items.length >= PAGE_SIZE) break;
        const row = candidate.row;
        const item: Row = candidate.source === "habit" ? {
          kind: "habit_log", source_id: `${row.habit_id}:${row.date}`, habit_id: row.habit_id,
          date: row.date, state: row.state, at: row.at,
          note: short(row.note, omitted, "habit_logs.note"), mood: row.mood,
        } : {
          kind: "timebox", source_id: row.id, habit_id: row.habit_id, goal_id: row.card_id,
          date: row.date, planned_start: row.start_time, planned_end: row.end_time,
          title: short(row.title, omitted, "timeboxes.title"), completed_at: row.completed_at,
          review: row.review && typeof row.review === "object" ? {
            good: short((row.review as Row).good, omitted, "timeboxes.review.good"),
            bad: short((row.review as Row).bad, omitted, "timeboxes.review.bad"),
            next: short((row.review as Row).next, omitted, "timeboxes.review.next"),
            score: (row.review as Row).score,
          } : null,
          time_interpretation: "planned; not measured elapsed time",
        };
        const projected = { items: [...items, item] };
        if (items.length > 0 && Buffer.byteLength(JSON.stringify(projected), "utf8") > MAX_BYTES - 30000) break;
        items.push(item);
        if (candidate.source === "habit") consumedHabits += 1;
        else consumedBoxes += 1;
      }

      const habitIds = [...new Set(items.map((item) => item.habit_id).filter((id): id is string => typeof id === "string"))];
      const habitNames = new Map<string, { title: string; minimal_title: string; goal_id: unknown }>();
      if (habitIds.length) {
        const habitsResult = await db.from("habits").select("id,title,minimal_title,card_id")
          .eq("user_id", userId).in("id", habitIds).abortSignal(signal);
        for (const row of checkedRows(habitsResult)) habitNames.set(String(row.id), {
          title: trimMcpText(row.title, 150).value,
          minimal_title: trimMcpText(row.minimal_title, 150).value, goal_id: row.card_id,
        });
      }
      for (const item of items) if (typeof item.habit_id === "string") item.habit = habitNames.get(item.habit_id) ?? { title: "名称不明" };
      const makePayload = () => ({
        schema_version: 1,
        period: { start: input.week_start, end_exclusive: end, timezone: "Asia/Tokyo" },
        source: "supabase", retrieved_at: new Date().toISOString(), freshness: "unknown",
        items, omitted_fields: [...omitted],
        next_cursor: (consumedHabits < logs.length || consumedBoxes < boxes.length) ? encodeMcpCursor({
          userId, tool: "weekly", argsHash,
          habitOffset: habitOffset + consumedHabits,
          timeboxOffset: timeboxOffset + consumedBoxes,
        }, cursorSecret) : null,
        warnings: [
          "クラウドに同期済みの記録のみです。未記録は未実施を意味しません。",
          "時間割の開始・終了は予定時刻で、実測時間ではありません。",
          "習慣記録と時間割は同じ活動を表す場合があるため単純合算しないでください。",
        ],
      });
      // content.textとの二重収容とJSON-RPC包みを含め64KiBに収められるよう、
      // repositoryの構造化データは28KiB以下にする。削った行はカーソルで次ページへ送る。
      while (items.length > 1 && Buffer.byteLength(JSON.stringify(makePayload()), "utf8") > 28 * 1024) {
        const removed = items.pop()!;
        if (removed.kind === "habit_log") consumedHabits -= 1;
        else consumedBoxes -= 1;
      }
      return makePayload();
    },
  };
}
