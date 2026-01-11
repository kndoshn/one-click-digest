# UI State Machine v1.3-UX

更新日: 2026-01-11

本ドキュメントは、content script 側の UI 状態（`UiState`）とイベント（`UiEvent`）の遷移を、実装に合わせて簡潔に定義する。

## 定義

### 状態（phase）
- `IDLE`: オーバーレイ表示中・未実行。モード/言語変更、Run が可能。
- `EXTRACTING`: 本文抽出中。
- `PREFLIGHT`: 推定表示中（`refining=true` の場合は token count の再計測中）。
- `CONFIRM`: 送信前の確定確認（高コスト/長文/安全上限など）。
- `SUMMARIZING`: 要約処理中。
  - `progress.stage`: `SINGLE | MAP | REDUCE | REPAIR`
  - `progress.current/total`: `MAP` のみ表示（chunk 進捗）
- `DONE`: 要約完了。
- `ERROR`: 抽出/通信/整形などのエラー。
- `BLOCKED`: 安全上限（$1 worst-case）超過などで実行不可。

### 主要イベント
- `OPEN_OVERLAY`: 表示開始
- `CLOSE_OVERLAY`: 非表示
- `START_RUN`: 抽出を開始
- `EXTRACT_OK / EXTRACT_FAIL`: 抽出結果
- `PREFLIGHT_READY`: 推定の確定（refining の on/off を含む）
- `TOKENS_REFINED`: 正確な token での再推定反映
- `NEEDS_CONFIRM`: 実行前確認へ
- `START_SUMMARY`: 要約開始
- `SUMMARY_PROGRESS`: 進捗更新（map/reduce/repair）
- `SUMMARY_DONE / SUMMARY_ERROR`: 結果
- `BLOCKED`: 実行不可

## 遷移

### IDLE
- `START_RUN` → `EXTRACTING`
- `MODE_CHANGED` / `LANGUAGE_CHANGED` / `API_KEY_STATE` → `IDLE`（同 state 更新のみ）
- `CLOSE_OVERLAY` → content から unmount

### EXTRACTING
- `EXTRACT_OK` → `PREFLIGHT`（記事メタ保持、推定は placeholder）
- `EXTRACT_FAIL` → `ERROR`

### PREFLIGHT
- `PREFLIGHT_READY` → `PREFLIGHT`（推定確定・refining 更新）
- `TOKENS_REFINED` → `PREFLIGHT`（tokenExact 反映）
- `NEEDS_CONFIRM` → `CONFIRM`
- `START_SUMMARY` → `SUMMARIZING`
- `RESET` → `IDLE`

### CONFIRM
- `START_SUMMARY` → `SUMMARIZING`
- `RESET` → `IDLE`

### SUMMARIZING
- `SUMMARY_PROGRESS` → `SUMMARIZING`（`progress` 更新）
- `SUMMARY_DONE` → `DONE`
- `SUMMARY_ERROR` → `ERROR`
- `RESET` → `IDLE`

### DONE
- `RESET` → `IDLE`
- `MODE_CHANGED` / `LANGUAGE_CHANGED` → controller が `START_RUN`（フル再実行）

### ERROR / BLOCKED
- `RESET` → `IDLE`

## 実装ノート
- キャンセル/クローズは「state machine 上の状態」ではなく、controller が `ABORT_RUN` を background に送った上で `RESET`（banner 付き）または unmount を行う。
- map-reduce の `MAP` フェーズは chunk を直列に処理する（同時並行はしない）。