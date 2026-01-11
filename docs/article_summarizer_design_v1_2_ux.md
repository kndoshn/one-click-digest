# Article Summarizer Extension Design v1.2 (UX + Implementation Feedback)

> 本ドキュメントは **v1.1 UX設計**（docs/article_summarizer_design_v1_1_ux.md）をベースに、
> **現時点（25%マイルストーン）までの実装結果**から必要になった設計修正点を反映した差分設計です。
> 
> - v1.1: 仕様・UXの理想形（目標）
> - v1.2: 目標を壊さず、Chrome MV3の制約と保守性を踏まえた「実装しやすい設計」

---

## 1. 変更点サマリ（v1.1 → v1.2）

### 1.1 Content Scriptのパッケージング方針を明文化
- **背景**: `chrome.scripting.executeScript({ files: [...] })` で注入されるスクリプトは、
  実運用で **ESM（import/export）を前提にすると壊れやすい**
  （環境差・ビルド差・注入方法差で挙動がブレやすい）。

- **方針（v1.2）**:
  - Content側は **“classic script” 互換**を前提にする
  - 実装では、**複数ファイルを順序指定して注入**する
    - dist/content/runtime.js → i18n.js → models.js → state_machine.js → … → bootstrap.js
  - Contentは `namespace` で疑似モジュール化し、**保守性（分割）と注入互換性（非ESM）を両立**する

### 1.2 UXのフェーズ設計を「小さな記事は即実行」「長文は見積＋承認」に寄せる
- **短文（承認不要）**: 抽出後すぐ要約実行（ワンクリック完了）
- **長文（承認必要）**: Preflight（概算）を表示し、必要なら count_tokens による見積精密化→承認

### 1.3 長文分割要約は “設計は維持” しつつ、現段階は暫定挙動を許可
- v1の目標は **全文（分割）要約**（map-reduce）だが、25%時点では以下を暫定許容:
  - 本文送信は **MAX_ARTICLE_CHARS_TO_SEND** で clamp
  - chunkCount > 1 の場合は UI に「分割要約は後続で実装予定」注記を出す

> 注意: この暫定挙動は UX の破綻防止（極端に遅い/高額）と、
> 将来の map-reduce 実装に移行しやすいデータ構造を優先するため。

### 1.4 i18n（拡張UIローカライズ）を最初から導入
- Overlay UIの文言は `chrome.i18n.getMessage()` を使用（`public/_locales/*/messages.json`）
- 言語セレクタは Accept-Language に基づく選択肢を提示

---

## 2. “実装から見えた” 仕様・設計の補強ポイント

### 2.1 Inject対象URLのブロックルールを仕様化
- `chrome://` / `chrome-extension://` / `edge://` / `about:` / `view-source:` などは注入不可
- Contentが動作しないのは仕様であり、Background側で早期returnする

### 2.2 UI状態管理（State Machine）を “イベント駆動” に寄せる
- Controllerが直接DOMを触り続けるより、
  - state = reduce(state, event)
  - render(state)
  の構造にしたほうが保守性が高い
- ただしUX改善のため、
  - extract→estimate→次状態判定 を **バッチ適用**して “一瞬だけ出る中間画面” を抑制する

### 2.3 Token見積は二段階（rough → exact）で UX を壊さない
- rough は同期で即表示（待たせない）
- exact（count_tokens）は背景で行い、成功時だけ UI を更新

### 2.4 エラーは “ユーザー向け文言” と “開発者向け情報” を分離
- UIには i18n 済みの短いメッセージ
- console には runId とエラーコードを出す（APIキーや本文は出さない）

---

## 3. 現段階（25%）の実装対応表

### 3.1 実装済み（Done）
- Options: APIキーの保存（chrome.storage.local）
- Action click: on-demand inject（content_scripts なし）
- Overlay: Shadow DOM + 右上パネル + close/cancel
- 抽出: HTML記事向けヒューリスティック抽出（article/main/body候補 + link density）
- Preflight: rough見積（chars/tokens/cost/time） + hard limit ブロック
- Token refine: count_tokens API（APIキーありの場合）
- Single pass summary: Messages APIで単発要約（modeに応じた bullets 生成）
- Done: 結果表示 + Copy

### 3.2 未実装（Planned, v1.3+）
- map-reduce（chunk summary → reduce）
- prompt caching の本格適用（map/reduce共通プロンプトのキャッシュ）
- repair pass（フォーマット修正 reduce2）
- Done画面での mode/language変更の UX 微調整（現在は全再実行）

---

## 4. コード構成（責務分離）

### 4.1 Background（MV3 Service Worker）
- `src/background/index.ts`
  - 注入可否判定
  - inject files list 管理
  - GET_SETTINGS（apiKeySet）
  - COUNT_TOKENS（見積精密化）
  - RUN_SUMMARY（単発要約）

### 4.2 Content（Overlay + Controller）
- `src/content/runtime.ts` … util（runId, clipboard, messaging, accept languages 等）
- `src/content/models.ts` … mode定義・制限値・価格スナップショット
- `src/content/state_machine.ts` … UI state reducer
- `src/content/extract.ts` … 本文抽出
- `src/content/estimate.ts` … rough見積
- `src/content/overlay.ts` … Shadow DOM UI（render/dispatch）
- `src/content/controller.ts` … オーケストレーション
- `src/content/bootstrap.ts` … entry（classic script）

---

## 5. v1（最終目標）に向けた次の設計課題

### 5.1 map-reduceの「Chunk境界」「中間表現」を固める
- Chunkは “段落単位” を優先（文中で切らない）
- 中間表現は **短い bullet list** に固定し、reduceで最終フォーマットに統合

### 5.2 UX
- chunking時は進捗（n/m）を提示（ただし過剰なUI複雑化は避ける）
- Cancelは background 側の AbortController と連動（port/keep-alive含む）

### 5.3 コスト制御
- hard limit だけでなく、soft threshold（警告）を設ける
- count_tokens を “実行前に必ず” するかは UX と待ち時間のバランス

---
