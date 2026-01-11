# Article Summarizer Extension Design v1.3-UX

更新日: 2026-01-11

## 定義

### 目的
ユーザーが閲覧中のページ（記事/ドキュメント）から本文を抽出し、Claude API を用いて指定フォーマットの要約を最小手数で取得できるようにする。

### 非目的
- 常時注入（always-on）の content_scripts は行わない（アクションクリック時のみ注入）。
- ページ内ハイライトや段落対応付けなどの高度 UI はこの段階では扱わない。
- 複数タブ横断の履歴管理は行わない。

## 要点

### UX の骨子
1. アクションクリックでオーバーレイを開く
2. 本文抽出（Readability → フォールバック）
3. 事前見積もり（概算→可能なら count_tokens で精緻化）
4. 必要時のみユーザー確認（高コスト/長文/切り詰め時）
5. 要約生成（短文は単発、長文は map-reduce）
6. DONE でコピー・閉じる・再実行

### 安全装置
- 事前見積もりの worst-case が **$1 を超える場合はブロック**（保守的に見積もる）
- キャンセル/閉じるで API 呼び出しを abort
- 長文は送信上限（MAX_ARTICLE_CHARS_TO_SEND）で切り詰める

## 仕様詳細

### モード
| モード | 出力フォーマット | 目的 |
|---|---|---|
| BULLETS_3 | 箇条書き 3 行 | 最短で把握 |
| BULLETS_5 | 箇条書き 5 行 | 標準 |
| BULLETS_10 | 箇条書き 10 行 | 重要点を多めに |
| TLDR_12_CONCLUSION | `TL;DR:` 1 行 + 箇条書き 12 行 + `Conclusion:` 1 行 | 長文の要点と結論 |

フォーマットは「検証→必要なら修復」を行う前提で、厳密に定義する。

### 事前見積もり
- 概算: 文字数と CJK 比率に基づくラフな token 推定
- 精緻化: Claude `count_tokens` を用いて入力 tokens を確定（成功時のみ UI に反映）
- chunking 判定: 入力 tokens が `CHUNK_TARGET_INPUT_TOKENS` を超えたら map-reduce を選択

### map-reduce（長文）
- Map: 文章を段落境界で分割し、各 chunk を「最大 5 箇条書き」に要約
- Reduce: すべての chunk 要約を統合し、モード指定のフォーマットで最終出力を生成
- 修復（任意）: フォーマットが崩れた場合、修復プロンプトで 1 回だけ再生成

モデルルーティング（デフォルト）
- Map: `claude-haiku-4-5`
- Reduce / Repair: `claude-sonnet-4-5`

### フォーマット検証・修復
- Content script 側で出力を検証
- 不一致の場合のみ background に修復依頼
- map-reduce の場合、**Map（chunk 要約）ステップ**で prompt caching（cache_control: ephemeral）を使い、複数チャンクで共通の system 指示をキャッシュする
- Reduce/Repair では現状キャッシュを積極活用していない（改善余地）

### キャンセル
- キャンセル/閉じる時に background に `ABORT_RUN` を送信し、進行中の fetch を abort
- UI 状態は IDLE に戻し、キャンセル通知バナーを表示

## アーキテクチャ

### 構成
- MV3 service worker (background)
  - Anthropic API 呼び出し
  - Abort 管理
  - スクリプト注入（Readability + content bundle）
- Content script
  - UI（Shadow DOM）
  - 抽出、見積もり、chunking、バリデーション、状態遷移
- Options
  - API キーの保存（chrome.storage.local）

### メッセージ（概要）
- COUNT_TOKENS
- RUN_SUMMARY_SINGLE
- RUN_SUMMARY_MAP
- RUN_SUMMARY_REDUCE
- RUN_SUMMARY_REPAIR
- ABORT_RUN

## 残課題（>50%）
- ストリーミング表示（SSE）
- エラーメッセージの細分化（401/429/5xx などの UX 改善）
- モデル/上限/ポリシーのオプション化（UI から変更可能に）
- chunking の品質向上（見出し優先、表やコードブロックの扱い）
- DONE 状態からの「同一抽出結果を再利用した再要約」（再抽出不要化）