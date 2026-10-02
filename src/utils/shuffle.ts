/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SeatAssignment, ClassMode } from '../types';
import { STUDENTS, SEAT_SLOTS, SUBJECT_FIXED_SLOTS, SUBJECT_FIXED_STUDENTS } from '../constants';

function arrShuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function manhattan(a: { row: number; col: number }, b: { row: number; col: number }): number {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
}

// 突き出た最後尾の1席（row0）。欠席が1名/奇数で余った1名の指定席に使う。
const REAR_SINGLE_SLOT = 'slot_0_5';

// 18番 (長嶋) と 20番 (中野) の隣接チェック。
// absentIds に18か20が含まれる（欠席）場合は制約なし。
export function checkAdjacentConstraint(
  assignment: SeatAssignment,
  absentIds: number[] = []
): boolean {
  const absentSet = new Set(absentIds);
  if (absentSet.has(18) || absentSet.has(20)) return true;

  let p18: { row: number; col: number } | null = null;
  let p20: { row: number; col: number } | null = null;

  for (const [slotId, studentId] of Object.entries(assignment)) {
    if (studentId === 18) {
      const slot = SEAT_SLOTS.find(s => s.id === slotId);
      if (slot) p18 = slot;
    } else if (studentId === 20) {
      const slot = SEAT_SLOTS.find(s => s.id === slotId);
      if (slot) p20 = slot;
    }
  }

  if (!p18 || !p20) return true;
  return manhattan(p18, p20) > 1;
}

// 過去の配置との「同じ席になった数」を重み付きで合計する（低いほど良い）。
export function scoreAgainstHistory(
  assignment: SeatAssignment,
  history: SeatAssignment[]
): number {
  let score = 0;
  for (let h = 0; h < history.length; h++) {
    const past = history[h];
    if (!past) continue;
    const weight = history.length - h;
    for (const slotId of Object.keys(assignment)) {
      if (past[slotId] !== undefined && past[slotId] === assignment[slotId]) {
        score += weight;
      }
    }
  }
  return score;
}

// 後ろから順に、横並びペア（同じ行で隣の列）を並べたリストを返す。
// excludeSlotIds（国・算の後方固定席など）は除外する。
function buildPairOrder(excludeSlotIds: Set<string>): string[] {
  const flat: string[] = [];
  for (let r = 1; r <= 5; r++) {
    for (const [a, b] of [[0, 1], [2, 3], [4, 5]]) {
      const sa = `slot_${r}_${a}`;
      const sb = `slot_${r}_${b}`;
      const hasA = SEAT_SLOTS.some(s => s.id === sa) && !excludeSlotIds.has(sa);
      const hasB = SEAT_SLOTS.some(s => s.id === sb) && !excludeSlotIds.has(sb);
      // 両方空いている横ペアのみ採用（片方が固定席なら、そのペアは崩さず後段の単独埋めに回す）
      if (hasA && hasB) {
        flat.push(sa, sb);
      }
    }
  }
  return flat;
}

// 欠席者を「後ろに詰めて横ペア」で配置するための席リストを返す。
// - 偶数: 後列(row1→row2…)の横ペアで後ろから詰める。
// - 奇数: 余り1名を最後尾の突き出た席(REAR_SINGLE_SLOT)に置き、残りを横ペアで詰める。
// - 国・算ver: 後方固定3席は使わず、それ以外で後ろから横ペア（突き出た席は固定なので使わない）。
function selectAbsentSeats(
  mode: ClassMode,
  count: number,
  usedSlotIds: Set<string>
): string[] | null {
  if (count <= 0) return [];

  const pairFlat = buildPairOrder(usedSlotIds);

  let ordered: string[];
  if (mode !== 'subject' && count % 2 === 1 && !usedSlotIds.has(REAR_SINGLE_SLOT)) {
    // 一般ver・奇数: 突き出た最後尾席を「余りの1名」用にして先頭に、残りは横ペア
    ordered = [REAR_SINGLE_SLOT, ...pairFlat];
  } else {
    // 偶数、または国・算ver（突き出た席は固定で使えない）
    ordered = pairFlat.slice();
    // 国・算verの奇数など、横ペアだけでは足りない/端数が出る場合に備え、
    // 残りの空き席（後ろ寄り）も末尾に足しておく
    const remainder = SEAT_SLOTS
      .filter(s => !usedSlotIds.has(s.id) && !ordered.includes(s.id))
      .sort((a, b) => a.row - b.row || a.col - b.col)
      .map(s => s.id);
    ordered = [...ordered, ...remainder];
  }

  const available = ordered.filter(id => !usedSlotIds.has(id));
  if (available.length < count) return null;
  return available.slice(0, count);
}

