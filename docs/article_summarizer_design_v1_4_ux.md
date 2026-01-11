# Article Summarizer Extension Design v1.4-UX

更新日: 2026-01-11

本ドキュメントは、現行実装（milestone: ~75%）を前提に、UX と保守性の観点から仕様・設計を整理したものです。

## 定義

### 目的
- ユーザーが閲覧中の **一般的な HTML 記事**から本文を抽出し、Claude で要約して **同一ページ上のオーバーレイ UI**に表示する。
- 要約の粒度（4モード）を切り替え、短時間で記事概要を理解する。
- 長文では **コスト/時間の見積もり**と **ユーザー承認**を挟み、意図しない高コスト実行を避ける。

### 非目的
- 常時注入（always-on）の content_scripts は行わない（アクションクリック時のみ注入）。
- PDF / SNS / Notion 等の特殊コンテンツ対応（v2+）。
- ストリーミング表示（v2+）。

## 要点

### UX フロー（基本）
1. 拡張アイコンをクリック → content 側へオンデマンド注入 → 右上パネル表示
2. 本文抽出（Readability → フォールバック）
3. 事前見積もり表示
   - 概算（文字数・CJK 比率ベース）
   - 可能なら `count_tokens` で入力 token を精緻化（成功時のみ UI を更新）
4. 承認が必要な場合のみ、ユーザー確認（Confirm）
5. 要約生成
   - 短文: single-pass
   - 長文: map-reduce + 1 回だけフォーマット修復（任意）
6. DONE: 要約表示、Copy、モード/言語切替（再実行）、Close

### UX 強化（v1.4）
- Confirm 画面に「**3行で実行**」ボタンを追加し、承認後でも軽量実行へ素早く切替できる（コスト/時間抑制）。
- Confirm 画面で「送信文字数 / 推定 tokens / 推定コスト / 推定所要」を必ず表示。

### 安全装置
- 事前見積もりの worst-case が **ハード上限（デフォルト $1.00）**を超える場合は実行不可（BLOCKED）。
- 長文は送信上限（デフォルト `MAX_ARTICLE_CHARS_TO_SEND=200,000`）で切り詰め、切り詰めた場合は必ず承認 UI を挟む。
- キャンセル/閉じるで API 呼び出しを abort。

## 仕様詳細

### 要約モード
| モード | 出力フォーマット | 目的 |
|---|---|---|
| `BULLETS_3` | 箇条書き 3 行 | 最短で把握 |
| `BULLETS_5` | 箇条書き 5 行 | 標準 |
| `BULLETS_10` | 箇条書き 10 行 | 重要点を多めに |
| `TLDR_12_CONCLUSION` | `TL;DR:` 1 行 + 箇条書き 12 行 + `Conclusion:` 1 行 | 長文の要点と結論 |

#### モードの自動フォールバック（短い記事）
- 選択されたモードに対して本文が短い場合、**より短いモードに自動調整**する（例: `TLDR_12_CONCLUSION` → `BULLETS_10`）。
- ユーザーにはトーストで通知する。
- 目的は「無理に行数を稼ぐことでの誤要約/水増し」を減らし、読みやすさを優先すること。

### 言語
- 既定は `Auto`（`Accept-Language` 優先順の先頭を採用）
- UI で `Accept-Language` の候補から手動選択可能
- 「ブラウザ言語」と「記事言語」がズレても、ユーザーが上書きできる

### 本文抽出
- 第一候補: Readability（clone した document を対象）
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

### モデルルーティング（デフォルト）
- Single / Map: `claude-haiku-4-5`
- Reduce / Repair: `claude-sonnet-4-5`

ユーザーは Options で map/final モデルを変更できる（ただし価格・速度・品質のトレードオフに注意）。

### Prompt caching（v1 で導入）
- 有効化すると、**長文 reduce/repair で共通の「chunk 要約ブロック」**を `cache_control: ephemeral` としてキャッシュし、フォーマット修復（repair）での再送コスト/待ち時間を抑える。
- TTL は `5m` / `1h` を Options で選択可能。
- キャッシュはモデルごとに「最小キャッシュ可能長」があるため、短い入力では指定しても無効化される。

### 見積もり（コスト/所要）
- 概算 token 推定: 文字数 + CJK 比率でラフ推定（上下限）
- 精緻化: `count_tokens` 成功時に input token を反映（ただし実 prompt より小さめになる可能性があるため、固定の安全マージンを加算）
- コスト推定:
  - 単発: input + output の概算
  - 長文: map（chunkCount 回）+ reduce（1回）の合計
  - worst-case: 上記 + repair（1回）を加算
  - prompt caching が有効な場合は、reduce の cache write 係数を worst-case 側に織り込む（安全側）

### キャンセル
- Cancel/Close → background に `ABORT_RUN`（runId）を送信し、進行中 fetch を abort
- UI は IDLE に戻し、キャンセルバナーを表示

## アーキテクチャ

### 構成
- MV3 service worker（background）
  - Claude API 呼び出し（Messages API + count_tokens）
  - AbortController 管理（runId 単位）
  - 注入（Readability + content bundle）
- Content（オンデマンド注入）
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

## 残課題（>75%）
- ストリーミング表示（SSE）
- エラー UX の更なる改善（リトライ導線、ユーザーが理解しやすい分類）
- 表/コード/引用の扱い改善（抽出・プロンプト設計）
- DONE 状態からの「同一抽出結果の再利用」モード（ただしユーザー要求では DONE 変更はフル再実行が既定）
- 多言語表示名（BCP47 → 表示名）