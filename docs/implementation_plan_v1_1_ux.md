# 実装計画書（Detailed Implementation Plan）v1.1-UX

対象: Article Summarizer Chrome Extension（MV3 / 右上パネル / Claude要約）  
前提ドキュメント:
- `article_summarizer_design_v1_1_ux.md`（UX改善版設計）
- `ui_state_machine_v1_1_ux.md`（UI状態遷移図）

この計画書は **AIエージェントが順番に実装できる粒度**で、かつ **逸脱検知（TDD）**を前提にした手順です。  
各ステップは「テスト追加 → 失敗確認 → 実装 → 通過」の順で進めます。

---

## 0. 実装のガードレール（この計画書の前提）

### 0.1 絶対に守る不変条件（Invariants）
（要点のみ。詳細は実装チェックリストを参照）
- `manifest.json` は **MV3**、権限は原則 `activeTab`, `scripting`, `storage` のみ
- `content_scripts` は使わず **クリック時注入のみ**
- APIキーは **Backgroundでのみ**保持・使用（Content Scriptに渡さない）
- UIは **右上パネル**（Shadow DOM）
- モードは **4択**（3行/5行/10行/TL;DR+12+結論）
- Preflightで **文字数/推定トークン/推定コスト/推定時間** を表示
- 推定コストのハード上限は **$1.00**（**reduce2まで含めた最悪ケース**で判定）
- Doneで Mode/言語変更したら **常にフル再実行**（Extract→Preflight→Confirm→Summarize）
- 要約中に×で閉じる場合は **キャンセル確認**、OKでabort

---

## 1. 実装アプローチ（高レバレッジな順序）

### 1.1 実装順序の原則
1) **土台（ビルド/CI/型/テスト）を先に固める**  
2) **UIの枠**を最初に出す（価値が見える）  
3) **state machine** をコード化し、以降の全実装は state machine に従って進める  
4) **抽出→見積→承認**を通して「送信前に止まれる」体験を完成させる  
5) 最後に **Claude連携**と **map-reduce**（失敗時の挙動とabortを最優先で）  
6) **prompt caching**、フォーマット修正（reduce2）、UX仕上げ

### 1.2 実装モード（AIエージェント運用）
- 各マイルストーンで `pnpm test` が通ることをゲートにする
- 逸脱しやすい点（権限、Done再実行、$1.00上限、キー露出）は**grep + snapshotテスト**で強制する
- 仕様の未確定を勝手に増やさない（追加の機能や権限は入れない）

---

## 2. 技術スタック／ツール（推奨）

### 2.1 言語・ビルド
- TypeScript
- Vite（拡張の複数エントリビルド: background / content / options）
- ESLint + Prettier

### 2.2 テスト
- Unit/Integration: Vitest（jsdom）
- Chrome API mock: `sinon-chrome` など（任意）
- E2E（任意/後回し）: Playwright（extensionロードはやや難易度が高いので「最小」）

### 2.3 コマンド（例）
- `pnpm dev`：開発ビルド（watch）
- `pnpm build`：dist生成
- `pnpm lint`：静的解析
- `pnpm test`：全テスト
- `pnpm test:watch`：TDD用

---

## 3. リポジトリ構成（v1.1-UX推奨）

