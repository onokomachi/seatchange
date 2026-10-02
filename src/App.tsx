/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Users, 
  BookOpen, 
  RotateCw, 
  ArrowLeftRight, 

  Printer, 
  Download, 
  Save, 
  Trash2, 
  History, 
  Check, 
  HelpCircle,
  Sparkles,
  Info,
  Layers,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Eye,
  EyeOff,
  UserCheck2,
  Lock,
  Unlock,
  ClipboardCheck,
  Eraser,
  UserX,
  UserCheck,
  Shuffle,
  Settings,
  ListOrdered,
  ArrowUpToLine,
  X
} from 'lucide-react';

import { ViewMode, ClassMode, SeatAssignment, ClassConfig, Student, SeatSlot } from './types';
import { SEAT_HISTORY_LIMIT, EXPORT_FILE_KIND } from './constants';
import { shuffleSeats, findViolations, ShuffleResult } from './utils/shuffle';
import {
  createDefaultConfig,
  isAssignmentValid,
  numberOrderAssignment,
  sanitizeConfig,
  studentLabel
} from './utils/config';
import SettingsModal from './components/SettingsModal';

// 安全なローカルストレージのラッパー (IFrameやプライベートモードでのSecurityErrorを制御するため)
const safeLocalStorage = {
  getItem(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      console.warn(`localStorage.getItem "${key}" blocked:`, e);
      return null;
    }
  },
  setItem(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      console.warn(`localStorage.setItem "${key}" blocked:`, e);
    }
  },
  removeItem(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.warn(`localStorage.removeItem "${key}" blocked:`, e);
    }
  }
};

type SavedLog = { id: string; timestamp: string; name: string; mode: ClassMode; assignment: SeatAssignment };

const CONFIG_KEY = 'seat_class_config';

function loadSavedConfig(): ClassConfig | null {
  const raw = safeLocalStorage.getItem(CONFIG_KEY);
  if (!raw) return null;
  try {
    return sanitizeConfig(JSON.parse(raw));
  } catch (e) {
    console.error(e);
    return null;
  }
}

// 「前の席」とみなす行（前から frontRows 行ぶん。席のない行は数えない）
function frontRowSetOf(config: ClassConfig): Set<number> {
  const rows = [...new Set(config.seats.map(s => s.row))].sort((a, b) => b - a);
  return new Set(rows.slice(0, config.frontRows));
}

