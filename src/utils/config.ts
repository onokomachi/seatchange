/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ClassConfig, Gender, SeatAssignment, SeatSlot, Student, StudentPair, SubjectSide } from '../types';
import {
  DEFAULT_COLS,
  DEFAULT_FRONT_ROWS,
  DEFAULT_ROWS,
  DEFAULT_STUDENT_COUNT,
  MAX_GRID_SIZE,
  MAX_STUDENTS
} from '../constants';

export type GenderPattern = 'stripes' | 'checker';

export const slotId = (row: number, col: number) => `slot_${row}_${col}`;

export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

// 表示用の名前（名前が空欄なら「○番」）
export function studentLabel(student: Student | undefined): string {
  if (!student) return '';
  return student.name.trim() || `${student.id}番`;
}

// 前後左右に隣り合っているか
export function isAdjacent(a: { row: number; col: number }, b: { row: number; col: number }): boolean {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;
}

// 縦じま: 列ごとに女子/男子を交互に（横の隣は異性・前後は同性）
// 市松: 前後左右すべて異性
export function genderForPattern(row: number, col: number, pattern: GenderPattern): Gender {
  if (pattern === 'checker') return (row + col) % 2 === 0 ? 'F' : 'M';
  return col % 2 === 0 ? 'F' : 'M';
}

export function makeFullLayout(rows: number, cols: number, pattern: GenderPattern = 'stripes'): SeatSlot[] {
  const seats: SeatSlot[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      seats.push({ id: slotId(r, c), row: r, col: c, gender: genderForPattern(r, c, pattern) });
    }
  }
  return seats;
}

export function applyGenderPattern(seats: SeatSlot[], pattern: GenderPattern): SeatSlot[] {
  return seats.map(s => ({ ...s, gender: genderForPattern(s.row, s.col, pattern) }));
}

// マス目の大きさを変える。行は「最前列（黒板側）」を基準に保ち、増減は後ろ側で行う。列は右側（教師から見て）で増減する。
export function resizeLayout(seats: SeatSlot[], oldRows: number, newRows: number, newCols: number): SeatSlot[] {
  const shift = newRows - oldRows;
  return seats
    .map(s => ({ ...s, row: s.row + shift }))
    .filter(s => s.row >= 0 && s.row < newRows && s.col < newCols)
    .map(s => ({ ...s, id: slotId(s.row, s.col) }));
}

export function sortSeats(seats: SeatSlot[]): SeatSlot[] {
  return [...seats].sort((a, b) => a.row - b.row || a.col - b.col);
}

export function makeStudent(id: number): Student {
  return { id, name: '', kana: '', gender: id % 2 === 0 ? 'M' : 'F', leavesSubject: false, front: false };
}

// 出席番号の上限に合わせて名簿を増減する（入力済みの内容は残す）
export function resizeRoster(students: Student[], count: number): Student[] {
  const byId = new Map(students.map(s => [s.id, s]));
  const next: Student[] = [];
  for (let id = 1; id <= count; id++) {
    next.push(byId.get(id) ?? makeStudent(id));
  }
  return next;
}

// 名簿から消えた児童を含む組み合わせを取り除く
export function prunePairs(pairs: StudentPair[], students: Student[]): StudentPair[] {
  const ids = new Set(students.map(s => s.id));
  return pairs.filter(([a, b]) => a !== b && ids.has(a) && ids.has(b));
}

export function createDefaultConfig(): ClassConfig {
  return {
    version: 1,
    className: '',
    rows: DEFAULT_ROWS,
    cols: DEFAULT_COLS,
    seats: makeFullLayout(DEFAULT_ROWS, DEFAULT_COLS),
    students: resizeRoster([], DEFAULT_STUDENT_COUNT),
    separatePairs: [],
    nearPairs: [],
    frontRows: DEFAULT_FRONT_ROWS,
    subjectSide: 'left'
  };
}

// ---- 名簿の貼り付け ----

export interface ParsedRosterRow {
  id?: number;
  name: string;
  kana: string;
  gender?: Gender;
}

const KANA_RE = /^[ぁ-ゟ゠-ヿーー・\s　]+$/;
const isKana = (t: string) => KANA_RE.test(t);

function toHalfWidthDigits(t: string): string {
  return t.replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
}

function parseGender(t: string): Gender | undefined {
  const v = t.trim().toLowerCase();
  if (['男', '男子', 'm', 'male', '♂'].includes(v)) return 'M';
  if (['女', '女子', 'f', 'female', '♀'].includes(v)) return 'F';
  return undefined;
}

function parseId(t: string): number | undefined {
  const v = toHalfWidthDigits(t.trim()).replace(/番$/, '');
  return /^\d+$/.test(v) ? parseInt(v, 10) : undefined;
}