```
src/
  background/
    index.ts                 # onClicked, message handlers
    claude/
      client.ts              # fetch wrapper（messages, count_tokens）
      prompts.ts             # prompt templates（mode別 / map/reduce/repair）
      caching.ts             # cache_controlの付与規則
      usage.ts               # usageパース（cache read/write等）
    cost/
      pricing.ts             # モデル別価格（手更新しやすい1ファイル）
      estimator.ts           # cost/time/token推定（worst-case含む）
    runtime/
      abortRegistry.ts       # requestId -> AbortController
      errors.ts              # error code -> userMessage
      types.ts               # shared types（msg payload等）
    settings/
      store.ts               # chrome.storage.local wrapper
  content/
    bootstrap.ts             # 注入時エントリ（idempotent）
    overlay/
      mount.ts               # Shadow DOM生成、ルート
      view.ts                # DOM描画（state -> view）
      controller.ts          # state machine + side effects
      stateMachine.ts        # transition(state, event)
      uiStrings.ts           # i18nキー対応
      clipboard.ts           # copy実装（fallback含む）
    extract/
      readability.ts         # Readability vendor wrapper
      extractArticle.ts      # extract pipeline
      heuristics.ts          # 不適判定（短すぎ/リンク密度など）
    preflight/
      roughEstimate.ts       # 文字数ベース概算
      refineEstimate.ts      # background count_tokens依頼・更新
    messaging/
      port.ts                # runtime.connect, runId整合
      protocol.ts            # msg types (content side)
  options/
    index.ts
    view.ts
    storage.ts
public/
  manifest.json
  options.html
  icons/*
third_party/
  readability/Readability.js
fixtures/
  short_article.html
  long_article.html
  non_article.html
docs/
  article_summarizer_design_v1_1_ux.md
  ui_state_machine_v1_1_ux.md
  AGENT_IMPLEMENTATION_CHECKLIST.md
```

---

## 4. 共有データモデル（必須。先に型を作る）

### 4.1 基本型
- `RunId`: string（uuid）
- `Mode`: `'BULLETS_3' | 'BULLETS_5' | 'BULLETS_10' | 'TLDR_12_CONCLUSION'`
- `LanguageChoice`: `{ type: 'auto' } | { type: 'fixed', tag: string }`  
  - tagはAccept-Language由来（例: `ja`, `en-US`）

### 4.2 Preflight推定
- `Estimate`:
  - `charCount`
  - `inputTokens`（range: low/expected/high）
  - `outputTokensMax`
  - `chunkingPlan`（single or chunking, chunkCount）
  - `costUsd`（range）
  - `timeSec`（range）
  - `hardLimit`: `{ ok: boolean, reason?: string }`

### 4.3 UI状態
- `UIState`:
  - `stateId`（state machineのState）
  - `runId`
  - `selectedMode`
  - `selectedLanguage`
  - `articleMeta`（url, title）
  - `extractedText?`
  - `estimate?`
  - `progress?`（phase, current, total）
  - `resultMarkdown?`
  - `warning?`
  - `error?`（userMessage, code）

### 4.4 メッセージプロトコル（Content ↔ Background）
- content→background（必須）
  - `GET_SETTINGS`
  - `COUNT_TOKENS`
  - `SUMMARIZE_SINGLE`
  - `SUMMARIZE_MAP_CHUNK`
  - `SUMMARIZE_REDUCE`
  - `SUMMARIZE_REPAIR`
  - `ABORT_REQUEST`（requestId）
- background→content（必須）
  - `SETTINGS`
  - `TOKENS_COUNTED`
  - `SUMMARY_OK`
  - `SUMMARY_ERROR`
  - `ACK_ABORT`

> 注意: MV3の生存性を考えると、**backgroundは大きな状態を持たない**設計が有利。  
> content側が orchestration（map-reduceのループ）を担い、backgroundは「単発API呼び出し」を行う。

---

## 5. マイルストーン別 実装手順（TDDゲート付き）

以下、M0→M8の順に進める。  
各マイルストーンの「DoD（Definition of Done）」を満たすまで次へ進まない。

---

### M0: スキャフォールド（ビルド・CI・テスト基盤）
**目的**: 以降の実装を安全に進める土台を作る。

#### タスク
- [ ] `pnpm init` / `tsconfig.json` / ESLint / Prettier
- [ ] Viteで複数エントリ出力（background/content/options）
- [ ] `public/manifest.json` と `options.html` の配置
- [ ] Vitestを導入し、サンプルテスト1本が通る
- [ ] `fixtures/` を配置
- [ ] docs/ に既存設計書をコミット

#### 追加テスト
- [ ] `manifest.snapshot.test.ts`（permissions allowlist, content_scriptsなし）
- [ ] `no_secret_in_content.test.ts`（content/配下にanthropicやAuthorization等がない）

