# 実装計画書（Maintenance / AIエージェント用）v1.6-UX

更新日: 2026-01-11

本ドキュメントは、現行コード（milestone: 100%）に対して **AIエージェントが安全に改修を継続するための実装手順**をまとめたものです。

---

## 0. 実行コマンド（必須ゲート）

### Build
```bash
npm run build
```
- `dist/` を生成します（unpacked extension として読み込み可能）。

### Test（必須）
```bash
npm test
```
- `dist/content/*.js` の classic-script 互換性
- 見積/フォーマット/状態遷移/chunking の unit
- 最小E2E（controller統合: approval → map-reduce → repair）
を含みます。

---

## 1. 重要な不変条件（破ったら差し戻し）

詳細は `docs/AGENT_IMPLEMENTATION_CHECKLIST.md` を参照。ここでは実装観点での要点のみ。

- `manifest.json` は MV3、`content_scripts` は使わない（クリック注入のみ）。
- APIキーは background のみで扱う（content へ渡さない）。
- host_permissions は `https://api.anthropic.com/*` のみ。
- DONE でモード/言語変更は必ずフル再実行。
- $1.00 ハード上限は repair まで含む worst-case で判定。

---

## 2. コード構造（現行）

### Background（Service Worker）
- `src/background/index.ts`
  - action click → scripting.executeScript で注入
  - `COUNT_TOKENS` / `RUN_SUMMARY_*` / `ABORT_RUN` の message handler
  - AbortController registry（runId単位）
  - Claude Messages API 呼び出し（`/v1/messages`, `/v1/messages/count_tokens`）
  - prompt caching（`cache_control: { type: 'ephemeral', ttl: ... }`）

### Content（classic scripts）
- `src/content/controller.ts`
  - state machine を中心に、抽出→見積→承認→要約→Done を制御
  - runId で stale 応答を無視
- `src/content/overlay.ts`
  - Shadow DOM の UI 描画
- `src/content/extract.ts`
  - Readability → fallback で本文抽出
- `src/content/estimate.ts`
  - 文字数/言語比率ベースの token 概算 + cost/time 推定
- `src/content/format.ts`
  - 4モードのフォーマット検証
- `src/content/chunk.ts`
  - paragraph優先の chunking

### Options
- `src/options/index.ts`
  - API key の保存/クリア
  - 非機密設定（モデル、閾値、caching など）の変更

---

## 3. 変更手順（AIエージェント運用の定型）

### 3.1 状態遷移を変更する場合
1. `src/content/state_machine.ts` にイベント/遷移を追加
2. `test/state_machine.test.js` にケースを追加（まず失敗）
3. controller/overlay の差分を実装
4. `npm test` を通す

### 3.2 Claude呼び出し（Background）を変更する場合
1. message type / payload を `src/shared/constants.ts` に追加
2. `src/background/index.ts` の handler を追加
3. content 側の `sendToBackground(...)` 呼び出しを追加
4. `test/no_secrets_in_content.test.js` に抵触しないことを確認

### 3.3 UIを変更する場合
1. `src/content/overlay.ts` の view を変更
2. `test/ux_invariants_static.test.js` の回帰ガードを更新（必要なら）
3. 最小E2E（`test/e2e_simulated_controller_flow.test.js`）が通ることを確認

---

## 4. 手動QA（リリース前の最小チェック）

1. `npm run build`
2. Chrome → Extensions → Developer mode → Load unpacked → `dist/`
3. 長めの記事を開く
4. アイコンクリック → 右上パネル → mode選択
5. 長文なら Preflight → Proceed → Confirm → Run
6. DONE で Copy / モード変更 / 言語変更を確認
7. 実行中に × → confirm → abort が効くことを確認

---

## 結論要約
- 改修は「テスト追加 → 実装 → `npm test` 通過」を必ず守る。
- 不変条件（権限/キー露出/Doneフル再実行/$1.00上限）を破る変更は、必ず設計合意が必要。