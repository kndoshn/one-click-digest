# Article Summarizer Extension Design v1.5-UX

更新日: 2026-01-11

本ドキュメントは、現行実装（milestone: ~90%）を前提に、UX と保守性の観点から仕様・設計を整理したものです。

## 目的
- ユーザーが閲覧中の **一般的な HTML 記事**から本文を抽出し、Claude で要約して **同一ページ上のオーバーレイ UI**に表示する。
- 要約の粒度（4モード）を切り替え、短時間で記事概要を理解する。
- 長文では **コスト/時間の見積もり**と **ユーザー承認**を挟み、意図しない高コスト実行を避ける。

## 非目的（v1）
- 常時注入（always-on）の `content_scripts` は行わない（アクションクリック時のみ注入）。
- PDF / SNS / Notion 等の特殊コンテンツ対応（v2+）。
- ストリーミング表示（v2+）。

## UXの要点

### 基本フロー
1. 拡張アイコンをクリック → content 側へオンデマンド注入 → 右上パネル表示
2. 本文抽出（Readability → フォールバック）
3. 事前見積もり（Preflight）
   - 概算（文字数・CJK 比率ベース）
   - 可能なら `count_tokens` で入力 token を精緻化（成功時のみ UI を更新）
4. 承認が必要な場合のみ、ユーザー確認（Confirm）
5. 要約生成
   - 短文: single-pass
   - 長文: map-reduce + 1 回だけフォーマット修復（任意）
6. DONE: 要約表示、Copy、モード/言語切替（フル再実行）、Close

### v1.5でのUX/保守性改善（m90）
- **閉じる/アンマウント時のタイマー停止**
  - ローディングのドットアニメーション（`setInterval`）とトースト用タイマー（`setTimeout`）を、`unmount()` 時に確実に停止。
  - 目的: パネルを閉じた後もタイマーが走り続けて CPU を消費する問題を予防。
- **再注入（再起動）時の実行コンテキスト初期化**
  - `activeRunId` とキャンセル済み runId を初期化し、過去の実行状態が新しい起動に干渉しないようにする。

## 機能仕様

### 要約モード（4択）
| モード | 出力フォーマット | 用途 |
|---|---|---|
| `BULLETS_3` | 箇条書き 3 行 | 最短で把握 |
| `BULLETS_5` | 箇条書き 5 行 | 標準 |
| `BULLETS_10` | 箇条書き 10 行 | 重要点を多めに |
| `TLDR_12_CONCLUSION` | `TL;DR:` 1 行 + 箇条書き 12 行 + `Conclusion:` 1 行 | 長文の要点と結論 |

#### モード自動フォールバック
- 選択されたモードに対して本文が短い場合、**より短いモードに自動調整**する（例: `TLDR_12_CONCLUSION` → `BULLETS_10`）。
- ユーザーにはトーストで通知。
- 目的: 無理に行数を稼いで誤要約/水増しを誘発しない。

### 言語
- 既定は `Auto`
  - `Accept-Language` 優先順の先頭を採用
- UI で `Accept-Language` の候補から手動選択可能
- DONE で言語変更した場合は **必ずフル再実行**（Extract からやり直し）

### 本文抽出
- 第一候補: Readability（clone した `document` を対象）
- フォールバック:
  - `article`, `main`, `[role=main]` 等から候補を抽出
  - 不要要素（nav/aside/footer 等）を除外
  - 最長テキスト要素を採用
- 「要約できない」判定（緩め）
  - 抽出文字数が一定未満
  - リンク密度が極端に高い
  - 本文候補がほぼ取得できない
  - など

### 長文（map-reduce）
- chunking: 段落境界優先で分割し、ターゲット input token 近傍で chunk を構成
- Map: 各 chunk を「最大 5 箇条書き」に要約
- Reduce: chunk 要約を統合し、指定モードのフォーマットで最終出力を生成
- Repair（任意）: フォーマット検証に失敗した場合のみ 1 回だけ修復

### 見積もり（Preflight/Confirm）
- 画面表示項目（要求仕様）
  - 抽出文字数
  - 送信文字数（切り詰め後）
  - 推定 token（概算 or `count_tokens` 反映）
  - 推定コスト（low-high + worst）
  - 推定所要時間（概算）
- $ ハード上限（既定 $1.00）
  - **reduce2（フォーマット修正）込みの worst-case** が上限を超える場合、実行不可（BLOCKED）

### Prompt caching
- 有効化すると、長文 reduce/repair の共通 prefix（chunk 要約ブロック）を `cache_control: ephemeral` にしてキャッシュ対象にする。
- TTL は `5m` / `1h` を Options で選択可能。
- モデルごとに最小キャッシュ可能長があるため、短い入力では指定しても効果が出ない場合がある。

## アーキテクチャ

### 構成
- MV3 service worker（background）
  - Claude API 呼び出し（Messages API + `count_tokens`）
  - AbortController 管理（runId 単位）
  - 注入（Readability + content bundle）
- Content（オンデマンド注入 / classic scripts）
  - UI（Shadow DOM）
  - 抽出・見積・chunking・検証・状態遷移
- Options
  - API キー保存（local）
  - 非機密設定（local）

### ストレージ
- API キー: `chrome.storage.local`（端末内）
- 設定（非機密）: `chrome.storage.local`
  - default mode
  - map/final models
  - prompt caching on/off + TTL
  - cost thresholds（approval/hard）
  - article length caps

## 検証戦略（TDD的チェック）

### なぜ VM テストを使うか
- content 側の `dist/content/*.js` は MV3 の `chrome.scripting.executeScript(..., { files })` で注入されるため、**ESM import で直接ユニットテストできない**。
- そのため、Node の `vm` で「classic script として評価」し、`AS.*` 名前空間を介して純関数部分（見積、状態遷移、フォーマット、chunking）を検証する。

### 実装済みの自動テスト（m90）
- Invariant
  - `content/` に Claude 呼び出し/認証ヘッダーがないこと
  - `manifest.json` が最小権限で `content_scripts` を含まないこと
  - `dist/content/*.js` に `import/export` が存在しないこと（classic script 維持）
- Unit（VM ベース）
  - 状態機械の主要遷移と stale runId 無視
  - 見積もり（`costWorst` が repair を含む、ハード上限判定、caching係数）
  - フォーマット検証（モード別）
  - chunker の分割
- Regression（静的）
  - extractor が Readability + fallback selector を保持していること
  - overlay `unmount()` がタイマーを停止すること

## 残課題（m90時点での TODO）
- E2E（Chrome 実機/Playwright 等）での最低限動作確認の自動化
- 例外 UX の更なる改善
  - リトライ導線（同じ設定で再実行）
  - 失敗理由の粒度向上（特に 4xx/5xx の扱い）
- 表/コード/引用の扱い改善（抽出・プロンプト設計）
- ストリーミング表示（v2+）

## 結論要約
- v1.5 は「オンデマンド注入・長文承認・$1ハード上限・map-reduce・prompt caching」を維持しつつ、**閉じた後のタイマー停止**と**再注入時の初期化**で UX と保守性を強化した。
- さらに、classic scripts の制約を踏まえた **VM ベースのユニットテスト**を追加し、仕様逸脱の自動検知を強化した。