#### DoD
- `pnpm build && pnpm test` が成功
- distに background/content/options が出力される

---

### M1: クリック注入と右上パネル（UIの枠）
**目的**: “起動して見える”状態を作る（価値が可視化）。

#### タスク
- [ ] background: `chrome.action.onClicked` で `executeScript`（content bootstrap）を実行
- [ ] content: `bootstrap.ts` はidempotent  
  - 既存パネルがあれば破棄して新規作成（常に新規）
- [ ] overlay: Shadow DOMで右上パネルを描画（Idleの4モード表示）
- [ ] `×` で閉じる（CLOSED）

#### 追加テスト
- [ ] `bootstrap.idempotent.test.ts`（2回呼んでもパネルが1つだけ）
- [ ] `overlay.shadowdom.test.ts`（shadowRootがある）

#### DoD
- ローカルChromeでクリック→右上パネル表示→×で閉じるが動作

---

### M2: State machineの実装（UIの芯）
**目的**: 以降の全機能を「状態遷移で拘束」して逸脱を防ぐ。

#### タスク
- [ ] `stateMachine.ts`: `transition(state,event)` を純関数で実装
- [ ] `controller.ts`: transitionに従い side effects（抽出/見積/通信）を呼ぶ枠を作る
- [ ] `runId` を生成し、非同期応答はrunId一致のみ反映

#### 追加テスト（必須）
- [ ] `stateMachine.core.test.ts`
  - `DONE + EVT_LANGUAGE_CHANGE -> EXTRACTING`（フル再実行）
  - `SUMMARIZING_* + EVT_CLOSE_CLICK(confirm OK) -> CANCELLED`（abort）
  - `PREFLIGHT_* + EVT_HARD_LIMIT_BLOCKED -> BLOCKED_HARD_LIMIT`
- [ ] `runId.drop_old_response.test.ts`

#### DoD
- UIはまだダミーでもよいが、主要遷移がユニットテストで固定される

---

### M3: 本文抽出（Readability）と「要約しない」判定
**目的**: “送信前に止める”ための抽出品質と不適判定を作る。

#### タスク
- [ ] Readabilityを `third_party/` に導入し、wrapperを作る
- [ ] `extractArticle.ts`:
  - Readability優先、fallback: article/main抽出
  - 正規化（空白/改行）
- [ ] `heuristics.ts`:
  - `MIN_CHAR_FOR_SUMMARY`（例: 1000 chars）
  - リンク密度、反復率で「不適」判定（ハード停止/ソフト警告）
- [ ] 不適時は `ERROR` 状態へ（userMessageは“次の行動”付き）

#### 追加テスト
- [ ] `extract.short.test.ts`（短文→不適）
- [ ] `extract.long.test.ts`（長文→ok）
- [ ] `extract.non_article.test.ts`（非記事→不適）
- [ ] `extract.never_calls_background.test.ts`（不適時は通信しない）

#### DoD
- 3種fixtureで期待通りに `ok/理由` が返る
- 不適時はClaudeに送らない

---

### M4: Preflight（概算→count_tokens精密化）と承認UI
**目的**: ユーザーが「時間/コスト」を理解してから実行できる。

#### タスク
- [ ] `roughEstimate.ts`（charベース、言語係数でlow/expected/high）
- [ ] `estimator.ts`（pricing + worst-case計算、reduce2込み）
- [ ] UIに見積表示（4項目必須）
- [ ] `refineEstimate.ts`:
  - backgroundに `COUNT_TOKENS` を依頼
  - 成功時のみ見積更新（失敗は無視して継続）
- [ ] `CONFIRMING`:
  - 詳細を折りたたみ表示（概要→詳細）
  - `実行` / `軽量モード(3行)` / `キャンセル`
- [ ] `$1.00` 超えは `BLOCKED_HARD_LIMIT`（実行不可、短いモード導線）

