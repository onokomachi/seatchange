/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// 「なるべく同じ席にならないように」するための、過去配置の記録上限（直近この件数を考慮）
export const SEAT_HISTORY_LIMIT = 10;

// 設定画面で指定できる上限
export const MAX_STUDENTS = 60;
export const MAX_GRID_SIZE = 12;

// はじめて開いたときの既定値
export const DEFAULT_STUDENT_COUNT = 30;
export const DEFAULT_ROWS = 5;
export const DEFAULT_COLS = 6;
export const DEFAULT_FRONT_ROWS = 2;

// 設定ファイル（書き出し/読み込み）の識別子
export const EXPORT_FILE_KIND = 'seatchange-class-config';