// Excel等からコピーした名簿を読み取る。
// 1行1人。タブ区切り（Excelのコピー）・カンマ区切り・スペース区切りに対応。
// 「番号」「名前」「ふりがな」「男/女」を自動で見分ける（順番は自由、番号・ふりがな・性別は省略可）。
export function parseRoster(text: string): ParsedRosterRow[] {
  const rows: ParsedRosterRow[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const hasCells = /[\t,，]/.test(line);
    const tokens = (hasCells ? line.split(/[\t,，]/) : line.split(/[\s　]+/))
      .map(t => t.trim())
      .filter(t => t.length > 0);

    let id: number | undefined;
    let gender: Gender | undefined;
    const rest: string[] = [];
    tokens.forEach((t, i) => {
      const asId = parseId(t);
      if (i === 0 && asId !== undefined) { id = asId; return; }
      const g = parseGender(t);
      if (g && gender === undefined) { gender = g; return; }
      rest.push(t);
    });

    // 見出し行（「番号」「名前」など）はスキップ
    if (id === undefined && rest.some(t => /^(番号|出席番号|名前|氏名|ふりがな|よみがな|性別)$/.test(t))) continue;
    if (rest.length === 0 && id === undefined) continue;

    let name = '';
    let kana = '';
    if (hasCells) {
      const nameCells = rest.filter(t => !isKana(t));
      const kanaCells = rest.filter(t => isKana(t));
      if (nameCells.length === 0 && kanaCells.length > 0) {
        name = kanaCells.shift() ?? '';
      }
      name = name || nameCells.join(' ');
      kana = kanaCells.join(' ');
    } else {
      // スペース区切り: 後ろ側の「かなだけの語」をふりがなとみなす（名前より多くならない範囲で）
      let split = rest.length;
      for (let k = 1; k < rest.length; k++) {
        if (rest.slice(k).every(isKana) && rest.length - k <= k) { split = k; break; }
      }
      name = rest.slice(0, split).join(' ');
      kana = rest.slice(split).join(' ');
    }

    rows.push({ id, name, kana, gender });
  }
  return rows;
}

// 読み取った名簿を既存の名簿に反映する（性別が書かれていない行は今の設定を残す）
export function applyParsedRoster(current: Student[], parsed: ParsedRosterRow[]): Student[] {
  const withIds = parsed.map((row, i) => ({ ...row, id: row.id ?? i + 1 }))
    .filter(row => row.id >= 1 && row.id <= MAX_STUDENTS);
  if (withIds.length === 0) return current;
  const maxId = Math.max(current.length, ...withIds.map(r => r.id));
  const roster = resizeRoster(current, maxId);
  return roster.map(s => {
    const row = withIds.find(r => r.id === s.id);
    if (!row) return s;
    return { ...s, name: row.name, kana: row.kana, gender: row.gender ?? s.gender };
  });
}

// ---- 設定の検証（ファイル読み込み・保存データ用） ----

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function sanitizePairs(raw: unknown, ids: Set<number>): StudentPair[] {
  if (!Array.isArray(raw)) return [];
  const out: StudentPair[] = [];
  for (const p of raw) {
    if (Array.isArray(p) && p.length === 2 && ids.has(p[0]) && ids.has(p[1]) && p[0] !== p[1]) {
      out.push([p[0], p[1]]);
    }
  }
  return out;
}

export function sanitizeConfig(raw: unknown): ClassConfig | null {
  if (!isObj(raw)) return null;
  const rows = clampInt(Number(raw.rows), 1, MAX_GRID_SIZE);
  const cols = clampInt(Number(raw.cols), 1, MAX_GRID_SIZE);
  if (!Array.isArray(raw.seats) || !Array.isArray(raw.students)) return null;

  const seatMap = new Map<string, SeatSlot>();
  for (const s of raw.seats) {
    if (!isObj(s)) continue;
    const row = Number(s.row);
    const col = Number(s.col);
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= rows || col < 0 || col >= cols) continue;
    const id = slotId(row, col);
    seatMap.set(id, { id, row, col, gender: s.gender === 'M' ? 'M' : 'F' });
  }

  const students: Student[] = [];
  const seen = new Set<number>();
  for (const s of raw.students) {
    if (!isObj(s)) continue;
    const id = Number(s.id);
    if (!Number.isInteger(id) || id < 1 || id > MAX_STUDENTS || seen.has(id)) continue;
    seen.add(id);
    students.push({
      id,
      name: typeof s.name === 'string' ? s.name.slice(0, 40) : '',
      kana: typeof s.kana === 'string' ? s.kana.slice(0, 40) : '',
      gender: s.gender === 'M' ? 'M' : 'F',
      leavesSubject: s.leavesSubject === true,
      front: s.front === true
    });
  }
  if (students.length === 0) return null;
  students.sort((a, b) => a.id - b.id);

  const ids = new Set(students.map(s => s.id));
  const side: SubjectSide = raw.subjectSide === 'right' || raw.subjectSide === 'center' ? raw.subjectSide : 'left';

  return {
    version: 1,
    className: typeof raw.className === 'string' ? raw.className.slice(0, 40) : '',
    rows,
    cols,
    seats: sortSeats([...seatMap.values()]),
    students,
    separatePairs: sanitizePairs(raw.separatePairs, ids),
    nearPairs: sanitizePairs(raw.nearPairs, ids),
    frontRows: clampInt(Number(raw.frontRows ?? DEFAULT_FRONT_ROWS), 1, MAX_GRID_SIZE),
    subjectSide: side
  };
}

// 席に対して配置データが正しいか（全員が1回ずつ、存在する席に座っている）
export function isAssignmentValid(config: ClassConfig, assignment: unknown): assignment is SeatAssignment {
  if (!isObj(assignment)) return false;
  const seatIds = new Set(config.seats.map(s => s.id));
  const studentIds = new Set(config.students.map(s => s.id));
  const placed = new Set<number>();
  for (const [sid, stu] of Object.entries(assignment)) {
    if (!seatIds.has(sid) || typeof stu !== 'number' || !studentIds.has(stu) || placed.has(stu)) return false;
    placed.add(stu);
  }
  return placed.size === studentIds.size;
}

// 出席番号順に並べる（最前列から、児童から見て左→右）
export function numberOrderAssignment(config: ClassConfig): SeatAssignment {
  const ordered = [...config.seats].sort((a, b) => b.row - a.row || b.col - a.col);
  const assignment: SeatAssignment = {};
  config.students.forEach((s, i) => {
    if (ordered[i]) assignment[ordered[i].id] = s.id;
  });
  return assignment;
}
