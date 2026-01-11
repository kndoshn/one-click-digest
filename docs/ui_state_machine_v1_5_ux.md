# UI State Machine v1.5-UX

更新日: 2026-01-11

本ドキュメントは、content script 側の UI 状態（`UiState`）とイベント（`UiEvent`）の遷移を、実装に合わせて定義します。

## 定義

### 状態（phase）
- `IDLE`: オーバーレイ表示中・未実行。モード選択で実行開始。
- `EXTRACTING`: 本文抽出中。
- `PREFLIGHT`: 見積もり表示中。`refining=true` の場合は `count_tokens` による token 再計測中。
- `CONFIRM`: 送信前の確定確認（高コスト/長文/切り詰め時）。
- `SUMMARIZING`: 要約処理中。
  - `progress.stage`: `SINGLE | MAP | REDUCE | REPAIR`
  - `progress.current/total`: `MAP` のみ表示（chunk 進捗）
- `DONE`: 要約完了。
- `ERROR`: 抽出/通信/整形などのエラー。
- `BLOCKED`: 安全上限（$ hard limit）超過などで実行不可。

### 主要イベント
- `START_RUN`: 抽出を開始（runId を新規生成）
- `EXTRACT_OK / EXTRACT_FAIL`: 抽出結果
- `PREFLIGHT_READY`: 見積もりの確定（refining の on/off を含む）
- `TOKENS_REFINED`: token 再推定反映（count_tokens 成功時）
- `NEEDS_CONFIRM`: 実行前確認へ
- `START_SUMMARY`: 要約開始
- `SUMMARY_PROGRESS`: 進捗更新（map/reduce/repair）
- `SUMMARY_DONE / SUMMARY_ERROR`: 結果
- `RESET`: IDLE へ戻す

## 遷移

### IDLE
- `START_RUN` → `EXTRACTING`
- `MODE_CHANGED` / `LANGUAGE_CHANGED` / `SETTINGS_LOADED` → `IDLE`（同 state 更新のみ）
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
- `TOKENS_REFINED` → `CONFIRM`（見積もり更新）
- `START_SUMMARY` → `SUMMARIZING`
- `RESET` → `IDLE`

### SUMMARIZING
- `SUMMARY_PROGRESS` → `SUMMARIZING`（`progress` 更新）
- `SUMMARY_DONE` → `DONE`
- `SUMMARY_ERROR` → `ERROR`
- `RESET` → `IDLE`

### DONE
- `RESET` → `IDLE`
- `MODE_CHANGED` / `LANGUAGE_CHANGED` → controller が `START_RUN`（仕様決定: 常にフル再実行）

### ERROR / BLOCKED
- `RESET` → `IDLE`

## 実装ノート

### Confirm 画面の「3行で実行」
- UI イベントは `as:runLight`。
- controller が `BULLETS_3` を選択し直した上で、`TOKENS_REFINED` を使って estimate を更新し、`START_SUMMARY` に進める。
- state machine の分岐は増やさず、既存イベントで表現する。

### キャンセル/クローズ
- Cancel/Close → background に `ABORT_RUN`（runId）を送信し、進行中 fetch を abort。
- UI は `RESET`（banner 付き）または unmount。
- v1.5: unmount 時にローディング用の `setInterval` とトースト `setTimeout` を停止して、閉じた後もタイマーが走り続けることを防止。

### 再注入（再起動）
- v1.5: 拡張アイコン再クリックにより注入が再実行されても、controller は runId 追跡を初期化し、過去の実行状態が干渉しないようにする。

### 直列実行
- map-reduce の `MAP` フェーズは chunk を直列に処理する（同時並行はしない）。