#### 追加テスト
- [ ] `cost.hard_limit.test.ts`（$1.01→blocked）
- [ ] `cost.include_repair.test.ts`（repair込みで上がる）
- [ ] `preflight.render.test.ts`（4項目表示）
- [ ] `count_tokens.fail_does_not_block.test.ts`

#### DoD
- ローカルUIで「見積→承認/ブロック」が一連で動く（まだClaude呼び出しはダミーでも良い）

---

### M5: Options（APIキー保存）と設定導線
**目的**: 使える状態にする（キー未設定時のUX含む）。

#### タスク
- [ ] options UI: APIキー入力（mask）、保存、検証（空は不可）
- [ ] storage wrapper（get/set）
- [ ] content側:
  - 起動時に `GET_SETTINGS`
  - 未設定なら `設定を開く` ボタンを表示（Optionsへのリンク）

#### 追加テスト
- [ ] `settings.store.test.ts`（get/set）
- [ ] `ui.api_key_missing.test.ts`（未設定時の導線が出る）

#### DoD
- APIキー設定→contentで検知できる

---

### M6: Claudeクライアント（Background）と単発要約（single）
**目的**: まず短〜中記事を確実に要約できる最短経路を完成させる。

#### タスク
- [ ] `client.ts`:
  - `countTokens(messages)`（Token Count API）
  - `messagesCreate(payload)`（要約生成）
  - AbortController対応（requestId単位）
- [ ] `prompts.ts`:
  - system（共通）
  - mode A/B/C/D の userテンプレ
  - 出力制約（行数、箇条書き、Dの見出し）
- [ ] content controller:
  - single条件なら `SUMMARIZE_SINGLE` を呼ぶ
  - 返却markdown→validate→必要ならrepairへ

#### 追加テスト
- [ ] `prompt.build.test.ts`（mode別の要求が入る）
- [ ] `single.success.integration.test.ts`（fetchモックでOK）
- [ ] `abort.single.test.ts`

#### DoD
- 短〜中記事で要約がDoneまで到達
- Copyが動き、トーストが出る

---

### M7: 長文（map-reduce）・進捗・reduce2（フォーマット修正）
**目的**: v1の核（全文分割）を安定動作させる。

#### タスク
- [ ] `chunker.ts`:
  - 段落境界でchunk生成（target token/char）
  - chunk数見積
- [ ] content controller（orchestration）:
  - chunks配列を持ち、順次 `SUMMARIZE_MAP_CHUNK` を呼ぶ
  - `progress i/n` をUIへ反映（SUMMARIZING_MAP）
  - chunkSummariesが揃ったら reduce呼び出し（SUMMARIZING_REDUCE）
- [ ] reduce:
  - chunkSummariesを入力に mode別フォーマットで出力
- [ ] validateFormat:
  - A/B/C: 箇条書きN行
  - D: TL;DR + 12 bullets + 結論
- [ ] repair（reduce2）:
  - “内容は変えず形式だけ修正”を要求
  - 最大1回まで

#### 追加テスト
- [ ] `chunker.test.ts`（paragraph保持、max/min）
- [ ] `map_reduce.flow.test.ts`（map→reduce→done）
- [ ] `format.invalid_then_repair.test.ts`（NG→repair→OK）
- [ ] `abort.map_loop.test.ts`（途中キャンセルで停止、以後呼ばない）

#### DoD
- 長文fixtureで承認→map進捗→reduce→done が通る
- 途中キャンセルが確実に止まる

---

### M8: Prompt caching（v1導入）＋ UX仕上げ（完全版）
**目的**: 仕様通りの最終品質へ（コストとUXの安定）。

#### タスク（Prompt caching）
- [ ] `caching.ts`:
  - `shouldCache({model, tokens, mode, phase})` を実装
  - TTLは `5m` 固定（v1）
- [ ] caching適用ポイント（推奨）:
  - **reduce1で巨大入力（chunkSummaries）が十分長い場合、cache_controlを付与**  
    - 目的: reduce2（repair）を安くする  
    - ただし「無差別ON」ではなく条件付き（mode D / 長文 / 直近でrepair発生など）