// 1候補を生成する。
// - 欠席者がいる場合: 欠席者は「後ろに詰めて横ペア」で配置（休み状態のまま後方へ移動）、
//   在席者は前方に詰めて配置。穴埋めの自由度確保のため男女席の縛りは外す。
// - forceGenderFree（男女ランダムボタン）: 欠席がなくても男女席の縛りを外す。
// - いずれの場合も 18番・20番は隣接させない。
function generateCandidate(
  mode: ClassMode,
  absentIds: Set<number>,
  forceGenderFree: boolean
): SeatAssignment | null {
  const assignment: SeatAssignment = {};
  const ignoreGender = forceGenderFree || absentIds.size > 0;

  const usedSlots = new Set<string>();
  const usedStudents = new Set<number>();
  const place = (slotId: string, studentId: number) => {
    assignment[slotId] = studentId;
    usedSlots.add(slotId);
    usedStudents.add(studentId);
  };

  // 1. 国・算ver: 後方固定3名（三鼓26・前原24・長沼19）を固定3席へ（欠席でもこの席のまま）
  if (mode === 'subject') {
    const femPair = arrShuffle([SUBJECT_FIXED_STUDENTS.female1_id, SUBJECT_FIXED_STUDENTS.female2_id]);
    place(SUBJECT_FIXED_SLOTS.female1, femPair[0]);
    place(SUBJECT_FIXED_SLOTS.female2, femPair[1]);
    place(SUBJECT_FIXED_SLOTS.male, SUBJECT_FIXED_STUDENTS.male_id);
  }

  // 2. 欠席者（固定3名を除く）を後方の欠席ゾーンへ「横ペアで後ろ詰め」
  const absentToRelocate = [...absentIds].filter(id => !usedStudents.has(id));
  const absentSeats = selectAbsentSeats(mode, absentToRelocate.length, usedSlots);
  if (!absentSeats) return null;
  arrShuffle(absentToRelocate).forEach((id, i) => place(absentSeats[i], id));

  // 3. 在席者を前方の空き席へ配置
  const openSlotsFor = (gender: 'M' | 'F') =>
    SEAT_SLOTS.filter(s => !usedSlots.has(s.id) && (ignoreGender || s.gender === gender));

  const presentStudents = STUDENTS.filter(s => !absentIds.has(s.id) && !usedStudents.has(s.id));
  const is18Present = presentStudents.some(s => s.id === 18);
  const is20Present = presentStudents.some(s => s.id === 20);

  // 3a. 18番・20番を非隣接で先に配置（通常は男子席のみ／欠席・ランダム時は男女問わず）
  if (is20Present) {
    const cand20 = openSlotsFor('M');
    if (cand20.length === 0) return null;
    const slot20 = cand20[Math.floor(Math.random() * cand20.length)];
    place(slot20.id, 20);

    if (is18Present) {
      const cand18 = openSlotsFor('M').filter(s => manhattan(s, slot20) > 1);
      if (cand18.length === 0) return null;
      const slot18 = cand18[Math.floor(Math.random() * cand18.length)];
      place(slot18.id, 18);
    }
  } else if (is18Present) {
    const cand18 = openSlotsFor('M');
    if (cand18.length === 0) return null;
    const slot18 = cand18[Math.floor(Math.random() * cand18.length)];
    place(slot18.id, 18);
  }

  // 3b. 残りの在席者を空き席へ
  const restStudents = arrShuffle(presentStudents.filter(s => !usedStudents.has(s.id)));
  const restSlots = arrShuffle(SEAT_SLOTS.filter(s => !usedSlots.has(s.id)));

  if (ignoreGender) {
    if (restStudents.length !== restSlots.length) return null;
    restSlots.forEach((slot, i) => place(slot.id, restStudents[i].id));
  } else {
    const fSlots = restSlots.filter(s => s.gender === 'F');
    const mSlots = restSlots.filter(s => s.gender === 'M');
    const fStud = restStudents.filter(s => s.gender === 'F');
    const mStud = restStudents.filter(s => s.gender === 'M');
    if (fSlots.length !== fStud.length || mSlots.length !== mStud.length) return null;
    fSlots.forEach((slot, i) => place(slot.id, fStud[i].id));
    mSlots.forEach((slot, i) => place(slot.id, mStud[i].id));
  }

  if (!checkAdjacentConstraint(assignment, [...absentIds])) return null;

  return assignment;
}

function buildFallbackAssignment(): SeatAssignment {
  const fallbackAssignment: SeatAssignment = {};
  const femaleStudents = STUDENTS.filter(s => s.gender === 'F');
  const maleStudents = STUDENTS.filter(s => s.gender === 'M');
  let fIdx = 0;
  let mIdx = 0;
  for (const slot of SEAT_SLOTS) {
    if (slot.gender === 'F') {
      fallbackAssignment[slot.id] = femaleStudents[fIdx++].id;
    } else {
      fallbackAssignment[slot.id] = maleStudents[mIdx++].id;
    }
  }
  return fallbackAssignment;
}

export interface ShuffleOptions {
  history?: SeatAssignment[];      // 過去配置（新しいものが先頭）。なるべく同じ席を避ける。
  absentStudentIds?: number[];     // 欠席中の児童ID。後方へ横ペアで移動し、在席者を前に詰める。
  forceGenderFree?: boolean;       // 男女ランダム：欠席がなくても男女席の縛りを外す（18/20は離す）。
}

// 席替えを実行する。
export function shuffleSeats(mode: ClassMode, options: ShuffleOptions = {}): SeatAssignment {
  const history = options.history ?? [];
  const absentStudentIds = options.absentStudentIds ?? [];
  const forceGenderFree = options.forceGenderFree ?? false;
  const absentSet = new Set(absentStudentIds);

  const generationAttempts = 600;
  const targetPoolSize = 250;

  // 履歴がなければ最初の有効候補をそのまま返す（高速パス）。
  // 欠席の後方配置は決定的なので、履歴なしならスコアリング不要。
  if (history.length === 0) {
    for (let i = 0; i < generationAttempts; i++) {
      const c = generateCandidate(mode, absentSet, forceGenderFree);
      if (c) return c;
    }
    return buildFallbackAssignment();
  }

  // 履歴があれば、過去と被りが最も少ない候補を選ぶ
  let best: SeatAssignment | null = null;
  let bestScore = Infinity;
  let evaluated = 0;

  for (let i = 0; i < generationAttempts && evaluated < targetPoolSize; i++) {
    const candidate = generateCandidate(mode, absentSet, forceGenderFree);
    if (!candidate) continue;
    evaluated++;

    const score = scoreAgainstHistory(candidate, history);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
      if (bestScore === 0) break;
    }
  }

  return best ?? buildFallbackAssignment();
}
