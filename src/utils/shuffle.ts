/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ClassConfig, ClassMode, SeatAssignment, SeatSlot, Student, StudentPair } from '../types';
import { isAdjacent, numberOrderAssignment, studentLabel } from './config';

function arrShuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function pickRandom<T>(array: T[]): T | undefined {
  return array.length > 0 ? array[Math.floor(Math.random() * array.length)] : undefined;
}

// ---- ルール違反の判定 ----

export interface Violations {
  separate: StudentPair[]; // 隣にしない組み合わせなのに隣になっている
  near: StudentPair[]; // 隣にしたい組み合わせなのに離れている
}

function seatOfStudent(config: ClassConfig, assignment: SeatAssignment): Map<number, SeatSlot> {
  const seatById = new Map(config.seats.map(s => [s.id, s]));
  const map = new Map<number, SeatSlot>();
  for (const [slotId, studentId] of Object.entries(assignment)) {
    const seat = seatById.get(slotId);
    if (seat) map.set(studentId, seat);
  }
  return map;
}

// 欠席中の児童が含まれる組み合わせは判定しない
export function findViolations(
  config: ClassConfig,
  assignment: SeatAssignment,
  absentIds: number[] = []
): Violations {
  const absent = new Set(absentIds);
  const pos = seatOfStudent(config, assignment);
  const check = (pairs: StudentPair[], wantAdjacent: boolean) =>
    pairs.filter(([a, b]) => {
      if (absent.has(a) || absent.has(b)) return false;
      const pa = pos.get(a);
      const pb = pos.get(b);
      if (!pa || !pb) return false;
      return isAdjacent(pa, pb) !== wantAdjacent;
    });
  return { separate: check(config.separatePairs, false), near: check(config.nearPairs, true) };
}

