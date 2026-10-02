/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Student {
  id: number;
  name: string;
  kana: string;
  gender: 'M' | 'F'; // M: 男子, F: 女子
}

export interface SeatSlot {
  id: string; // "slot_[r]_[c]"
  row: number; // 教師用行インデックス (0 = 最上段/後ろ, 5 = 最下段/最前列・黒板側)
  col: number; // 教師用列インデックス (0 = 左, 5 = 右)
  gender: 'M' | 'F'; // その座席に座ることができる性別 (固定)
}

export type ViewMode = 'student' | 'teacher'; // student: 児童視点（黒板が上、左右反転）、teacher: 教師視点（黒板が下、画像と同じ）
export type ClassMode = 'all' | 'subject'; // all: 全員ver, subject: 国・算ver (長沼・三鼓・前原が後ろに固定)

export interface SeatAssignment {
  [slotId: string]: number; // slotId -> student ID
}
