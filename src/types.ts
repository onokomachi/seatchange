/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type Gender = 'M' | 'F'; // M: 男子, F: 女子

export interface Student {
  id: number; // 出席番号
  name: string; // 名前（空欄なら「○番」と表示）
  kana: string; // ふりがな
  gender: Gender;
  leavesSubject: boolean; // 国語・算数で抜ける授業がある（国・算verで後ろに固める）
  front: boolean; // 前の席にしたい（視力・配慮など）
}

export interface SeatSlot {
  id: string; // "slot_[r]_[c]"
  row: number; // 行インデックス (0 = 最後列/後ろ, rows-1 = 最前列・黒板側)
  col: number; // 列インデックス (教師から見て 0 = 左)
  gender: Gender; // その座席の男女指定
}

// 出席番号の組み合わせ
export type StudentPair = [number, number];

// 国・算verで後ろに固める位置（児童から見て＝黒板に向かって）
export type SubjectSide = 'left' | 'center' | 'right';

export interface ClassConfig {
  version: 1;
  className: string;
  rows: number; // 縦の行数
  cols: number; // 横の列数
  seats: SeatSlot[];
  students: Student[];
  separatePairs: StudentPair[]; // 隣（前後左右）にしない組み合わせ
  nearPairs: StudentPair[]; // 隣（前後左右）にしたい組み合わせ
  frontRows: number; // 「前の席」とみなす範囲（前から何列目まで）
  subjectSide: SubjectSide;
}

export type ViewMode = 'student' | 'teacher'; // student: 児童視点（黒板が上、左右反転）、teacher: 教師視点（黒板が下）
export type ClassMode = 'all' | 'subject'; // all: 全員ver, subject: 国・算ver (抜ける授業がある児童を後ろに固める)

export interface SeatAssignment {
  [slotId: string]: number; // slotId -> student ID
}
