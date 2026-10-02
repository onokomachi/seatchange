/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useRef, useState } from 'react';
import {
  Settings,
  Users,
  LayoutGrid,
  HeartHandshake,
  FolderOpen,
  ClipboardPaste,
  Download,
  Upload,
  Plus,
  X,
  AlertCircle,
  Info,
  CheckCircle2
} from 'lucide-react';

import { ClassConfig, Gender, SeatSlot, Student, StudentPair, SubjectSide, ViewMode } from '../types';
import { MAX_GRID_SIZE, MAX_STUDENTS } from '../constants';
import {
  applyGenderPattern,
  applyParsedRoster,
  clampInt,
  GenderPattern,
  genderForPattern,
  makeFullLayout,
  parseRoster,
  prunePairs,
  resizeLayout,
  resizeRoster,
  slotId,
  sortSeats,
  studentLabel
} from '../utils/config';

type Tab = 'roster' | 'layout' | 'pairs' | 'file';

interface Props {
  initialConfig: ClassConfig;
  viewMode: ViewMode;
  isFirstRun: boolean;
  onSave: (config: ClassConfig) => void;
  onCancel: () => void;
  onExport: (config: ClassConfig) => void;
  onImport: (file: File) => void;
}

const inputClass =
  'px-2 py-1 text-xs bg-black/30 text-white placeholder:text-slate-500 border border-white/10 rounded-lg focus:outline-none focus:border-indigo-400/60';

