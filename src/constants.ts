/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Student, SeatSlot, SeatAssignment } from './types';

export const STUDENTS: Student[] = [
  { id: 1, name: "阿佐美 桜", kana: "あざみ さくら", gender: "F" },
  { id: 2, name: "阿部 渚煌", kana: "あべ なつき", gender: "M" },
  { id: 3, name: "池田 蘭奈", kana: "いけだ らんな", gender: "F" },
  { id: 4, name: "今井 健翔", kana: "いまい けんと", gender: "M" },
  { id: 5, name: "牛山 結愛", kana: "うしやま ゆいな", gender: "F" },
  { id: 6, name: "大竹 想", kana: "おおたけ そう", gender: "M" },
  { id: 7, name: "小柏 翔琉", kana: "おがしわ かける", gender: "M" },
  { id: 8, name: "押田 つむぎ", kana: "おしだ つむぎ", gender: "F" },
  { id: 9, name: "川島 愛咲", kana: "かわしま あみ", gender: "F" },
  { id: 10, name: "栗原 希乃羽", kana: "くりばら ののは", gender: "F" },
  { id: 11, name: "小島 快斗", kana: "こじま かいと", gender: "M" },
  { id: 12, name: "須藤 來愛", kana: "すとう くれあ", gender: "F" },
  { id: 13, name: "束田 千花", kana: "つかだ ちか", gender: "F" },
  { id: 14, name: "土屋 柊奈", kana: "つちや ひな", gender: "F" },
  { id: 15, name: "堤 陽香", kana: "つつみ はるか", gender: "F" },
  { id: 16, name: "富沢 悦那", kana: "とみざわ えつな", gender: "F" },
  { id: 17, name: "豊田 美怜", kana: "とよだ みれい", gender: "F" },
  { id: 18, name: "長嶋 優月", kana: "ながしま ゆづき", gender: "M" },
  { id: 19, name: "長沼 幸弥", kana: "ながぬま ゆきや", gender: "M" },
  { id: 20, name: "中野 健", kana: "なかの たける", gender: "M" },
  { id: 21, name: "沼守 優月", kana: "ぬまもり ゆづき", gender: "M" },
  { id: 22, name: "萩原 大地", kana: "はぎわら だいち", gender: "M" },
  { id: 23, name: "橋本 つき", kana: "はしもと つき", gender: "F" },
  { id: 24, name: "前原 葵", kana: "まえはら あおい", gender: "F" },
  { id: 25, name: "松尾 穂", kana: "まつお みのり", gender: "F" },
  { id: 26, name: "三鼓 絵美", kana: "みつづみ えみ", gender: "F" },
  { id: 27, name: "三輪 朔稔", kana: "みわ さくなり", gender: "M" },
  { id: 28, name: "柳井 葵音", kana: "やなぎい あおと", gender: "M" },
  { id: 29, name: "山岸 新", kana: "やまぎし あらた", gender: "M" },
  { id: 30, name: "山﨑 梛菜美", kana: "やまざき ななみ", gender: "F" },
  { id: 31, name: "渡邉 竣太", kana: "わたなべ しゅんた", gender: "M" }
];