// 過去の配置との「同じ席になった数」を重み付きで合計する（低いほど良い）。
export function scoreAgainstHistory(assignment: SeatAssignment, history: SeatAssignment[]): number {
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

// ---- 席の選び方 ----

// 座席の形から「横並びの2人机」を作る（同じ行で列が連続している席を、左から2つずつ組にする）。
// 余った1席（突き出た席など）は singles に入る。
function buildDeskPairs(seats: SeatSlot[]): { pairs: [SeatSlot, SeatSlot][]; singles: SeatSlot[] } {
  const pairs: [SeatSlot, SeatSlot][] = [];
  const singles: SeatSlot[] = [];
  const rows = [...new Set(seats.map(s => s.row))].sort((a, b) => a - b); // 後ろから
  for (const r of rows) {
    const rowSeats = seats.filter(s => s.row === r).sort((a, b) => a.col - b.col);
    let run: SeatSlot[] = [];
    const flush = () => {
      for (let i = 0; i + 1 < run.length; i += 2) pairs.push([run[i], run[i + 1]]);
      if (run.length % 2 === 1) singles.push(run[run.length - 1]);
      run = [];
    };
    for (const s of rowSeats) {
      if (run.length > 0 && s.col !== run[run.length - 1].col + 1) flush();
      run.push(s);
    }
    flush();
  }
  return { pairs, singles };
}

// 後ろから「横ペア」で詰めて count 席を選ぶ（欠席者・空席用）。
// 奇数のときは、後ろにある1人席（突き出た席など）を先に使う。
function selectRearSeats(config: ClassConfig, used: Set<string>, count: number): SeatSlot[] | null {
  if (count <= 0) return [];
  const { pairs, singles } = buildDeskPairs(config.seats);
  const ordered: SeatSlot[] = [];
  if (count % 2 === 1) {
    const single = singles.find(s => !used.has(s.id));
    if (single) ordered.push(single);
  }
  for (const [a, b] of pairs) {
    if (!used.has(a.id) && !used.has(b.id)) ordered.push(a, b);
  }
  const included = new Set(ordered.map(s => s.id));
  const remainder = config.seats
    .filter(s => !used.has(s.id) && !included.has(s.id))
    .sort((a, b) => a.row - b.row || a.col - b.col);
  const all = [...ordered, ...remainder];
  return all.length >= count ? all.slice(0, count) : null;
}

// 国・算verで、抜ける授業がある児童を固める後方の席を選ぶ。
// 後ろの行から順に、指定した側（左・中央・右）に寄せて選ぶ。男女席はできるだけ合わせる。
function selectSubjectSeats(config: ClassConfig, leavers: Student[], ignoreGender: boolean): SeatSlot[] {
  // 児童から見て左 = 教師から見て右 = 列番号が大きい側
  const anchor = config.subjectSide === 'left' ? config.cols - 1
    : config.subjectSide === 'right' ? 0
    : (config.cols - 1) / 2;
  const ranked = [...config.seats].sort((a, b) =>
    a.row - b.row || Math.abs(a.col - anchor) - Math.abs(b.col - anchor) || a.col - b.col
  );
  const n = Math.min(leavers.length, ranked.length);
  if (ignoreGender) return ranked.slice(0, n);

  const quota = {
    F: leavers.filter(s => s.gender === 'F').length,
    M: leavers.filter(s => s.gender === 'M').length
  };
  const chosen: SeatSlot[] = [];
  // 後ろの行から見ていき、その行で性別の合う席を優先して取る
  const rows = [...new Set(ranked.map(s => s.row))];
  for (const r of rows) {
    for (const s of ranked.filter(x => x.row === r)) {
      if (chosen.length >= n) break;
      if (quota[s.gender] > 0) {
        quota[s.gender]--;
        chosen.push(s);
      }
    }
    if (quota.F === 0 && quota.M === 0) break;
  }
  // 性別の合う席が足りなければ、後ろから順に埋める
  for (const s of ranked) {
    if (chosen.length >= n) break;
    if (!chosen.includes(s)) chosen.push(s);
  }
  return chosen;
}

// ---- 1候補の生成 ----

interface CandidateOptions {
  mode: ClassMode;
  absent: Set<number>;
  ignoreGender: boolean;
  strictNear: boolean;
  strictSeparate: boolean;
}

function generateCandidate(config: ClassConfig, opt: CandidateOptions): SeatAssignment | null {
  const assignment: SeatAssignment = {};
  const usedSlots = new Set<string>(); // 埋まった席＋空席にすると決めた席
  const usedStudents = new Set<number>();
  const studentById = new Map(config.students.map(s => [s.id, s]));
  const seatOf = new Map<number, SeatSlot>();

  const place = (seat: SeatSlot, studentId: number) => {
    assignment[seat.id] = studentId;
    usedSlots.add(seat.id);
    usedStudents.add(studentId);
    seatOf.set(studentId, seat);
  };
  const freeSeats = () => config.seats.filter(s => !usedSlots.has(s.id));
  const genderOk = (seat: SeatSlot, student: Student) => opt.ignoreGender || seat.gender === student.gender;
  // 性別が合う席を優先して1つ選ぶ（なければ性別を問わず）
  const pickSeat = (candidates: SeatSlot[], student: Student) => {
    const matched = candidates.filter(s => genderOk(s, student));
    return pickRandom(matched.length > 0 ? matched : candidates);
  };
  // 席と児童を、同じ性別どうしを優先して組み合わせる
  const assignPreferGender = (seats: SeatSlot[], students: Student[]) => {
    let restSeats = arrShuffle(seats);
    let restStudents = arrShuffle(students);
    if (!opt.ignoreGender) {
      for (const g of ['F', 'M'] as const) {
        const gs = restSeats.filter(s => s.gender === g);
        const gt = restStudents.filter(s => s.gender === g);
        const n = Math.min(gs.length, gt.length);
        for (let i = 0; i < n; i++) place(gs[i], gt[i].id);
      }
      restSeats = restSeats.filter(s => !usedSlots.has(s.id));
      restStudents = restStudents.filter(s => !usedStudents.has(s.id));
    }
    const n = Math.min(restSeats.length, restStudents.length);
    for (let i = 0; i < n; i++) place(restSeats[i], restStudents[i].id);
  };

  // 1. 国・算ver: 抜ける授業がある児童を後方に固める（欠席でもこの席のまま）
  if (opt.mode === 'subject') {
    const leavers = config.students.filter(s => s.leavesSubject);
    assignPreferGender(selectSubjectSeats(config, leavers, opt.ignoreGender), leavers);
  }

  // 2. 席が人数より多い場合、余る席（空席）を後ろ側に決めておく
  const remainingStudents = () => config.students.filter(s => !usedStudents.has(s.id));
  const emptyCount = freeSeats().length - remainingStudents().length;
  if (emptyCount < 0) return null;
  if (emptyCount > 0) {
    if (opt.ignoreGender) {
      const rear = selectRearSeats(config, usedSlots, emptyCount);
      if (!rear) return null;
      rear.forEach(s => usedSlots.add(s.id));
    } else {
      const seatsF = freeSeats().filter(s => s.gender === 'F').length;
      const studF = remainingStudents().filter(s => s.gender === 'F').length;
      const emptyF = Math.min(emptyCount, Math.max(0, seatsF - studF));
      const emptyM = emptyCount - emptyF;
      for (const [g, n] of [['F', emptyF], ['M', emptyM]] as const) {
        arrShuffle(freeSeats().filter(s => s.gender === g))
          .sort((a, b) => a.row - b.row)
          .slice(0, n)
          .forEach(s => usedSlots.add(s.id));
      }
    }
  }

  // 3. 欠席者を後方へ「横ペアで後ろ詰め」（在席者は前に詰まる）
  const absentToRelocate = remainingStudents().filter(s => opt.absent.has(s.id));
  const absentSeats = selectRearSeats(config, usedSlots, absentToRelocate.length);
  if (!absentSeats) return null;
  arrShuffle(absentToRelocate).forEach((s, i) => place(absentSeats[i], s.id));

  // 4. 前の席にしたい児童を前方の席へ
  const frontStudents = arrShuffle(remainingStudents().filter(s => s.front));
  if (frontStudents.length > 0) {
    const rowsFrontFirst = [...new Set(config.seats.map(s => s.row))].sort((a, b) => b - a);
    for (const student of frontStudents) {
      let zoneRows = config.frontRows;
      let zone: SeatSlot[] = [];
      while (zone.length === 0 && zoneRows <= rowsFrontFirst.length) {
        const rowSet = new Set(rowsFrontFirst.slice(0, zoneRows));
        zone = freeSeats().filter(s => rowSet.has(s.row));
        zoneRows++;
      }
      const seat = pickSeat(zone, student);
      if (!seat) return null;
      place(seat, student.id);
    }
  }

  // 5. 隣にしたい組み合わせを隣（前後左右）に
  let pending = config.nearPairs.filter(([a, b]) => !opt.absent.has(a) && !opt.absent.has(b));
  while (pending.length > 0) {
    let idx = pending.findIndex(([a, b]) => seatOf.has(a) !== seatOf.has(b));
    if (idx === -1) idx = pending.findIndex(([a, b]) => !seatOf.has(a) && !seatOf.has(b));
    if (idx === -1) break; // 残りは両方配置済み（最後に判定）
    const [a, b] = pending[idx];
    pending = pending.filter((_, i) => i !== idx);

    if (!seatOf.has(a) && !seatOf.has(b)) {
      const sa = studentById.get(a)!;
      const withNeighbor = freeSeats().filter(s => freeSeats().some(t => isAdjacent(s, t)));
      const seat = pickSeat(withNeighbor.length > 0 ? withNeighbor : freeSeats(), sa);
      if (!seat) return null;
      place(seat, a);
    }
    const placedId = seatOf.has(a) ? a : b;
    const otherId = placedId === a ? b : a;
    const other = studentById.get(otherId)!;
    const anchorSeat = seatOf.get(placedId)!;
    const neighbors = freeSeats().filter(s => isAdjacent(s, anchorSeat));
    if (neighbors.length === 0) {
      if (opt.strictNear) return null;
      continue; // あとで残りの席に入る
    }
    place(pickSeat(neighbors, other)!, otherId);
  }

  // 6. 残りの児童を残りの席へ
  assignPreferGender(freeSeats(), remainingStudents());
  if (remainingStudents().length > 0) return null;

  // 7. ルールの確認
  const v = findViolations(config, assignment, [...opt.absent]);
  if (opt.strictSeparate && v.separate.length > 0) return null;
  if (opt.strictNear && v.near.length > 0) return null;

  return assignment;
}

function countGenderMismatch(config: ClassConfig, assignment: SeatAssignment, absent: Set<number>): number {
  const seatById = new Map(config.seats.map(s => [s.id, s]));
  const studentById = new Map(config.students.map(s => [s.id, s]));
  let n = 0;
  for (const [slotId, sid] of Object.entries(assignment)) {
    if (absent.has(sid)) continue;
    if (seatById.get(slotId)?.gender !== studentById.get(sid)?.gender) n++;
  }
  return n;
}

export interface ShuffleOptions {
  history?: SeatAssignment[];      // 過去配置（新しいものが先頭）。なるべく同じ席を避ける。
  absentStudentIds?: number[];     // 欠席中の児童ID。後方へ横ペアで移動し、在席者を前に詰める。
  forceGenderFree?: boolean;       // 男女ランダム：欠席がなくても男女席の縛りを外す。
}

export interface ShuffleResult {
  assignment: SeatAssignment;
  warnings: string[]; // 条件をすべては満たせなかったときの説明
}

function pairNames(config: ClassConfig, pairs: StudentPair[]): string {
  const byId = new Map(config.students.map(s => [s.id, s]));
  return pairs
    .map(([a, b]) => `${studentLabel(byId.get(a))}と${studentLabel(byId.get(b))}`)
    .join('、');
}

// 席替えを実行する。
export function shuffleSeats(config: ClassConfig, mode: ClassMode, options: ShuffleOptions = {}): ShuffleResult {
  const history = options.history ?? [];
  const absent = new Set(options.absentStudentIds ?? []);
  // 欠席者がいるときは、空いた席を埋める自由度を確保するため男女席の縛りを外す
  const ignoreGender = (options.forceGenderFree ?? false) || absent.size > 0;

  // きびしい条件から順に試し、見つからなければ少しずつゆるめる
  const passes = [
    { strictNear: true, strictSeparate: true },
    { strictNear: false, strictSeparate: true },
    { strictNear: false, strictSeparate: false }
  ];
  const attemptsPerPass = 800;
  const targetPoolSize = 200;

  let best: SeatAssignment | null = null;
  let bestScore = Infinity;

  for (const pass of passes) {
    let evaluated = 0;
    for (let i = 0; i < attemptsPerPass && evaluated < targetPoolSize; i++) {
      const candidate = generateCandidate(config, { mode, absent, ignoreGender, ...pass });
      if (!candidate) continue;
      evaluated++;
      const v = findViolations(config, candidate, [...absent]);
      const score =
        v.separate.length * 1e9 +
        v.near.length * 1e7 +
        (ignoreGender ? 0 : countGenderMismatch(config, candidate, absent) * 1e5) +
        scoreAgainstHistory(candidate, history);
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
        if (score === 0) break;
      }
    }
    if (best) break;
  }

  if (!best) {
    return {
      assignment: numberOrderAssignment(config),
      warnings: ['条件を満たす配置が見つからなかったため、出席番号順に並べました。座席の数や条件を見直してください。']
    };
  }

  const warnings: string[] = [];
  const v = findViolations(config, best, [...absent]);
  if (v.separate.length > 0) {
    warnings.push(`「隣にしない」組み合わせ（${pairNames(config, v.separate)}）を離せませんでした。手動で入れ替えてください。`);
  }
  if (v.near.length > 0) {
    warnings.push(`「隣にしたい」組み合わせ（${pairNames(config, v.near)}）を隣にできませんでした。`);
  }
  const mismatch = ignoreGender ? 0 : countGenderMismatch(config, best, absent);
  if (mismatch > 0) {
    warnings.push(`男女の人数と男女席の数が合わないなどの理由で、${mismatch}名が異性の席に座っています。`);
  }
  return { assignment: best, warnings };
}