- [ ] `usage.ts`:
  - cache read/writeのusageを抽出し、必要ならUIの詳細に表示（任意）

#### タスク（UX仕上げ）
- [ ] 進捗表示: `要約作成中…` + `2/8`（簡易でOK）
- [ ] DoneでMode/言語変更時:
  - state machine上はフル再実行（EXTRACTINGへ）
  - 表示上は前回要約を薄く残し `更新中` ラベル（混同防止）
- [ ] エラーの“次アクション”ボタン（再試行、設定を開く、短いモードで実行）

#### 追加テスト
- [ ] `caching.apply_conditions.test.ts`（条件でcache_control付与）
- [ ] `cost.with_caching_bounds.test.ts`（表示レンジは低/高を持てる）
- [ ] `done.change_triggers_full_rerun.test.ts`（E2E or integration）
- [ ] `toast.copy.test.ts`

#### DoD
- prompt caching ONでpayloadにcache_controlが入る（条件付き）
- 全チェックリスト（INV）に違反がない

---

## 6. 実装詳細（AIエージェントが迷いやすい論点の指示）

### 6.1 Doneでフル再実行（仕様固定）の実装指針
- Mode/言語UIはヘッダ固定に置く
- 変更イベント発生時:
  1) `runId` を更新（新Run）
  2) stateを `EXTRACTING` に遷移
  3) 表示上は直前のmarkdownを残し `更新中` ラベル
  4) 新RunがDoneになったら置換

> “map結果を再利用する”実装は仕様違反なので入れない（将来のv2で検討）。

### 6.2 $1.00ハード上限（reduce2込み）
- `estimateWorstCaseUsd` を別関数として固定し、**それだけ**で実行可否を決める
- UI表示は `expected〜worst` のレンジでよいが、ボタンのenable/disableは `worst` 基準

### 6.3 Token Count API（失敗は無視）
- 失敗したら `COUNT_TOKENS_FAIL` を出すが、UIは概算を維持して進める
- count_tokens成功時のみ「数値更新」し、必要なら Confirming/Blocked に遷移し直す

### 6.4 Abort設計
- 「要約中に×」は確認→OKで `CANCEL` と同等に扱う
- mapループは content側で回すため、キャンセル時は
  - in-flight request abort（backgroundに requestId を送る）
  - 以後のchunk送信を停止

### 6.5 コピー（Clipboard）
- まず `navigator.clipboard.writeText`（ユーザークリックの直後に呼ぶ）
- 失敗したら `textarea + execCommand('copy')` のfallback
- 成功で `コピーしました` トースト（2秒）

---

## 7. リリース前チェック（Definition of Release）
- [ ] manifest権限が最小（allowlist）で固定
- [ ] Content側にAPIキーやanthropic headerが存在しない（grep）
- [ ] 短文: single要約が完了する
- [ ] 長文: 承認→map進捗→reduce→done が完了する
- [ ] $1.00超: ブロックされ、短いモード導線がある
- [ ] cancel: 途中停止できる（in-flight abort）
- [ ] Copy: コピー成功 + トースト
- [ ] i18n: UI文言が少なくとも ja/en で成立
- [ ] READMEに「APIキーは端末内に保存」「送信内容（本文/タイトル/URL）」「コスト発生」明記

---

## 8. 付録：AIエージェント向け“1ステップの実装テンプレ”
各タスクはこの形式で進める（逸脱防止）。

1) **追加するテスト**（Given/When/Then）を1つ書く  
2) テストが落ちることを確認する  
3) 最小の実装で通す  
4) リファクタ（重複排除）  
5) `pnpm test` を通してコミット  
6) 変更が Invariants を破っていないか（grep + manifest snapshot）を確認

---

## 結論要約
- この計画は「UI枠→state machine→抽出→見積/承認→single→map-reduce→caching/UX仕上げ」の順で、**価値の可視化と逸脱防止**を両立させます。  
- 特に **$1.00上限（reduce2込み）** と **DONEフル再実行** は初期からテスト固定し、後から仕様が崩れない構造にします。