export default function SettingsModal({ initialConfig, viewMode, isFirstRun, onSave, onCancel, onExport, onImport }: Props) {
  const [draft, setDraft] = useState<ClassConfig>(initialConfig);
  const [tab, setTab] = useState<Tab>('roster');
  const [pasteText, setPasteText] = useState('');
  const [pasteMsg, setPasteMsg] = useState<string | null>(null);
  const [layoutTool, setLayoutTool] = useState<'seat' | 'gender'>('seat');
  const [patternDefault, setPatternDefault] = useState<GenderPattern>('stripes');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [countText, setCountText] = useState(String(initialConfig.students.length));
  // 人数を減らしたときに消えた児童を覚えておき、人数を戻したら復活させる
  const removedStudents = useRef(new Map<number, Student>());

  const update = (patch: Partial<ClassConfig>) => setDraft(prev => ({ ...prev, ...patch }));

  // ---- 集計 ----
  const counts = useMemo(() => {
    const st = draft.students;
    const seats = draft.seats;
    return {
      students: st.length,
      male: st.filter(s => s.gender === 'M').length,
      female: st.filter(s => s.gender === 'F').length,
      leavers: st.filter(s => s.leavesSubject).length,
      front: st.filter(s => s.front).length,
      seats: seats.length,
      maleSeats: seats.filter(s => s.gender === 'M').length,
      femaleSeats: seats.filter(s => s.gender === 'F').length
    };
  }, [draft]);
  const notEnoughSeats = counts.seats < counts.students;
  const genderMismatch = counts.maleSeats < counts.male || counts.femaleSeats < counts.female;

  // ---- 名簿 ----
  const setStudentCount = (n: number) => {
    const count = clampInt(n, 1, MAX_STUDENTS);
    setCountText(String(count));
    if (count === draft.students.length) return;
    const pool = [...draft.students, ...[...removedStudents.current.values()].filter(r => !draft.students.some(s => s.id === r.id))];
    pool.filter(s => s.id > count).forEach(s => removedStudents.current.set(s.id, s));
    const students = resizeRoster(pool, count);
    update({
      students,
      separatePairs: prunePairs(draft.separatePairs, students),
      nearPairs: prunePairs(draft.nearPairs, students)
    });
  };

  const updateStudent = (id: number, patch: Partial<Student>) => {
    update({ students: draft.students.map(s => (s.id === id ? { ...s, ...patch } : s)) });
  };

  const handlePaste = () => {
    const parsed = parseRoster(pasteText);
    if (parsed.length === 0) {
      setPasteMsg('読み取れる行がありませんでした。1行に1人ずつ貼り付けてください。');
      return;
    }
    const students = applyParsedRoster(draft.students, parsed);
    update({ students });
    setCountText(String(students.length));
    setPasteText('');
    setPasteMsg(`${parsed.length}人分を名簿に反映しました。内容を確認してください。`);
  };

  // ---- 座席の形 ----
  const rowOrder = viewMode === 'student'
    ? [...Array(draft.rows).keys()].reverse()
    : [...Array(draft.rows).keys()];
  const colOrder = viewMode === 'student'
    ? [...Array(draft.cols).keys()].reverse()
    : [...Array(draft.cols).keys()];

  const setGridSize = (rows: number, cols: number) => {
    const r = clampInt(rows, 1, MAX_GRID_SIZE);
    const c = clampInt(cols, 1, MAX_GRID_SIZE);
    // 広げたぶんのマスは席として追加する
    const kept = resizeLayout(draft.seats, draft.rows, r, c);
    const added: SeatSlot[] = [];
    const rowShift = r - draft.rows;
    for (let row = 0; row < r; row++) {
      for (let col = 0; col < c; col++) {
        const isNewRow = rowShift > 0 && row < rowShift;
        const isNewCol = col >= draft.cols;
        if (isNewRow || isNewCol) {
          added.push({ id: slotId(row, col), row, col, gender: genderForPattern(row, col, patternDefault) });
        }
      }
    }
    update({ rows: r, cols: c, seats: sortSeats([...kept, ...added]), frontRows: Math.min(draft.frontRows, r) });
  };

  const handleCellClick = (row: number, col: number) => {
    const id = slotId(row, col);
    const existing = draft.seats.find(s => s.id === id);
    if (layoutTool === 'seat') {
      update({
        seats: existing
          ? draft.seats.filter(s => s.id !== id)
          : sortSeats([...draft.seats, { id, row, col, gender: genderForPattern(row, col, patternDefault) }])
      });
    } else if (existing) {
      update({
        seats: draft.seats.map(s => (s.id === id ? { ...s, gender: s.gender === 'F' ? 'M' : 'F' } : s))
      });
    }
  };

  const applyPattern = (pattern: GenderPattern) => {
    setPatternDefault(pattern);
    update({ seats: applyGenderPattern(draft.seats, pattern) });
  };

  // ---- 保存 ----
  const handleSave = () => {
    if (notEnoughSeats) {
      setTab('layout');
      return;
    }
    onSave({
      ...draft,
      className: draft.className.trim(),
      students: draft.students.map(s => ({ ...s, name: s.name.trim(), kana: s.kana.trim() }))
    });
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'roster', label: '① 名簿', icon: <Users className="w-3.5 h-3.5" /> },
    { id: 'layout', label: '② 座席の形', icon: <LayoutGrid className="w-3.5 h-3.5" /> },
    { id: 'pairs', label: '③ 配慮', icon: <HeartHandshake className="w-3.5 h-3.5" /> },
    { id: 'file', label: '保存・読込', icon: <FolderOpen className="w-3.5 h-3.5" /> }
  ];

  return (
    <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 z-50 print:hidden">
      <div className="bg-slate-900/95 border border-white/15 rounded-3xl w-full max-w-4xl max-h-[95vh] flex flex-col text-white shadow-2xl">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-white/10">
          <h3 className="text-lg font-black flex items-center gap-2">
            <Settings className="w-5 h-5 text-indigo-300" />
            <span>クラス設定</span>
          </h3>
          {!isFirstRun && (
            <button onClick={onCancel} className="text-slate-400 hover:text-white p-1 hover:bg-white/10 rounded-lg" title="保存せずに閉じる">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {isFirstRun && (
          <div className="mx-5 mt-3 p-3 rounded-xl bg-indigo-500/10 border border-indigo-400/25 text-xs text-indigo-100 leading-relaxed">
            はじめに、クラスの設定をしましょう。<strong>①名簿</strong>で人数と名前、<strong>②座席の形</strong>で机の並び、<strong>③配慮</strong>で「隣にしない／隣にしたい」組み合わせを決めて、最後に「保存して閉じる」を押してください。<br />
            以前の設定ファイルがある場合は「保存・読込」から読み込めます。
          </div>
        )}

        {/* タブ */}
        <div className="flex gap-1 px-5 pt-3 overflow-x-auto">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-lg border transition-all whitespace-nowrap ${
                tab === t.id ? 'bg-indigo-500/30 border-indigo-400/40 text-white' : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
              }`}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        {/* 本文 */}
        <div className="flex-1 overflow-y-auto px-5 py-4 text-sm">
          {tab === 'roster' && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-end gap-4">
                <label className="flex flex-col gap-1 text-xs font-bold text-slate-300">
                  クラス名
                  <input
                    type="text"
                    value={draft.className}
                    placeholder="例：4年3組"
                    onChange={e => update({ className: e.target.value })}
                    className={`${inputClass} w-40`}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-bold text-slate-300">
                  人数（出席番号の上限）
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={1}
                      max={MAX_STUDENTS}
                      value={countText}
                      onChange={e => setCountText(e.target.value)}
                      onBlur={() => setStudentCount(parseInt(countText, 10) || draft.students.length)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') setStudentCount(parseInt(countText, 10) || draft.students.length);
                      }}
                      className={`${inputClass} w-20`}
                    />
                    <span className="text-slate-400 font-normal">人（1〜{draft.students.length}番）</span>
                  </div>
                </label>
                <div className="text-[11px] text-slate-400 pb-1">
                  男子 {counts.male}名・女子 {counts.female}名 ／ 国・算で抜ける {counts.leavers}名 ／ 前の席 {counts.front}名
                </div>
              </div>

              {/* 貼り付け */}
              <details className="bg-white/5 border border-white/10 rounded-xl p-3">
                <summary className="cursor-pointer text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <ClipboardPaste className="w-3.5 h-3.5 text-emerald-300" />
                  <span>Excelなどから名簿をまとめて貼り付ける</span>
                </summary>
                <div className="mt-2 flex flex-col gap-2">
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    1行に1人ずつ貼り付けてください。「番号」「名前」「ふりがな」「男/女」の列を自動で見分けます（番号・ふりがな・性別は無くてもOK）。<br />
                    例：<code className="text-slate-300">1　阿部 太郎　あべ たろう　男</code>（Excelからコピーした表もそのまま使えます）
                  </p>
                  <textarea
                    value={pasteText}
                    onChange={e => setPasteText(e.target.value)}
                    rows={5}
                    placeholder={'1\t阿部 太郎\tあべ たろう\t男\n2\t井上 花子\tいのうえ はなこ\t女'}
                    className={`${inputClass} w-full font-mono`}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handlePaste}
                      disabled={!pasteText.trim()}
                      className="px-3 py-1.5 bg-emerald-500/30 hover:bg-emerald-500/45 disabled:opacity-40 border border-emerald-400/30 rounded-lg text-xs font-bold"
                    >
                      名簿に反映する
                    </button>
                    {pasteMsg && <span className="text-[11px] text-emerald-200">{pasteMsg}</span>}
                  </div>
                </div>
              </details>

              {/* 名簿テーブル */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[600px]">
                  <thead>
                    <tr className="text-slate-400 text-[11px] border-b border-white/10">
                      <th className="py-1.5 px-1 text-left w-12">番号</th>
                      <th className="py-1.5 px-1 text-left">名前</th>
                      <th className="py-1.5 px-1 text-left">ふりがな</th>
                      <th className="py-1.5 px-1 text-center w-24">性別</th>
                      <th className="py-1.5 px-1 text-center w-24" title="国語・算数で抜ける授業がある児童。国・算verで後ろに固めます。">国・算で抜ける</th>
                      <th className="py-1.5 px-1 text-center w-20" title="視力・配慮などで前の席にしたい児童">前の席</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.students.map(s => (
                      <tr key={s.id} className="border-b border-white/5">
                        <td className="py-1 px-1 font-mono font-bold text-slate-300">{s.id}</td>
                        <td className="py-1 px-1">
                          <input
                            type="text"
                            value={s.name}
                            placeholder={`${s.id}番`}
                            onChange={e => updateStudent(s.id, { name: e.target.value })}
                            className={`${inputClass} w-full`}
                          />
                        </td>
                        <td className="py-1 px-1">
                          <input
                            type="text"
                            value={s.kana}
                            placeholder="ふりがな"
                            onChange={e => updateStudent(s.id, { kana: e.target.value })}
                            className={`${inputClass} w-full`}
                          />
                        </td>
                        <td className="py-1 px-1">
                          <div className="flex justify-center bg-black/30 rounded-lg p-0.5 border border-white/5">
                            {(['M', 'F'] as Gender[]).map(g => (
                              <button
                                key={g}
                                onClick={() => updateStudent(s.id, { gender: g })}
                                className={`flex-1 px-2 py-0.5 rounded text-[11px] font-bold transition-all ${
                                  s.gender === g
                                    ? g === 'M' ? 'bg-blue-500/40 text-white' : 'bg-pink-500/40 text-white'
                                    : 'text-slate-500 hover:text-white'
                                }`}
                              >
                                {g === 'M' ? '男' : '女'}
                              </button>
                            ))}
                          </div>
                        </td>
                        <td className="py-1 px-1 text-center">
                          <input
                            type="checkbox"
                            checked={s.leavesSubject}
                            onChange={e => updateStudent(s.id, { leavesSubject: e.target.checked })}
                            className="w-4 h-4 accent-amber-400 cursor-pointer"
                          />
                        </td>
                        <td className="py-1 px-1 text-center">
                          <input
                            type="checkbox"
                            checked={s.front}
                            onChange={e => updateStudent(s.id, { front: e.target.checked })}
                            className="w-4 h-4 accent-sky-400 cursor-pointer"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-slate-500">※ 名前を空欄にすると「○番」と表示されます。名簿はこのパソコンのブラウザの中だけに保存され、外部には送信されません。</p>
            </div>
          )}

          {tab === 'layout' && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-end gap-4">
                <label className="flex flex-col gap-1 text-xs font-bold text-slate-300">
                  横（列の数）
                  <select value={draft.cols} onChange={e => setGridSize(draft.rows, Number(e.target.value))} className={`${inputClass} w-20`}>
                    {[...Array(MAX_GRID_SIZE).keys()].map(i => <option key={i} value={i + 1}>{i + 1}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs font-bold text-slate-300">
                  縦（行の数）
                  <select value={draft.rows} onChange={e => setGridSize(Number(e.target.value), draft.cols)} className={`${inputClass} w-20`}>
                    {[...Array(MAX_GRID_SIZE).keys()].map(i => <option key={i} value={i + 1}>{i + 1}</option>)}
                  </select>
                </label>

                <div className="flex flex-col gap-1 text-xs font-bold text-slate-300">
                  クリックしたときの動き
                  <div className="flex bg-black/30 rounded-lg p-0.5 border border-white/10">
                    <button
                      onClick={() => setLayoutTool('seat')}
                      className={`px-2.5 py-1 rounded text-[11px] font-bold ${layoutTool === 'seat' ? 'bg-indigo-500/40 text-white' : 'text-slate-400'}`}
                    >
                      席を置く・消す
                    </button>
                    <button
                      onClick={() => setLayoutTool('gender')}
                      className={`px-2.5 py-1 rounded text-[11px] font-bold ${layoutTool === 'gender' ? 'bg-indigo-500/40 text-white' : 'text-slate-400'}`}
                    >
                      男女を切り替える
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button onClick={() => update({ seats: makeFullLayout(draft.rows, draft.cols, patternDefault) })} className="px-2.5 py-1 bg-white/10 hover:bg-white/15 border border-white/10 rounded-lg text-[11px] font-bold">
                  すべてのマスを席にする
                </button>
                <button onClick={() => update({ seats: [] })} className="px-2.5 py-1 bg-white/10 hover:bg-white/15 border border-white/10 rounded-lg text-[11px] font-bold">
                  席をすべて消す
                </button>
                <button onClick={() => applyPattern('stripes')} className="px-2.5 py-1 bg-white/10 hover:bg-white/15 border border-white/10 rounded-lg text-[11px] font-bold" title="列ごとに男女を交互にします（横の隣は異性、前後は同性）">
                  男女を「縦じま」にする
                </button>
                <button onClick={() => applyPattern('checker')} className="px-2.5 py-1 bg-white/10 hover:bg-white/15 border border-white/10 rounded-lg text-[11px] font-bold" title="前後左右すべてが異性になるように並べます">
                  男女を「市松模様」にする
                </button>
              </div>

              {/* マス目エディタ */}
              <div className="overflow-x-auto">
                <div className="flex flex-col gap-1.5 mx-auto" style={{ width: Math.max(draft.cols * 64, 240) }}>
                  {viewMode === 'student' && (
                    <div className="bg-white/10 border border-white/15 rounded-lg text-center text-[11px] font-bold py-1 tracking-[8px]">黒板</div>
                  )}
                  {rowOrder.map(r => (
                    <div key={r} className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${draft.cols}, minmax(0, 1fr))` }}>
                      {colOrder.map(c => {
                        const seat = draft.seats.find(s => s.row === r && s.col === c);
                        return (
                          <button
                            key={c}
                            onClick={() => handleCellClick(r, c)}
                            className={`h-12 rounded-lg text-[11px] font-black border-2 transition-all active:scale-95 ${
                              !seat
                                ? 'border-dashed border-white/10 text-slate-600 hover:border-white/30'
                                : seat.gender === 'F'
                                  ? 'border-pink-400/60 bg-pink-500/20 text-pink-100'
                                  : 'border-blue-400/60 bg-blue-500/20 text-blue-100'
                            }`}
                          >
                            {!seat ? '＋' : seat.gender === 'F' ? '女子席' : '男子席'}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                  {viewMode === 'teacher' && (
                    <div className="bg-white/10 border border-white/15 rounded-lg text-center text-[11px] font-bold py-1 tracking-[8px]">黒板</div>
                  )}
                </div>
              </div>

              {/* 集計・注意 */}
              <div className="flex flex-col gap-1.5 text-xs">
                <div className="text-slate-300">
                  席：<strong>{counts.seats}席</strong>（男子席 {counts.maleSeats}・女子席 {counts.femaleSeats}） ／ 児童：<strong>{counts.students}名</strong>（男子 {counts.male}・女子 {counts.female}）
                  {counts.seats > counts.students && <span className="text-slate-400">　→ {counts.seats - counts.students}席は空席になります（後ろ側）</span>}
                </div>
                {notEnoughSeats && (
                  <div className="flex items-center gap-1.5 text-rose-200 bg-rose-500/10 border border-rose-500/30 rounded-lg px-2 py-1.5">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>席が {counts.students - counts.seats} 席たりません。マスをクリックして席を増やしてください。</span>
                  </div>
                )}
                {!notEnoughSeats && genderMismatch && (
                  <div className="flex items-center gap-1.5 text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-lg px-2 py-1.5">
                    <Info className="w-4 h-4 shrink-0" />
                    <span>男女の人数と男女席の数が合っていません。このままでも使えますが、一部の児童は異性の席に座ります。「男女を切り替える」で調整できます。</span>
                  </div>
                )}
              </div>

              {/* 前の席・国算の位置 */}
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="bg-white/5 border border-white/10 rounded-xl p-3 flex flex-col gap-1.5">
                  <span className="text-xs font-bold text-sky-200">「前の席」にする範囲</span>
                  <div className="flex items-center gap-1.5 text-xs">
                    <span>前から</span>
                    <select value={draft.frontRows} onChange={e => update({ frontRows: Number(e.target.value) })} className={`${inputClass} w-16`}>
                      {[...Array(draft.rows).keys()].map(i => <option key={i} value={i + 1}>{i + 1}</option>)}
                    </select>
                    <span>列目まで</span>
                  </div>
                  <span className="text-[11px] text-slate-500">名簿で「前の席」にチェックした児童が対象です。</span>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-xl p-3 flex flex-col gap-1.5">
                  <span className="text-xs font-bold text-amber-200">国・算verで後ろに固める位置</span>
                  <div className="flex bg-black/30 rounded-lg p-0.5 border border-white/10 w-fit">
                    {([['left', '左寄せ'], ['center', '中央'], ['right', '右寄せ']] as [SubjectSide, string][]).map(([side, label]) => (
                      <button
                        key={side}
                        onClick={() => update({ subjectSide: side })}
                        className={`px-3 py-1 rounded text-[11px] font-bold ${draft.subjectSide === side ? 'bg-amber-500/40 text-white' : 'text-slate-400'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <span className="text-[11px] text-slate-500">黒板に向かって（児童から見て）の左右です。一番後ろの行から、この側に寄せて固めます。</span>
                </div>
              </div>
            </div>
          )}

          {tab === 'pairs' && (
            <div className="flex flex-col gap-4">
              <p className="text-xs text-slate-400">「隣」は<strong className="text-slate-200">前後左右</strong>の席を指します。欠席中の児童が含まれる組み合わせは、その日は判定しません。</p>
              <PairEditor
                title="隣にしない組み合わせ"
                description="トラブルになりやすい児童どうしなど。席替えのとき、前後左右に並ばないようにします。"
                accent="rose"
                pairs={draft.separatePairs}
                otherPairs={draft.nearPairs}
                students={draft.students}
                onChange={pairs => update({ separatePairs: pairs })}
              />
              <PairEditor
                title="隣にしたい組み合わせ"
                description="お世話役の児童と隣にしたい場合など。席替えのとき、前後左右のどこかに並ぶようにします。"
                accent="emerald"
                pairs={draft.nearPairs}
                otherPairs={draft.separatePairs}
                students={draft.students}
                onChange={pairs => update({ nearPairs: pairs })}
              />
            </div>
          )}

          {tab === 'file' && (
            <div className="flex flex-col gap-4">
              <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col gap-2">
                <span className="text-sm font-bold flex items-center gap-1.5"><Download className="w-4 h-4 text-indigo-300" />ファイルに書き出す</span>
                <p className="text-xs text-slate-400 leading-relaxed">
                  名簿・座席の形・配慮の設定と、今の座席表・席の記録・保存した履歴を1つのファイル（.json）にまとめて保存します。別のパソコンへ移すときや、バックアップに使えます。<br />
                  ※ 児童の名前が入ったファイルです。取り扱いに注意してください。
                </p>
                <button onClick={() => onExport(draft)} className="w-fit px-3 py-1.5 bg-indigo-500/40 hover:bg-indigo-500/60 border border-indigo-400/30 rounded-lg text-xs font-bold">
                  ファイルに書き出す
                </button>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col gap-2">
                <span className="text-sm font-bold flex items-center gap-1.5"><Upload className="w-4 h-4 text-emerald-300" />ファイルから読み込む</span>
                <p className="text-xs text-slate-400 leading-relaxed">
                  以前に書き出したファイルを読み込みます。<strong className="text-amber-200">今の設定は読み込んだ内容に置きかわります。</strong>
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) onImport(file);
                    e.target.value = '';
                  }}
                />
                <button onClick={() => fileInputRef.current?.click()} className="w-fit px-3 py-1.5 bg-emerald-500/30 hover:bg-emerald-500/45 border border-emerald-400/30 rounded-lg text-xs font-bold">
                  ファイルを選んで読み込む
                </button>
              </div>
            </div>
          )}
        </div>

        {/* フッター */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-white/10">
          <span className="text-[11px] text-slate-400">
            {notEnoughSeats
              ? <span className="text-rose-300">席が足りないため保存できません（②座席の形）</span>
              : <span className="flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />{counts.students}名・{counts.seats}席</span>}
          </span>
          <div className="flex gap-2">
            {!isFirstRun && (
              <button onClick={onCancel} className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 font-bold rounded-xl text-xs">
                キャンセル
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={notEnoughSeats}
              className="px-5 py-2 bg-gradient-to-r from-indigo-500 to-purple-500 hover:opacity-95 disabled:opacity-40 text-white text-xs font-black rounded-xl border border-white/10"
            >
              保存して閉じる
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- 組み合わせの編集 ----

interface PairEditorProps {
  title: string;
  description: string;
  accent: 'rose' | 'emerald';
  pairs: StudentPair[];
  otherPairs: StudentPair[];
  students: Student[];
  onChange: (pairs: StudentPair[]) => void;
}

const samePair = (p: StudentPair, a: number, b: number) => (p[0] === a && p[1] === b) || (p[0] === b && p[1] === a);

function PairEditor({ title, description, accent, pairs, otherPairs, students, onChange }: PairEditorProps) {
  const [a, setA] = useState<number | ''>('');
  const [b, setB] = useState<number | ''>('');
  const [error, setError] = useState<string | null>(null);
  const byId = new Map(students.map(s => [s.id, s]));
  const label = (id: number) => `${id}番 ${studentLabel(byId.get(id)) === `${id}番` ? '' : studentLabel(byId.get(id))}`.trim();

  const add = () => {
    if (a === '' || b === '') return;
    if (a === b) { setError('同じ児童は選べません。'); return; }
    if (pairs.some(p => samePair(p, a, b))) { setError('その組み合わせはすでに登録されています。'); return; }
    if (otherPairs.some(p => samePair(p, a, b))) { setError('その組み合わせは反対の条件にすでに登録されています。'); return; }
    onChange([...pairs, [a, b]]);
    setA('');
    setB('');
    setError(null);
  };

  const color = accent === 'rose'
    ? { title: 'text-rose-200', chip: 'bg-rose-500/15 border-rose-400/30', btn: 'bg-rose-500/30 hover:bg-rose-500/45 border-rose-400/30' }
    : { title: 'text-emerald-200', chip: 'bg-emerald-500/15 border-emerald-400/30', btn: 'bg-emerald-500/30 hover:bg-emerald-500/45 border-emerald-400/30' };

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-3 flex flex-col gap-2">
      <span className={`text-sm font-bold ${color.title}`}>{title}</span>
      <span className="text-[11px] text-slate-400">{description}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        <select value={a} onChange={e => setA(e.target.value === '' ? '' : Number(e.target.value))} className={`${inputClass} w-40`}>
          <option value="">児童を選ぶ</option>
          {students.map(s => <option key={s.id} value={s.id}>{label(s.id)}</option>)}
        </select>
        <span className="text-xs text-slate-400">と</span>
        <select value={b} onChange={e => setB(e.target.value === '' ? '' : Number(e.target.value))} className={`${inputClass} w-40`}>
          <option value="">児童を選ぶ</option>
          {students.map(s => <option key={s.id} value={s.id}>{label(s.id)}</option>)}
        </select>
        <button onClick={add} disabled={a === '' || b === ''} className={`flex items-center gap-1 px-3 py-1 border rounded-lg text-xs font-bold disabled:opacity-40 ${color.btn}`}>
          <Plus className="w-3.5 h-3.5" />追加
        </button>
      </div>
      {error && <span className="text-[11px] text-rose-300">{error}</span>}
      <div className="flex flex-wrap gap-1.5">
        {pairs.length === 0 && <span className="text-[11px] text-slate-500">まだありません</span>}
        {pairs.map(([x, y], i) => (
          <span key={`${x}-${y}`} className={`flex items-center gap-1 pl-2 pr-1 py-0.5 border rounded-full text-[11px] font-bold ${color.chip}`}>
            {label(x)} ・ {label(y)}
            <button onClick={() => onChange(pairs.filter((_, j) => j !== i))} className="p-0.5 rounded-full hover:bg-white/15" title="削除">
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