export const SEAT_SLOTS: SeatSlot[] = [
  // 行0: 後ろ側の突き出た席（須藤がいた場所）
  { id: "slot_0_5", row: 0, col: 5, gender: "F" },

  // 行1: 後ろから2列目
  { id: "slot_1_0", row: 1, col: 0, gender: "F" },
  { id: "slot_1_1", row: 1, col: 1, gender: "F" },
  { id: "slot_1_2", row: 1, col: 2, gender: "F" },
  { id: "slot_1_3", row: 1, col: 3, gender: "M" },
  { id: "slot_1_4", row: 1, col: 4, gender: "F" },
  { id: "slot_1_5", row: 1, col: 5, gender: "M" },

  // 行2
  { id: "slot_2_0", row: 2, col: 0, gender: "M" },
  { id: "slot_2_1", row: 2, col: 1, gender: "F" },
  { id: "slot_2_2", row: 2, col: 2, gender: "F" },
  { id: "slot_2_3", row: 2, col: 3, gender: "M" },
  { id: "slot_2_4", row: 2, col: 4, gender: "F" },
  { id: "slot_2_5", row: 2, col: 5, gender: "F" },

  // 行3
  { id: "slot_3_0", row: 3, col: 0, gender: "M" },
  { id: "slot_3_1", row: 3, col: 1, gender: "F" },
  { id: "slot_3_2", row: 3, col: 2, gender: "F" },
  { id: "slot_3_3", row: 3, col: 3, gender: "M" },
  { id: "slot_3_4", row: 3, col: 4, gender: "F" },
  { id: "slot_3_5", row: 3, col: 5, gender: "M" },

  // 行4
  { id: "slot_4_0", row: 4, col: 0, gender: "F" },
  { id: "slot_4_1", row: 4, col: 1, gender: "M" },
  { id: "slot_4_2", row: 4, col: 2, gender: "F" },
  { id: "slot_4_3", row: 4, col: 3, gender: "M" },
  { id: "slot_4_4", row: 4, col: 4, gender: "F" },
  { id: "slot_4_5", row: 4, col: 5, gender: "M" },

  // 行5: 最前列（黒板側）
  { id: "slot_5_0", row: 5, col: 0, gender: "F" },
  { id: "slot_5_1", row: 5, col: 1, gender: "M" },
  { id: "slot_5_2", row: 5, col: 2, gender: "M" },
  { id: "slot_5_3", row: 5, col: 3, gender: "F" },
  { id: "slot_5_4", row: 5, col: 4, gender: "M" },
  { id: "slot_5_5", row: 5, col: 5, gender: "M" }
];

export const INITIAL_ASSIGNMENT: SeatAssignment = {
  "slot_0_5": 12, // 須藤
  "slot_1_0": 3,  // 池田
  "slot_1_1": 14, // 土屋
  "slot_1_2": 24, // 前原
  "slot_1_3": 4,  // 今井
  "slot_1_4": 17, // 豊田
  "slot_1_5": 2,  // 阿部
  "slot_2_0": 18, // 長嶋
  "slot_2_1": 8,  // 押田
  "slot_2_2": 1,  // 阿佐美
  "slot_2_3": 29, // 山岸
  "slot_2_4": 16, // 富沢
  "slot_2_5": 25, // 松尾
  "slot_3_0": 31, // 渡邉
  "slot_3_1": 26, // 三鼓
  "slot_3_2": 5,  // 牛山
  "slot_3_3": 20, // 中野
  "slot_3_4": 9,  // 川島
  "slot_3_5": 6,  // 大竹
  "slot_4_0": 15, // 堤
  "slot_4_1": 21, // 沼守
  "slot_4_2": 13, // 束田
  "slot_4_3": 22, // 萩原
  "slot_4_4": 30, // 山﨑
  "slot_4_5": 7,  // 小柏
  "slot_5_0": 10, // 栗原
  "slot_5_1": 27, // 三輪
  "slot_5_2": 28, // 柳井
  "slot_5_3": 23, // 橋本
  "slot_5_4": 11, // 小島
  "slot_5_5": 19  // 長沼
};

// 国・算において後ろに固めるスロットID
// ユーザー指定：現在の 17, 2, 12 の部分
// 元々 17番: "slot_1_4" (F), 2番: "slot_1_5" (M), 12番: "slot_0_5" (F)
export const SUBJECT_FIXED_SLOTS = {
  female1: "slot_1_4", // 17番の位置
  female2: "slot_0_5", // 12番の位置
  male: "slot_1_5"     // 2番の位置
};

export const SUBJECT_FIXED_STUDENTS = {
  female1_id: 24, // 前原 (F)
  female2_id: 26, // 三鼓 (F)
  male_id: 19     // 長沼 (M)
};