export default function App() {
  // ---- 状態管理 ----
  // クラス設定（名簿・座席の形・配慮）。初回は既定値で設定画面を開く。
  const [config, setConfig] = useState<ClassConfig>(() => loadSavedConfig() ?? createDefaultConfig());
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [isFirstRun, setIsFirstRun] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<ViewMode>('student'); // 既定は「逆から見た図(黒板上/児童視点)」
  const [classMode, setClassMode] = useState<ClassMode>('all'); // 既定は「全員ver」
  const [assignment, setAssignment] = useState<SeatAssignment>({});
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null); // 手動微調整用の選択スロット
  const [logs, setLogs] = useState<SavedLog[]>([]);
  const [currentLogName, setCurrentLogName] = useState<string>('');
  const [showHelp, setShowHelp] = useState<boolean>(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ message: string; onConfirm: () => void } | null>(null);
  // 「同じ席を避ける」ための過去配置の記録（新しいものが先頭）。名前付き履歴とは別管理。
  const [seatHistory, setSeatHistory] = useState<SeatAssignment[]>([]);
  // 欠席中の児童IDリスト。シャッフルでは後方へまとめ、在席者を前に詰める。
  const [absentStudentIds, setAbsentStudentIds] = useState<number[]>([]);
  // 男女ランダムでシャッフルされた配置かどうか（trueのとき手動入れ替えで男女席の縛りをかけない）
  const [isGenderFreeAssignment, setIsGenderFreeAssignment] = useState<boolean>(false);
  // 席替えで条件をすべて満たせなかったときの説明（次の席替えまで表示）
  const [shuffleWarnings, setShuffleWarnings] = useState<string[]>([]);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const studentById = new Map<number, Student>(config.students.map(s => [s.id, s]));
  const seatById = new Map<string, SeatSlot>(config.seats.map(s => [s.id, s]));
  const nameOf = (id: number) => studentLabel(studentById.get(id));

  // コンフィグ保存・読込 (Local Storage)
  useEffect(() => {
    const savedConfig = loadSavedConfig();
    if (!savedConfig) {
      // はじめて使うとき：設定画面から始める
      setIsFirstRun(true);
      setShowSettings(true);
    }
    const cfg = savedConfig ?? config;

    const savedLogs = safeLocalStorage.getItem('seat_assignment_history');
    if (savedLogs) {
      try {
        const parsedLogs = JSON.parse(savedLogs);
        if (Array.isArray(parsedLogs)) {
          setLogs(parsedLogs);
        } else {
          safeLocalStorage.removeItem('seat_assignment_history');
        }
      } catch (e) {
        console.error(e);
      }
    }

    // 欠席者リストを読み込む（名簿にいない番号は除く）
    let loadedAbsent: number[] = [];
    const savedAbsent = safeLocalStorage.getItem('seat_absent_students');
    if (savedAbsent) {
      try {
        const parsed = JSON.parse(savedAbsent);
        if (Array.isArray(parsed)) {
          loadedAbsent = parsed.filter(id => cfg.students.some(s => s.id === id));
          setAbsentStudentIds(loadedAbsent);
        } else {
          safeLocalStorage.removeItem('seat_absent_students');
        }
      } catch (e) { console.error(e); }
    }

    // 「同じ席を避ける」ための記録を読み込む
    const savedSeatHistory = safeLocalStorage.getItem('seat_avoid_history');
    if (savedSeatHistory) {
      try {
        const parsed = JSON.parse(savedSeatHistory);
        if (Array.isArray(parsed)) {
          setSeatHistory(parsed);
        } else {
          safeLocalStorage.removeItem('seat_avoid_history');
        }
      } catch (e) {
        console.error(e);
      }
    }

    const savedClassMode = safeLocalStorage.getItem('seat_current_class_mode');
    const mode: ClassMode = savedClassMode === 'subject' ? 'subject' : 'all';
    setClassMode(mode);

    if (!savedConfig) return;
    let restored = false;
    const savedCurrent = safeLocalStorage.getItem('seat_current_assignment');
    if (savedCurrent) {
      try {
        const parsed = JSON.parse(savedCurrent);
        if (isAssignmentValid(cfg, parsed)) {
          setAssignment(parsed);
          restored = true;
        } else {
          console.warn('Saved assignment does not match class config - reshuffling');
        }
      } catch (e) {
        console.error(e);
      }
    }
    if (!restored) {
      const result = shuffleSeats(cfg, mode, { absentStudentIds: loadedAbsent });
      setAssignment(result.assignment);
      setShuffleWarnings(result.warnings);
      saveCurrentAssignment(result.assignment, mode);
    }
  }, []);

  const saveCurrentAssignment = (newAssign: SeatAssignment, mode: ClassMode) => {
    safeLocalStorage.setItem('seat_current_assignment', JSON.stringify(newAssign));
    safeLocalStorage.setItem('seat_current_class_mode', mode);
  };

  // 一時通知メッセージの表示
  const triggerFeedback = (text: string, type: 'success' | 'error' | 'info' = 'success') => {
    setFeedbackMsg({ text, type });
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setFeedbackMsg(null), 4000);
  };

  // シャッフル結果を画面に反映する
  const applyShuffleResult = (result: ShuffleResult, mode: ClassMode, genderFree: boolean) => {
    setAssignment(result.assignment);
    setIsGenderFreeAssignment(genderFree);
    setShuffleWarnings(result.warnings);
    saveCurrentAssignment(result.assignment, mode);
    setSelectedSlot(null);
  };

  const ruleSummary = () => {
    const parts: string[] = [];
    if (config.separatePairs.length > 0) parts.push(`隣にしない${config.separatePairs.length}組`);
    if (config.nearPairs.length > 0) parts.push(`隣にしたい${config.nearPairs.length}組`);
    return parts.length > 0 ? `・${parts.join('・')}を考慮` : '';
  };

  // ---- 席替え実行 (シャフル) ----
  const handleShuffle = () => {
    // 記録済みの過去配置を避け、欠席者を後方へ詰めながらシャッフルする
    const result = shuffleSeats(config, classMode, {
      history: seatHistory,
      absentStudentIds
    });
    applyShuffleResult(result, classMode, false);
    const absCnt = absentStudentIds.length;
    triggerFeedback(
      absCnt > 0
        ? `席替えを完了しました！（${absCnt}名欠席・休みの席は後方へまとめ、在席者を前に詰めました${ruleSummary()}）`
        : seatHistory.length > 0
          ? `席替えを完了しました！（過去${seatHistory.length}回ぶんの席をなるべく避けました${ruleSummary()}）`
          : `席替えを完了しました！${ruleSummary() ? `（${ruleSummary().slice(1)}）` : ''}`,
      result.warnings.length > 0 ? 'info' : 'success'
    );
  };

  // ---- 男女ランダムシャッフル（男女席の固定を外して完全ランダム・配慮の組み合わせは守る） ----
  const handleRandomShuffle = () => {
    const result = shuffleSeats(config, classMode, {
      history: seatHistory,
      absentStudentIds,
      forceGenderFree: true
    });
    applyShuffleResult(result, classMode, true);
    const absCnt = absentStudentIds.length;
    triggerFeedback(
      absCnt > 0
        ? `男女ランダムで席替えしました！（${absCnt}名欠席・休みは後方へ${ruleSummary()}）`
        : `男女ランダムで席替えしました！（男女席の固定なし${ruleSummary()}）`,
      result.warnings.length > 0 ? 'info' : 'success'
    );
  };

  // ---- 欠席のトグル ----
  const toggleAbsent = (studentId: number) => {
    const isCurrentlyAbsent = absentStudentIds.includes(studentId);
    const next = isCurrentlyAbsent
      ? absentStudentIds.filter(id => id !== studentId)
      : [...absentStudentIds, studentId];
    setAbsentStudentIds(next);
    safeLocalStorage.setItem('seat_absent_students', JSON.stringify(next));
    const name = nameOf(studentId);
    triggerFeedback(
      isCurrentlyAbsent
        ? `${name} の欠席を解除しました。次のシャッフルから再び対象になります。`
        : `${name} を欠席に設定しました。もう一度押すと解除。シャッフルでは後方へまとめます。`,
      'info'
    );
  };

  // ---- 欠席を全員解除 ----
  const handleClearAbsent = () => {
    setAbsentStudentIds([]);
    safeLocalStorage.removeItem('seat_absent_students');
    triggerFeedback('全員の欠席を解除しました。', 'info');
  };

  // ---- 現在の配置を「記録」（次回以降、同じ席をなるべく避けるため） ----
  const handleRecordSeats = () => {
    // 新しい記録を先頭に追加し、直近 SEAT_HISTORY_LIMIT 件のみ保持する
    const nextSeatHistory = [assignment, ...seatHistory].slice(0, SEAT_HISTORY_LIMIT);
    setSeatHistory(nextSeatHistory);
    safeLocalStorage.setItem('seat_avoid_history', JSON.stringify(nextSeatHistory));
    triggerFeedback(
      `現在の席を記録しました。次回からこの席をなるべく避けます。（記録${nextSeatHistory.length}件）`,
      'success'
    );
  };

  // ---- 「同じ席を避ける」記録をすべて消去 ----
  const handleClearSeatHistory = () => {
    setConfirmModal({
      message: '「同じ席を避ける」ための記録をすべて消去しますか？（名前を付けて保存した履歴は消えません）',
      onConfirm: () => {
        setSeatHistory([]);
        safeLocalStorage.removeItem('seat_avoid_history');
        triggerFeedback('記録を消去しました。', 'info');
      }
    });
  };

  // ---- 出席番号順に並べる ----
  const handleNumberOrder = () => {
    setConfirmModal({
      message: '出席番号順に並べ直しますか？（欠席設定も解除されます）',
      onConfirm: () => {
        const next = numberOrderAssignment(config);
        setAssignment(next);
        setClassMode('all');
        setIsGenderFreeAssignment(true);
        setShuffleWarnings([]);
        saveCurrentAssignment(next, 'all');
        setSelectedSlot(null);
        setAbsentStudentIds([]);
        safeLocalStorage.removeItem('seat_absent_students');
        triggerFeedback('出席番号順に並べました。欠席設定も解除されました。', 'info');
      }
    });
  };

  // 国・算verで「後ろに固めた」児童の席（＝抜ける授業がある児童が座っている席）
  const subjectSeatIds = new Set<string>(
    classMode === 'subject'
      ? Object.entries(assignment).filter(([, sid]) => studentById.get(sid as number)?.leavesSubject).map(([slot]) => slot)
      : []
  );

  // ---- 席の手動入れ替え (微調整) ----
  const handleSlotClick = (slotId: string) => {
    if (!selectedSlot) {
      // 1つ目の席を選択
      setSelectedSlot(slotId);
      triggerFeedback(
        assignment[slotId] !== undefined
          ? '交代するもう一方の座席を選択してください。もう一度同じ席を押すと欠席に設定します。'
          : 'この空席に移動させる児童の席を選択してください。',
        'info'
      );
      return;
    }

    // 同じ席を2回押した → 欠席をトグル
    if (selectedSlot === slotId) {
      if (assignment[slotId] !== undefined) toggleAbsent(assignment[slotId]);
      setSelectedSlot(null);
      return;
    }

    const slot1 = seatById.get(selectedSlot);
    const slot2 = seatById.get(slotId);
    const student1Id = assignment[selectedSlot];
    const student2Id = assignment[slotId];

    if (!slot1 || !slot2 || (student1Id === undefined && student2Id === undefined)) {
      setSelectedSlot(null);
      return;
    }

    // 制約1: 欠席者の席は入れ替え不可
    if (absentStudentIds.includes(student1Id) || absentStudentIds.includes(student2Id)) {
      triggerFeedback('欠席者の席は入れ替えできません。欠席を解除してから操作してください。', 'error');
      setSelectedSlot(null);
      return;
    }

    // 制約2: 男女固定席のルール（男女ランダム配置・欠席者がいる「調整中」は縛りを外す）
    // 異性の席へ移ることで、今より男女のずれが増える入れ替えだけを止める
    if (!isGenderFreeAssignment && absentStudentIds.length === 0) {
      const worsens = (studentId: number | undefined, from: typeof slot1, to: typeof slot1) => {
        const g = studentId !== undefined ? studentById.get(studentId)?.gender : undefined;
        return g !== undefined && g === from.gender && g !== to.gender;
      };
      if (worsens(student1Id, slot1, slot2) || worsens(student2Id, slot2, slot1)) {
        triggerFeedback('男子用の席と女子用の席を入れ替えることはできません。（男女固定席ルール／男女ランダムで席替えすると自由に動かせます）', 'error');
        setSelectedSlot(null);
        return;
      }
    }

    // 制約3: 国・算verで後ろに固めた児童は、固めた席どうしでのみ入れ替え可
    if (classMode === 'subject' && subjectSeatIds.has(selectedSlot) !== subjectSeatIds.has(slotId)) {
      triggerFeedback('国・算verでは、後ろに固めた児童（国・算で抜ける児童）を一般席に動かすことはできません。', 'error');
      setSelectedSlot(null);
      return;
    }

    // 新しいアサインメントを試作
    const nextAssignment: SeatAssignment = { ...assignment };
    delete nextAssignment[selectedSlot];
    delete nextAssignment[slotId];
    if (student2Id !== undefined) nextAssignment[selectedSlot] = student2Id;
    if (student1Id !== undefined) nextAssignment[slotId] = student1Id;

    // 制約4: 「隣にしない」組み合わせが隣になる入れ替えは不可
    const before = findViolations(config, assignment, absentStudentIds);
    const after = findViolations(config, nextAssignment, absentStudentIds);
    if (after.separate.length > before.separate.length) {
      const [a, b] = after.separate.find(p => !before.separate.some(q => q[0] === p[0] && q[1] === p[1]))!;
      triggerFeedback(`警告：入れ替えにより、${nameOf(a)}と${nameOf(b)}が隣になってしまうため、実行できません。（隣にしない組み合わせ）`, 'error');
      setSelectedSlot(null);
      return;
    }

    // 全てクリアしたら入れ替え実行
    setAssignment(nextAssignment);
    saveCurrentAssignment(nextAssignment, classMode);
    setSelectedSlot(null);

    // 「隣にしたい」「前の席」は希望なので、崩れたときは注意だけ表示する
    const notes: string[] = [];
    if (after.near.length > before.near.length) notes.push('「隣にしたい」組み合わせが離れました');
    const frontRowSet = frontRowSetOf(config);
    const movedOutOfFront = [student1Id, student2Id].some(id => {
      if (id === undefined || !studentById.get(id)?.front) return false;
      const newSlot = id === student1Id ? slot2 : slot1;
      return !frontRowSet.has(newSlot.row);
    });
    if (movedOutOfFront) notes.push('「前の席」の児童が前方から外れました');
    if (notes.length > 0) {
      triggerFeedback(`座席を入れ替えました。（注意：${notes.join('・')}）`, 'info');
    } else {
      triggerFeedback(student1Id === undefined || student2Id === undefined ? '空席へ移動しました！' : '座席を入れ替えました！', 'success');
    }
  };

  // ---- 履歴（保存・復元・削除） ----
  const handleSaveToHistory = () => {
    const name = currentLogName.trim() || `${new Date().toLocaleDateString('ja-JP')} 席替え`;
    const newLog: SavedLog = {
      id: Date.now().toString(),
      timestamp: new Date().toLocaleString('ja-JP'),
      name,
      mode: classMode,
      assignment
    };

    const nextLogs = [newLog, ...logs];
    setLogs(nextLogs);
    safeLocalStorage.setItem('seat_assignment_history', JSON.stringify(nextLogs));
    setCurrentLogName('');
    triggerFeedback(`「${name}」として履歴に保存しました。`, 'success');
  };

  const handleRestoreFromHistory = (historyAssignment: SeatAssignment, historyMode: ClassMode) => {
    if (!isAssignmentValid(config, historyAssignment)) {
      triggerFeedback('この履歴は今の名簿・座席の形と合わないため復元できません。', 'error');
      return;
    }
    setConfirmModal({
      message: '選択した履歴の座席を現在の席順として復元しますか？',
      onConfirm: () => {
        setAssignment(historyAssignment);
        setClassMode(historyMode);
        setIsGenderFreeAssignment(false);
        setShuffleWarnings([]);
        saveCurrentAssignment(historyAssignment, historyMode);
        setSelectedSlot(null);
        triggerFeedback('履歴から座席表を復元しました。', 'success');
      }
    });
  };

  const handleDeleteHistory = (logId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setConfirmModal({
      message: 'この履歴を削除してもよろしいですか？',
      onConfirm: () => {
        const nextLogs = logs.filter(log => log.id !== logId);
        setLogs(nextLogs);
        safeLocalStorage.setItem('seat_assignment_history', JSON.stringify(nextLogs));
        triggerFeedback('履歴を削除しました。', 'info');
      }
    });
  };

  // ---- モード変更時の再アサイン（安全策） ----
  const handleModeChange = (mode: ClassMode) => {
    setClassMode(mode);
    // 自動的にモードに適合したシャッフルを呼び出す（ユーザーの利便性を優先）
    const result = shuffleSeats(config, mode, {
      history: seatHistory,
      absentStudentIds
    });
    applyShuffleResult(result, mode, false);
    const leavers = config.students.filter(s => s.leavesSubject).length;
    triggerFeedback(
      mode === 'all'
        ? '全員verの座席表を自動生成しました。'
        : leavers > 0
          ? `国・算verの座席表を自動生成しました。（国・算で抜ける${leavers}名を後ろに固めました）`
          : '国・算verにしました。名簿で「国・算で抜ける」児童を指定すると、後ろに固めます。',
      'info'
    );
  };

  // ---- クラス設定の保存 ----
  const handleSaveSettings = (next: ClassConfig) => {
    setConfig(next);
    safeLocalStorage.setItem(CONFIG_KEY, JSON.stringify(next));
    setShowSettings(false);
    setIsFirstRun(false);

    const ids = new Set(next.students.map(s => s.id));
    const nextAbsent = absentStudentIds.filter(id => ids.has(id));
    setAbsentStudentIds(nextAbsent);
    safeLocalStorage.setItem('seat_absent_students', JSON.stringify(nextAbsent));

    if (isAssignmentValid(next, assignment)) {
      triggerFeedback('クラス設定を保存しました。', 'success');
      return;
    }
    // 名簿や座席の形が変わって今の配置が使えない場合は、新しく席替えする
    const result = shuffleSeats(next, classMode, { history: seatHistory, absentStudentIds: nextAbsent });
    applyShuffleResult(result, classMode, false);
    triggerFeedback('クラス設定を保存し、新しい設定で席替えしました。', 'success');
  };

  // ---- 設定ファイルの書き出し・読み込み ----
  const handleExport = (cfg: ClassConfig) => {
    const data = {
      kind: EXPORT_FILE_KIND,
      version: 1,
      exportedAt: new Date().toISOString(),
      config: cfg,
      assignment,
      classMode,
      seatHistory,
      logs
    };
    try {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const date = new Date().toLocaleDateString('ja-JP').replace(/\//g, '-');
      a.href = url;
      a.download = `${cfg.className || 'クラス'}_席替え設定_${date}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      triggerFeedback('設定をファイルに書き出しました。', 'success');
    } catch (e) {
      console.error(e);
      triggerFeedback('ファイルの書き出しに失敗しました。', 'error');
    }
  };

  const handleImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      let data: any;
      try {
        data = JSON.parse(String(reader.result));
      } catch {
        triggerFeedback('ファイルを読み込めませんでした。席替えアプリで書き出したファイルか確認してください。', 'error');
        return;
      }
      const cfg = data?.kind === EXPORT_FILE_KIND ? sanitizeConfig(data.config) : null;
      if (!cfg) {
        triggerFeedback('このファイルは席替えアプリの設定ファイルではないようです。', 'error');
        return;
      }
      setConfirmModal({
        message: `「${cfg.className || 'クラス'}」（${cfg.students.length}名・${cfg.seats.length}席）の設定を読み込みますか？今の設定は置きかわります。`,
        onConfirm: () => {
          const mode: ClassMode = data.classMode === 'subject' ? 'subject' : 'all';
          setConfig(cfg);
          safeLocalStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
          setClassMode(mode);
          setAbsentStudentIds([]);
          safeLocalStorage.removeItem('seat_absent_students');
          const history = Array.isArray(data.seatHistory) ? data.seatHistory.slice(0, SEAT_HISTORY_LIMIT) : seatHistory;
          setSeatHistory(history);
          safeLocalStorage.setItem('seat_avoid_history', JSON.stringify(history));
          if (Array.isArray(data.logs)) {
            setLogs(data.logs);
            safeLocalStorage.setItem('seat_assignment_history', JSON.stringify(data.logs));
          }
          if (isAssignmentValid(cfg, data.assignment)) {
            setAssignment(data.assignment);
            setIsGenderFreeAssignment(false);
            setShuffleWarnings([]);
            saveCurrentAssignment(data.assignment, mode);
            setSelectedSlot(null);
          } else {
            applyShuffleResult(shuffleSeats(cfg, mode, { history }), mode, false);
          }
          setShowSettings(false);
          setIsFirstRun(false);
          triggerFeedback('設定ファイルを読み込みました。', 'success');
        }
      });
    };
    reader.readAsText(file);
  };

  // ---- 印刷処理 ----
  const handlePrint = () => {
    try {
      window.print();
    } catch (e) {
      console.error("Print failed or blocked by iframe container:", e);
      triggerFeedback("印刷機能が制限されているか、お使いの環境でサポートされていません。", "error");
    }
  };

  // ---- 配慮の組み合わせのチェック（警告表示用・欠席中の場合は除外） ----
  const violations = findViolations(config, assignment, absentStudentIds);
  const frontRowSet = frontRowSetOf(config);
  const leaverCount = config.students.filter(s => s.leavesSubject).length;
  const className = config.className || 'クラス';

  // ---- 座標の描画配列の定義 ----
  // 児童視点（逆から見た図）：黒板が上になる。
  // 行の描画順：最前列（rows-1）が上、最後列（0）が下。
  // 列の描画順：教師から見て左（列0）が、児童から見て右になるため、列の並びもリバースする。
  const rowIndexes = [...Array(config.rows).keys()];
  const colIndexes = [...Array(config.cols).keys()];
  const rowOrder = viewMode === 'student' ? [...rowIndexes].reverse() : rowIndexes;
  const colOrder = viewMode === 'student' ? [...colIndexes].reverse() : colIndexes;
  // 席が1つもない行は詰めて表示する
  const visibleRows = rowOrder.filter(r => config.seats.some(s => s.row === r));

  return (
    <div className="min-h-screen text-slate-100 font-sans print:bg-white print:text-black selection:bg-indigo-500/30 flex flex-col transition-all duration-300" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)' }}>
      {/* 画面ヘッダー（印刷時は非表示） */}
      <header className="bg-white/5 backdrop-blur-md border-b border-white/10 text-white shadow-xl print:hidden sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-tr from-pink-500/20 to-blue-500/20 rounded-xl border border-white/15 shadow-inner">
              <Users className="w-8 h-8 text-yellow-300 animate-pulse" />
            </div>
            <div>
              <h1 className="text-2xl font-black bg-gradient-to-r from-white via-indigo-200 to-pink-200 bg-clip-text text-transparent tracking-tight">{config.className ? `${config.className} ` : ''}席替えあぷり</h1>
              <p className="text-xs text-indigo-200/70 mt-0.5">名簿・座席の形を自由に設定できる スマート席替えツール</p>
            </div>
          </div>
          
          <div className="flex gap-2">
            <button 
              onClick={() => setShowHelp(!showHelp)}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-white/10 hover:bg-white/15 border border-white/10 hover:border-white/20 rounded-xl transition-all shadow-sm active:scale-95"
              id="btn-help"
            >
              <HelpCircle className="w-4 h-4 text-indigo-300" />
              <span>操作ガイド</span>
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-indigo-500/25 hover:bg-indigo-500/40 border border-indigo-400/30 hover:border-indigo-400/50 rounded-xl transition-all shadow-sm active:scale-95"
              id="btn-settings"
              title="名簿・座席の形・配慮（隣にしない／隣にしたい）を設定します"
            >
              <Settings className="w-4 h-4 text-indigo-200" />
              <span>クラス設定</span>
            </button>
            <button
              onClick={handleNumberOrder}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-rose-500/20 hover:bg-rose-500/35 border border-rose-500/30 hover:border-rose-500/50 rounded-xl transition-all shadow-sm active:scale-95"
              id="btn-reset"
              title="出席番号順に並べ直します"
            >
              <ListOrdered className="w-4 h-4 text-rose-300" />
              <span>番号順に並べる</span>
            </button>
          </div>
        </div>
      </header>

      {/* フィードバック通知（印刷非表示） */}
      {feedbackMsg && (
        <div className="fixed top-20 right-4 z-[70] animate-fade-in print:hidden">
          <div className={`shadow-2xl rounded-2xl p-4 flex items-center gap-3 border backdrop-blur-xl ${
            feedbackMsg.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200' :
            feedbackMsg.type === 'error' ? 'bg-rose-500/10 border-rose-500/30 text-rose-200' :
            'bg-blue-500/10 border-blue-500/30 text-blue-200'
          }`}>
            {feedbackMsg.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
            {feedbackMsg.type === 'error' && <AlertCircle className="w-5 h-5 text-rose-400" />}
            {feedbackMsg.type === 'info' && <Info className="w-5 h-5 text-blue-400" />}
            <span className="text-sm font-semibold">{feedbackMsg.text}</span>
          </div>
        </div>
      )}

      {/* メインレイアウト */}
      <main className="max-w-7xl mx-auto px-2 py-3 sm:px-4 sm:py-4 lg:px-6 w-full flex flex-col gap-4 flex-1">
        
        {/* 上部：コンパクトな操作ツールバー (印刷時は非表示) */}
        <section className="w-full bg-white/5 backdrop-blur-lg border border-white/10 rounded-2xl p-3 shadow-xl flex flex-wrap items-center justify-between gap-3 print:hidden" id="control-panel">
          
          {/* 左側：モード・視点・シャッフル（超小型ボタン群） */}
          <div className="flex flex-wrap items-center gap-2">
            {/* 席替えモード */}
            <div className="flex bg-black/35 rounded-lg p-0.5 border border-white/5">
              <button
                onClick={() => handleModeChange('all')}
                className={`py-1 px-2.5 text-[11px] font-bold rounded transition-all flex items-center gap-1 ${
                  classMode === 'all' 
                    ? 'bg-white/10 text-white shadow border border-white/10' 
                    : 'text-slate-400 hover:text-white'
                }`}
                id="tab-mode-all"
                title="全員を含めてシャッフルします"
              >
                <Users className="w-3 h-3 text-indigo-300" />
                <span>全員ver</span>
              </button>
              <button
                onClick={() => handleModeChange('subject')}
                className={`py-1 px-2.5 text-[11px] font-bold rounded transition-all flex items-center gap-1 ${
                  classMode === 'subject' 
                    ? 'bg-white/10 text-white shadow border border-white/10' 
                    : 'text-slate-400 hover:text-white'
                }`}
                id="tab-mode-subject"
                title="国・算で抜ける児童を後ろに固めて、残りをシャッフルします"
              >
                <BookOpen className="w-3 h-3 text-pink-300" />
                <span>国・算ver</span>
              </button>
            </div>

            {/* 表示視点 */}
            <div className="flex bg-black/35 rounded-lg p-0.5 border border-white/5">
              <button
                onClick={() => setViewMode('student')}
                className={`py-1 px-2.5 text-[11px] font-bold rounded transition-all flex items-center gap-1 ${
                  viewMode === 'student'
                    ? 'bg-blue-500/15 text-blue-200 border border-blue-400/20 shadow'
                    : 'text-slate-450 hover:text-white'
                }`}
                id="btn-view-student"
                title="黒板が上に表示されます（逆から見た図）"
              >
                <Eye className="w-3 h-3" />
                <span>児童視点</span>
              </button>
              <button
                onClick={() => setViewMode('teacher')}
                className={`py-1 px-2.5 text-[11px] font-bold rounded transition-all flex items-center gap-1 ${
                  viewMode === 'teacher'
                    ? 'bg-blue-500/15 text-blue-200 border border-blue-400/20 shadow'
                    : 'text-slate-455 hover:text-white'
                }`}
                id="btn-view-teacher"
                title="黒板が下に表示されます（教師から見た図）"
              >
                <UserCheck2 className="w-3 h-3" />
                <span>教師視点</span>
              </button>
            </div>

            {/* シャッフル実行 */}
            <button
              onClick={handleShuffle}
              className="py-1.5 px-4 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 hover:opacity-95 text-white text-xs font-black rounded-lg shadow-md transition-all transform active:scale-95 flex items-center gap-1 border border-white/10"
              id="btn-shuffle"
            >
              <Sparkles className="w-3 h-3 text-yellow-300 animate-pulse" />
              <span>席順をシャッフルする</span>
            </button>

            {/* 男女ランダムシャッフル（男女席の固定を外す・18/20は離す） */}
            <button
              onClick={handleRandomShuffle}
              className="py-1.5 px-4 bg-gradient-to-r from-teal-500 via-cyan-500 to-sky-500 hover:opacity-95 text-white text-xs font-black rounded-lg shadow-md transition-all transform active:scale-95 flex items-center gap-1 border border-white/10"
              id="btn-random-shuffle"
              title="男子席・女子席の固定を外して完全ランダムに席替えします（隣にしない組み合わせなどの配慮は守ります）"
            >
              <Shuffle className="w-3 h-3 text-yellow-200" />
              <span>男女ランダム</span>
            </button>

            {/* 現在の席を記録（次回以降、同じ席をなるべく避ける） */}
            <button
              onClick={handleRecordSeats}
              className="py-1.5 px-3 bg-emerald-500/20 hover:bg-emerald-500/35 border border-emerald-400/30 hover:border-emerald-400/50 text-emerald-100 text-xs font-bold rounded-lg shadow-sm transition-all active:scale-95 flex items-center gap-1"
              id="btn-record"
              title="今の席を記録します。次回のシャッフルでは、記録した席となるべく同じにならないようにします。"
            >
              <ClipboardCheck className="w-3.5 h-3.5 text-emerald-300" />
              <span>この席を記録{seatHistory.length > 0 ? `（${seatHistory.length}）` : ''}</span>
            </button>

            {/* 記録の消去（記録がある時のみ表示） */}
            {seatHistory.length > 0 && (
              <button
                onClick={handleClearSeatHistory}
                className="py-1.5 px-2 bg-white/5 hover:bg-rose-500/20 border border-white/10 hover:border-rose-400/40 text-slate-400 hover:text-rose-200 text-[11px] font-semibold rounded-lg transition-all active:scale-95 flex items-center gap-1"
                id="btn-clear-record"
                title="「同じ席を避ける」ための記録をすべて消去します"
              >
                <Eraser className="w-3 h-3" />
                <span>記録を消去</span>
              </button>
            )}

            {/* 欠席全解除ボタン（欠席者がいる時のみ表示） */}
            {absentStudentIds.length > 0 && (
              <button
                onClick={handleClearAbsent}
                className="py-1.5 px-3 bg-amber-500/20 hover:bg-amber-500/35 border border-amber-400/30 hover:border-amber-400/50 text-amber-100 text-xs font-bold rounded-lg shadow-sm transition-all active:scale-95 flex items-center gap-1"
                id="btn-clear-absent"
                title="欠席設定を全員解除します"
              >
                <UserCheck className="w-3.5 h-3.5 text-amber-300" />
                <span>欠席解除（{absentStudentIds.length}名）</span>
              </button>
            )}
          </div>

          {/* 右側：履歴保存欄 ＆ 簡易履歴リスト */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 bg-black/25 p-1 rounded-lg border border-white/5">
              <input
                type="text"
                placeholder="現在の席に名前をつけて保存..."
                value={currentLogName}
                onChange={(e) => setCurrentLogName(e.target.value)}
                className="w-40 px-2 py-1 text-[11px] bg-transparent text-white placeholder:text-slate-500 border-none focus:outline-none"
              />
              <button
                onClick={handleSaveToHistory}
                className="px-2.5 py-1 bg-indigo-500/40 hover:bg-indigo-500/60 border border-indigo-400/20 text-white font-bold rounded text-[11px] transition-colors flex items-center gap-0.5"
                id="btn-save"
              >
                <Save className="w-3 h-3" />
                <span>保存</span>
              </button>
            </div>

            {/* 保存した履歴のドロップダウン・トグル風リスト */}
            {logs.length > 0 && (
              <div className="relative group/history">
                <button className="px-2.5 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-[11px] font-semibold rounded-lg transition-all flex items-center gap-1">
                  <History className="w-3 h-3" />
                  <span>履歴から復元 ({logs.length})</span>
                </button>
                <div className="absolute right-0 top-full mt-1 w-64 bg-slate-900/95 backdrop-blur-xl border border-white/15 rounded-xl p-2 shadow-2xl hidden group-hover/history:block z-40 max-h-60 overflow-y-auto">
                  <div className="text-[10px] font-bold text-slate-500 px-1 pb-1 border-b border-white/5 mb-1">保存済みのシート</div>
                  {logs.map((log) => (
                    <div 
                      key={log.id} 
                      onClick={() => handleRestoreFromHistory(log.assignment, log.mode)}
                      className="p-1.5 rounded-lg hover:bg-white/5 cursor-pointer transition-all flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-bold text-white truncate">{log.name}</div>
                        <div className="text-[9px] text-slate-400 mt-0.5 flex items-center gap-1.5">
                          <span>{log.timestamp.split(' ')[0]}</span>
                          <span className="px-1 py-0.2 rounded bg-white/10 text-slate-300 text-[8px] font-bold">
                            {log.mode === 'all' ? '全員' : '国算'}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={(e) => handleDeleteHistory(log.id, e)}
                        className="p-1 text-slate-500 hover:text-rose-400 hover:bg-rose-500/20 rounded transition-all"
                        title="この履歴を削除する"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 手動微調整中のステート表示 */}
          {selectedSlot && (
            <div className="w-full flex items-center justify-between p-2 bg-amber-500/10 border border-amber-500/25 rounded-lg text-[11px] text-amber-200 mt-1 animate-pulse">
              <div className="flex items-center gap-1.5 font-bold">
                <ArrowLeftRight className="w-3.5 h-3.5 text-amber-400" />
                <span>手動微調整モード中: 交代するもう一方の座席（または空席）を選択してください。</span>
              </div>
              <button 
                onClick={() => setSelectedSlot(null)}
                className="px-2 py-0.5 text-[10px] font-bold text-amber-300 hover:text-amber-100 bg-white/5 hover:bg-white/10 border border-white/5 rounded transition-colors"
              >
                キャンセル
              </button>
            </div>
          )}
        </section>

        {/* 下部：座席表エリア（グリッドを全面に拡大表示） */}
        <section className="flex-1 bg-white/5 backdrop-blur-lg border border-white/10 rounded-3xl p-6 shadow-2xl relative flex flex-col justify-between print:border-0 print:shadow-none print:p-0 print:bg-white">
          
          <div className="flex flex-col gap-4">
            
            {/* 席順のタイトルと印刷ボタン */}
            <div className="flex justify-between items-center border-b border-white/5 pb-3 print:pb-2 print:border-slate-300">
              <div>
                <span className="text-xs font-bold text-indigo-300 block print:text-black">
                  {className} 席替え結果 / {classMode === 'all' ? '全員ver（通常）' : '国・算ver（抜ける児童を後ろに固定）'}
                </span>
                <h2 className="text-lg font-extrabold tracking-tight text-white flex items-center gap-2 print:text-black">
                  <span>座席配置図</span>
                  <span className="text-[10px] font-semibold py-0.5 px-2 rounded-full border border-white/10 bg-white/5 text-slate-350 ml-1 print:border-slate-300 print:text-black print:bg-slate-100">
                    {viewMode === 'student' ? '児童視点（黒板が上）' : '教師視点（黒板が下）'}
                  </span>
                </h2>
              </div>

              {/* 印刷・PDF用アクション */}
              <div className="flex gap-2 print:hidden">
                <button
                  onClick={handlePrint}
                  className="flex items-center gap-1 px-3 py-1.5 bg-white/10 hover:bg-white/15 text-slate-200 hover:text-white font-bold rounded-lg text-xs transition-all border border-white/10 shadow-sm active:scale-95"
                  id="btn-print"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>印刷・PDF書き出し</span>
                </button>
              </div>
            </div>

            {/* 席替えの注意・配慮の組み合わせの警告（印刷時は非表示） */}
            {(shuffleWarnings.length > 0 || violations.separate.length > 0 || violations.near.length > 0) && (
              <div className="flex flex-col gap-1.5 print:hidden">
                {violations.separate.length > 0 && (
                  <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-200">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>隣にしない組み合わせが隣になっています：{violations.separate.map(([a, b]) => `${nameOf(a)}と${nameOf(b)}`).join('、')}（赤い枠の席）</span>
                  </div>
                )}
                {violations.near.length > 0 && (
                  <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200">
                    <Info className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>隣にしたい組み合わせが離れています：{violations.near.map(([a, b]) => `${nameOf(a)}と${nameOf(b)}`).join('、')}（赤い枠の席）</span>
                  </div>
                )}
                {shuffleWarnings.filter(w => !w.startsWith('「隣')).map((w, i) => (
                  <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-xl bg-blue-500/10 border border-blue-500/30 text-xs text-blue-200">
                    <Info className="w-4 h-4 shrink-0 mt-0.5" />
                    <span className="flex-1">{w}</span>
                    <button onClick={() => setShuffleWarnings(prev => prev.filter(x => x !== w))} className="p-0.5 rounded hover:bg-white/10" title="閉じる">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* 黒板と先生の机（児童視点：上に表示） */}
            {viewMode === 'student' && (
              <div className="flex items-stretch gap-4 border-b border-white/5 pb-2 mb-1 print:border-slate-200">
                <div className="w-1/4 bg-amber-500/15 text-amber-200 border border-dashed border-amber-500/25 py-2.5 text-center rounded-xl font-bold flex items-center justify-center text-xs print:bg-amber-50 print:text-amber-800 print:border-amber-300">
                  <span>先生の机</span>
                </div>
                <div className="flex-1 bg-white/10 text-white py-2.5 text-center rounded-xl font-bold border border-white/15 flex items-center justify-center shadow-inner tracking-[12px] text-xs relative select-none print:bg-slate-200 print:text-black print:border-slate-400">
                  <div className="absolute top-1 left-2 text-[8px] text-slate-400 uppercase tracking-widest print:text-slate-600">Front</div>
                  <span>黒板方向</span>
                </div>
              </div>
            )}

            {/* 座席グリッド */}
            <div className="overflow-x-auto py-1">
              <div className="p-0.5 flex flex-col gap-3.5" style={{ minWidth: config.cols * 112 }}>
                {visibleRows.map((r) => {
                  return (
                    <div key={`row-${r}`} className="grid gap-3.5" style={{ gridTemplateColumns: `repeat(${config.cols}, minmax(0, 1fr))` }}>
                      {colOrder.map((c) => {
                        // スロットID
                        const slotId = `slot_${r}_${c}`;
                        const slot = seatById.get(slotId);

                        if (!slot) {
                          // 座席スロットがない空欄のセル（通路など）
                          return <div key={`empty-${r}-${c}`} className="invisible" />;
                        }

                        // 配置されている生徒
                        const sId = assignment[slotId];
                        const student = sId !== undefined ? studentById.get(sId) : undefined;
                        const isSelected = selectedSlot === slotId;
                        const isAbsent = sId !== undefined && absentStudentIds.includes(sId);
                        // 座っている児童の性別で色分けする（空席は席の男女指定で薄く表示）
                        const isFemale = student ? student.gender === 'F' : slot.gender === 'F';
                        const isGenderMismatch = student !== undefined && !isGenderFreeAssignment && student.gender !== slot.gender;

                        // 国・算モードで後ろに固めた席
                        const isSubjectFixed = subjectSeatIds.has(slotId);
                        const isFrontStudent = !!student?.front && !isSubjectFixed;
                        // 配慮の組み合わせが崩れている席
                        const isViolating = sId !== undefined && [...violations.separate, ...violations.near].some(p => p.includes(sId));

                        // スタイル構築（欠席 > 選択 > 固定 > 男女）
                        let seatClass = "";
                        if (!student && isSelected) {
                          seatClass = "border-2 border-dashed border-blue-400 bg-blue-500/15 ring-4 ring-blue-500/30 z-10";
                        } else if (!student) {
                          seatClass = `border-2 border-dashed ${slot.gender === 'F' ? 'border-pink-400/20' : 'border-blue-400/20'} bg-white/[0.02] hover:bg-white/5`;
                        } else if (isAbsent && isSelected) {
                          seatClass = "border-2 border-slate-400/50 bg-slate-600/20 ring-4 ring-slate-400/30 scale-102 z-10";
                        } else if (isAbsent) {
                          seatClass = "border-2 border-slate-500/40 bg-slate-600/15 opacity-55 hover:opacity-75 transition-all";
                        } else if (isSelected) {
                          seatClass = "border-blue-400 bg-blue-500/25 ring-4 ring-blue-500/30 scale-102 shadow-[0_0_20px_rgba(59,130,246,0.35)] z-10";
                        } else if (isViolating) {
                          seatClass = "border-2 border-rose-500/80 bg-rose-500/15 hover:bg-rose-500/20";
                        } else if (isSubjectFixed) {
                          seatClass = "border-2 border-dashed border-amber-500/60 bg-amber-500/10 hover:bg-amber-500/15";
                        } else if (isFemale) {
                          seatClass = "border-2 border-pink-400/50 bg-[#f472b6]/10 hover:bg-[#f472b6]/20 transition-all";
                        } else {
                          seatClass = "border-2 border-blue-400/50 bg-[#3b82f6]/10 hover:bg-[#3b82f6]/20 transition-all";
                        }

                        return (
                          <div
                            key={slotId}
                            onClick={() => handleSlotClick(slotId)}
                            className={`relative rounded-2xl p-4 h-32 flex flex-col justify-between transition-all duration-300 cursor-pointer select-none group focus:outline-none backdrop-blur-md shadow-lg ${seatClass} print:bg-white print:border-slate-400 print:text-black print:shadow-none print:backdrop-blur-none`}
                          >
                            {/* スロット情報 / 番号 & バッジ */}
                            <div className="flex justify-between items-center gap-1 border-b border-dashed border-white/5 pb-2 print:border-slate-200">
                              <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                                !student ? 'bg-white/5 text-slate-500 print:bg-white print:text-slate-400'
                                  : isAbsent ? 'bg-slate-500/30 text-slate-300 print:bg-slate-100 print:text-slate-600'
                                  : isFemale ? 'bg-pink-500/20 text-pink-200 print:bg-pink-100 print:text-pink-900'
                                  : 'bg-blue-500/20 text-blue-200 print:bg-blue-100 print:text-blue-900'
                              }`}>
                                {student ? `${student.id}` : '―'}
                              </span>

                              {/* 欠席バッジ */}
                              {isAbsent && (
                                <span className="flex items-center gap-0.5 text-[9px] bg-slate-500/40 text-slate-200 font-black px-1.5 py-0.5 rounded border border-slate-400/30 print:bg-slate-100 print:text-slate-700 print:border-slate-300">
                                  <UserX className="w-2.5 h-2.5 shrink-0" />
                                  <span>欠席</span>
                                </span>
                              )}

                              {/* 国・算verでの固定マーク */}
                              {!isAbsent && isSubjectFixed && (
                                <span className="flex items-center gap-0.5 text-[8px] bg-gradient-to-r from-amber-500 to-yellow-500 text-slate-950 font-black px-1.5 py-0.5 rounded shadow-sm">
                                  <Lock className="w-2.5 h-2.5 shrink-0" />
                                  <span>後方固定</span>
                                </span>
                              )}

                              {/* 前の席マーク（画面のみ） */}
                              {!isAbsent && isFrontStudent && (
                                <span className={`flex items-center gap-0.5 text-[8px] font-black px-1.5 py-0.5 rounded print:hidden ${
                                  frontRowSet.has(slot.row) ? 'bg-sky-500/30 text-sky-100' : 'bg-rose-500/40 text-rose-100'
                                }`} title={frontRowSet.has(slot.row) ? '前の席の児童' : '前の席の児童が前方から外れています'}>
                                  <ArrowUpToLine className="w-2.5 h-2.5 shrink-0" />
                                  <span>前</span>
                                </span>
                              )}

                              {/* 通常の男女区別表記（印刷時は不要、画面上での補助） */}
                              {!isAbsent && !isSubjectFixed && !isFrontStudent && (
                                <span className={`text-[8px] uppercase font-bold tracking-wider opacity-65 print:hidden ${
                                  isFemale ? 'text-pink-400 font-extrabold' : 'text-blue-400 font-extrabold'
                                }`} title={isGenderMismatch ? '男女席の指定と異なる児童が座っています' : undefined}>
                                  {!student
                                    ? (slot.gender === 'F' ? '女子席' : '男子席')
                                    : isGenderFreeAssignment || isGenderMismatch
                                      ? (isFemale ? '女子' : '男子')
                                      : (isFemale ? '女子席' : '男子席')}
                                </span>
                              )}
                            </div>

                            {/* 生徒氏名・なまえ */}
                            {student ? (
                              <div className={`flex-1 flex flex-col justify-center items-center text-center mt-2 ${isAbsent ? 'opacity-50' : ''}`}>
                                {/* ひらがな */}
                                <span className={`text-[10px] md:text-xs font-bold tracking-tight truncate w-full leading-tight print:text-slate-600 ${isAbsent ? 'text-slate-500' : 'text-slate-400'}`}>
                                  {student.kana || ' '}
                                </span>
                                {/* 漢字 */}
                                <span className={`text-xl md:text-2xl font-black tracking-wide mt-1 truncate w-full leading-tight print:text-black ${isAbsent ? 'text-slate-400 line-through decoration-slate-500' : 'text-white'}`}>
                                  {studentLabel(student)}
                                </span>
                                {/* 欠席中のヒント */}
                                {isAbsent && (
                                  <span className="text-[9px] text-slate-500 mt-1 print:hidden">もう一度押すと解除</span>
                                )}
                              </div>
                            ) : (
                              <div className="flex-1 flex items-center justify-center text-xs text-slate-500 italic">
                                空席
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 黒板と先生の机（教師視点：下に表示） */}
            {viewMode === 'teacher' && (
              <div className="flex items-stretch gap-4 border-t border-white/5 pt-4 mt-1 print:border-slate-200">
                <div className="flex-1 bg-white/10 text-white py-2.5 text-center rounded-xl font-bold border border-white/15 flex items-center justify-center shadow-inner tracking-[12px] text-xs relative select-none print:bg-slate-200 print:text-black print:border-slate-400">
                  <div className="absolute bottom-1 left-2 text-[8px] text-slate-400 uppercase tracking-widest print:text-slate-600">Front</div>
                  <span>黒板方向</span>
                </div>
                <div className="w-1/4 bg-amber-500/15 text-amber-200 border border-dashed border-amber-500/25 py-2.5 text-center rounded-xl font-bold flex items-center justify-center text-xs print:bg-amber-50 print:text-amber-800 print:border-amber-300">
                  <span>先生の机</span>
                </div>
              </div>
            )}

            {/* 凡例 (印刷時にも小さく配置) */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/5 pt-3 text-xs text-slate-400 print:border-slate-200 print:text-slate-600">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="w-3.5 h-3.5 rounded bg-[#f472b6]/20 border border-[#f472b6]/50 inline-block print:bg-pink-100 print:border-slate-400" />
                  <span>女子</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3.5 h-3.5 rounded bg-[#3b82f6]/20 border border-[#3b82f6]/50 inline-block print:bg-blue-100 print:border-slate-400" />
                  <span>男子</span>
                </div>
                {classMode === 'subject' && leaverCount > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="w-3.5 h-3.5 rounded border border-dashed border-amber-400 bg-amber-400/20 inline-block print:bg-amber-100 print:border-slate-400" />
                    <span>後方固定席（国・算で抜ける児童）</span>
                  </div>
                )}
                <div className="flex items-center gap-1.5 print:hidden">
                  <span className="w-3.5 h-3.5 rounded bg-sky-500/30 inline-block" />
                  <span>前の席の児童（前から{config.frontRows}列目まで）</span>
                </div>
                <div className="flex items-center gap-1.5 print:hidden">
                  <span className="w-3.5 h-3.5 rounded border-2 border-rose-500/80 inline-block" />
                  <span>配慮の組み合わせが崩れている席</span>
                </div>
                <div className="flex items-center gap-1.5 print:hidden">
                  <span className="w-3.5 h-3.5 rounded border border-slate-500/40 bg-slate-600/15 inline-block" />
                  <span>欠席中（席を2回押してトグル）</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* クラス設定モーダル（印刷非表示） */}
      {showSettings && (
        <SettingsModal
          initialConfig={config}
          viewMode={viewMode}
          isFirstRun={isFirstRun}
          onSave={handleSaveSettings}
          onCancel={() => setShowSettings(false)}
          onExport={handleExport}
          onImport={handleImport}
        />
      )}

      {/* ヘルプガイドモーダル（印刷非表示） */}
      {showHelp && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in print:hidden">
          <div className="bg-slate-900/90 backdrop-blur-2xl border border-white/15 rounded-3xl p-6 max-w-xl w-full shadow-3xl flex flex-col gap-4 text-white">
            <div className="flex justify-between items-center border-b pb-3 border-white/10">
              <h3 className="text-lg font-black text-white flex items-center gap-1.5">
                <Sparkles className="w-5 h-5 text-indigo-400" />
                <span>席替えアプリ 操作ガイド</span>
              </h3>
              <button 
                onClick={() => setShowHelp(false)}
                className="text-slate-400 hover:text-white font-bold p-1 hover:bg-white/10 rounded-lg transition-all"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-sm text-slate-300 my-1 overflow-y-auto max-h-[70vh] pr-2">
              <div>
                <h4 className="font-bold text-white mb-1">⚙️ クラス設定（はじめに）</h4>
                <p className="text-xs leading-relaxed text-slate-350">
                  右上の<strong>「クラス設定」</strong>から、次の3つを設定します。<br />
                  <strong>① 名簿</strong>: 人数（出席番号の上限）を決めて、名前・ふりがな・男女を入力します。Excelなどからの<strong>まとめて貼り付け</strong>もできます。<strong>「国・算で抜ける」</strong>（特別支援学級で国語・算数の授業に抜ける児童）と<strong>「前の席」</strong>（視力・配慮など）もここでチェックします。<br />
                  <strong>② 座席の形</strong>: 横と縦のマス目の数を決め、マスをクリックして<strong>席を置く・消す</strong>ができます（通路や、後ろに1つだけ突き出た席なども作れます）。「男女を切り替える」で、席ごとに男子席・女子席を決められます。<br />
                  <strong>③ 配慮</strong>: <strong>「隣にしない組み合わせ」</strong>と<strong>「隣にしたい組み合わせ」</strong>を登録します（隣＝前後左右）。<br />
                  設定は「保存・読込」で<strong>ファイルに書き出して</strong>、別のパソコンへ移したりバックアップしたりできます。
                </p>
              </div>

              <div>
                <h4 className="font-bold text-white mb-1">💡 視点切り替えについて</h4>
                <p className="text-xs leading-relaxed text-slate-350">
                  本アプリではデフォルトで<strong>「逆から見た図(黒板が上・左右反転した『児童から見た視点』)」</strong>として表示しています。お子様への配布、投影、呼びかけには「児童視点」を、先生が手元の紙と合わせたいときには「教師視点(黒板が下)」に瞬時に切り替えることができます。
                </p>
              </div>

              <div>
                <h4 className="font-bold text-white mb-1">🏫 2つの席替えモード</h4>
                <p className="text-xs leading-relaxed text-slate-350">
                  <strong>【全員ver】</strong>: 全児童{config.students.length}名が「男女固定席」ルールに則ってシャッフルされます。<br />
                  <strong>【国・算ver】</strong>: 名簿で「国・算で抜ける」にチェックした児童{leaverCount > 0 ? `（${leaverCount}名）` : ''}を<strong>一番後ろの席にまとめて固定</strong>したうえで、残りの児童をシャッフルします。固める位置（左寄せ・中央・右寄せ）は「②座席の形」で変えられます。
                </p>
              </div>

              <div>
                <h4 className="font-bold text-white mb-1">🤝 配慮（隣にしない・隣にしたい・前の席）</h4>
                <p className="text-xs leading-relaxed text-slate-350">
                  シャッフルのときは、<strong>「隣にしない組み合わせ」は前後左右に並ばないように</strong>、<strong>「隣にしたい組み合わせ」は前後左右のどこかに並ぶように</strong>、<strong>「前の席」の児童は前から指定した列までに</strong>配置します。<br />
                  条件がきびしすぎて満たせないときは、画面上部にお知らせを出し、崩れている席を<strong>赤い枠</strong>で示します。<br />
                  <span className="text-slate-400">※ 男女席の数と男女の人数が合わない場合は、一部の児童が異性の席に座ります。</span>
                </p>
              </div>

              <div>
                <h4 className="font-bold text-white mb-1">🎲 男女ランダム</h4>
                <p className="text-xs leading-relaxed text-slate-350">
                  「男女ランダム」ボタンは、<strong>男子席・女子席の固定を完全に外して</strong>、誰がどの席に座ってもよい状態で席替えします（男女が隣同士・前後になってもOK）。<strong>「隣にしない」「隣にしたい」「前の席」の配慮</strong>は維持されます。国・算verで使うと、後方固定の児童は固定したまま、それ以外を男女問わずシャッフルします。
                </p>
              </div>

              <div>
                <h4 className="font-bold text-white mb-1">🛠️ 手動での席替え微調整</h4>
                <p className="text-xs leading-relaxed text-slate-350">
                  シャッフル後、「この二人の席を交換したい」ときは、交換したい児童のカードを<strong>順に2箇所クリック</strong>します。空席をクリックすると、その席へ移動させることもできます。男女をまたぐ交代や、「隣にしない組み合わせ」が隣になる交換は、アプリが自動でブロックします。
                </p>
              </div>

              <div>
                <h4 className="font-bold text-white mb-1">🏥 欠席の設定</h4>
                <p className="text-xs leading-relaxed text-slate-350">
                  席をクリックして選択状態にしてから、<strong>同じ席をもう一度押す</strong>と欠席（休み）に設定されます。再度押すと解除できます。<br />
                  欠席者が設定された状態でシャッフルすると、<strong>欠席の席は休み状態のまま一番後ろへ移動し、在席者は前に詰めて</strong>配置されます。欠席が複数いる場合は、<strong>休み席を横並びのペアにして後方にまとめます</strong>（奇数で余った1名は、後ろにある1人席があればそこへ）。<br />
                  なお、<strong>欠席者がいる「調整中」は、空いた席を埋めるために男女席の縛りを外します</strong>（在席者を性別問わず自由に配置・手動入れ替えできます）。全員の欠席を解除すると、通常の男女固定席ルールに戻ります。
                  ツールバーの「欠席解除（N名）」ボタンで全員まとめて解除できます。<br />
                  <span className="text-slate-400">※「国・算ver」では、後方固定の児童は常に後ろの席に固定され、欠席はそれ以外の席で後方にまとめます。</span>
                </p>
              </div>

              <div>
                <h4 className="font-bold text-white mb-1">🔁 同じ席をなるべく避ける（記録機能）</h4>
                <p className="text-xs leading-relaxed text-slate-350">
                  席替えが決まったら<strong>「この席を記録」</strong>ボタンを押してください。配置がこの端末（ブラウザ）に記録され、<strong>次回からのシャッフルでは、記録した席となるべく同じにならないように</strong>自動調整されます。直近{SEAT_HISTORY_LIMIT}回ぶんを考慮し、より新しい記録ほど強く避けます。記録は「記録を消去」でいつでもリセットできます。<br />
                  <span className="text-slate-400">※ 男女固定席・後方固定席・配慮の組み合わせなどのルールが優先されるため、完全に重複ゼロにできない場合もあります。</span>
                </p>
              </div>

              <div>
                <h4 className="font-bold text-white mb-1">📁 履歴保存と復元</h4>
                <p className="text-xs leading-relaxed text-slate-350">
                  気に入った座席表が完成した際は、名前を付けてこの端末に即座に「保存」できます。いつでも元の席を呼び出して復元可能です（名簿や座席の形を変えた後は、合わない履歴は復元できません）。
                </p>
              </div>
            </div>

            <button
              onClick={() => setShowHelp(false)}
              className="w-full py-2.5 bg-gradient-to-r from-indigo-500 to-purple-500 hover:opacity-95 text-white font-bold rounded-2xl transition-all shrink-0 border border-white/10 shadow-lg"
            >
              閉じる
            </button>
          </div>
        </div>
      )}

      {/* カスタム確認ダイアログモーダル */}
      {confirmModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-[60] print:hidden">
          <div className="bg-slate-900/90 backdrop-blur-2xl border border-white/15 rounded-3xl p-6 max-w-sm w-full shadow-3xl flex flex-col gap-5 text-white">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-amber-500/10 text-amber-400 rounded-xl border border-amber-500/20 shrink-0">
                <HelpCircle className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h3 className="text-xs font-bold text-slate-400">実行の確認</h3>
                <p className="text-sm font-bold text-white mt-1 leading-relaxed">
                  {confirmModal.message}
                </p>
              </div>
            </div>
            
            <div className="flex gap-2.5 mt-2">
              <button
                onClick={() => setConfirmModal(null)}
                className="flex-1 py-2 px-4 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 font-bold rounded-xl text-xs transition-all"
              >
                キャンセル
              </button>
              <button
                onClick={() => {
                  confirmModal.onConfirm();
                  setConfirmModal(null);
                }}
                className="flex-1 py-2 px-4 bg-gradient-to-r from-indigo-500 to-purple-500 hover:opacity-95 text-white text-xs font-black rounded-xl shadow-md transition-all border border-white/10"
              >
                実行する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 印刷用のみに強制表示されるフッター */}
      <footer className="hidden print:block text-center text-[10px] text-slate-400 mt-8 border-t pt-2">
        <span>{className} 席替え / 出力日: {new Date().toLocaleDateString('ja-JP')}</span>
      </footer>
    </div>
  );
}
