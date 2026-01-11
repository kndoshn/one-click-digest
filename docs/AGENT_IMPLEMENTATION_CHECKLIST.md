# 実装チェックリスト（AIエージェント用 / TDD運用）

対象: v1.6-UX 設計（右上パネル / 4モード / Token見積 / 承認 / 全文分割 / $1.00上限 / prompt caching / Doneでフル再実行）

---

## 0. 運用ルール（AIエージェントに強制するチェック方法）

- 各コミット/PRで必ず以下を回す（落ちたら次に進まない）
  1) **Staticチェック**（lint/type/禁止事項）
  2) **Unitテスト**（抽出、見積、状態遷移、フォーマット検証、コスト上限）
  3) **Integrationテスト**（content↔backgroundメッセージ、Abort、エラー文言）
  4) **E2E最小**（パネルが出る、承認が出る、要約が表示されCopyできる、キャンセルできる）

- 以降のチェック項目には「自動チェック方法（例）」も併記します。  
  AIエージェントは“実装”ではなく“検証”を先に作り、**検証が失敗する状態から**実装で通す（TDD）。

### 現在の自動チェック実装（m100 / 2026-01-11）
- `test/manifest_permissions.test.js`: `manifest.json` の最小権限・`content_scripts` 禁止・host_permissions allowlist
- `test/no_secrets_in_content.test.js`: content 側への API/認証ヘッダー混入禁止
- `test/ensure_classic_scripts.test.js`: `dist/content/*.js` が classic-script であること（import/export 禁止）
- `test/state_machine.test.js`: 状態遷移 + stale runId 無視
- `test/estimate.test.js`: 見積（worst-case に repair を含む、hard limit 判定、prompt caching 係数）
- `test/format.test.js`: 出力フォーマット検証（4モード）
- `test/chunker.test.js`: chunking の分割
- `test/extract_static.test.js`: extractor の Readability + fallback を維持する回帰ガード
- `test/overlay_unmount_static.test.js`: unmount 時のタイマー停止回帰ガード
- `test/abort_registry.test.js`: Background の Abort registry が同一 runId の同時リクエストを正しく扱えること（count_tokens と要約の競合回避）
- `test/ux_invariants_static.test.js`: 4モード、Done言語変更フル再実行、Close時confirm+abort、Copyトーストの回帰ガード
- `test/e2e_simulated_controller_flow.test.js`: 注入される classic scripts を Node `vm` で評価し、DOM/Chrome API をスタブして「承認→map-reduce→repair」までの最小E2Eを自動検証

---

## 1. 絶対不変のプロダクト不変条件（Invariants）
このセクションは1つでも破ったら即差し戻し。

### 権限・セキュリティ
- [ ] **[INV-SEC-001]** APIキーは **Content Scriptに渡さない**（文字列としても渡さない）。
  - 自動チェック例:
    - `src/content/**` に `apiKey` / `x-api-key` / `anthropic` / `Authorization` が登場したらfail
    - grep: `rg -n "apiKey|x-api-key|Authorization|api\.anthropic\.com|anthropic" src/content && exit 1`
- [ ] **[INV-SEC-002]** Claude API呼び出しは **Background(Service Worker)のみ**で実施する。
  - 自動チェック例: `src/content/**` に `api.anthropic.com` 宛ての `fetch` があればfail
- [ ] **[INV-SEC-003]** `manifest.json` は **content_scripts を使わない**（クリック時注入のみ）。
  - 自動チェック例: manifestに `content_scripts` キーが存在したらfail
- [ ] **[INV-SEC-004]** 権限は最小: `activeTab`, `scripting`, `storage` 以外を追加しない（合意がない限り）。
  - 自動チェック例: permissions allowlistでスナップショット検証
- [ ] **[INV-SEC-005]** `host_permissions` は `https://api.anthropic.com/*` のみ（合意がない限り）。
  - 自動チェック例: allowlist検証

### UX仕様（固定）
- [ ] **[INV-UX-001]** UIは **右上パネル（Shadow DOM）**で表示する。
- [ ] **[INV-UX-002]** モードは **4択**（3行/5行/10行/TL;DR+12+結論）。
- [ ] **[INV-UX-003]** **Done画面で Mode/言語変更したら必ずフル再実行**（Extract→Preflight→(Confirm)→Map/Reduce）。
- [ ] **[INV-UX-004]** 要約処理中に×を押した場合は **キャンセル確認**を出し、OKならabortする。
- [ ] **[INV-UX-005]** Copyボタンでコピーでき、コピー後に **「コピーしました」**フィードバックが出る。

### コスト・見積・上限
- [ ] **[INV-COST-001]** Preflightで **文字数 / 推定トークン / 推定コスト / 推定所要時間**を表示する。
- [ ] **[INV-COST-002]** 推定コストのハード上限は **$1.00**。超えたら実行不可。
- [ ] **[INV-COST-003]** ハード上限判定は **reduce2（フォーマット修正）込み**の最悪ケースで判定する。

### 失敗時の方針
- [ ] **[INV-FAIL-001]** 抽出が「要約不適」と判断できる場合、**Claudeへ送らない**（待たせない）。
- [ ] **[INV-FAIL-002]** ネットワーク/認証/レート等の例外は **ユーザー向けメッセージ**に変換して表示する（生の例外は出さない）。

---

## 2. 実装フェーズ別チェック（TDDの“道しるべ”）

### Phase 0: リポジトリ骨格とCI
- [ ] `manifest.json` のスナップショット検証（permissions allowlist、content_scriptsなし）
- [ ] `src/content` に `anthropic` / `Authorization` 等が存在しないことの検証（grep/テスト）

### Phase 1: 注入とパネル表示
- [ ] アイコンクリックで注入される
- [ ] パネルが右上に出る（Shadow DOM）
- [ ] 4モードがある
- [ ] 2回目クリックで常に新規（idempotent）

### Phase 2: 状態機械
- [ ] `transition(state,event)` を純関数で実装
- [ ] 主要遷移テスト（DONE→EXTRACTING 等）
- [ ] runIdで古い応答を捨てる

### Phase 3: 本文抽出
- [ ] Readability＋fallback
- [ ] 不適判定（短すぎ等）で要約しない
- [ ] 理由を表示

### Phase 4: Preflight＋承認
- [ ] 概算→count_tokens更新
- [ ] 4項目表示
- [ ] $1.00超でブロック（reduce2込み）

### Phase 5+: Claude連携、map-reduce、caching、UX仕上げ
- [ ] Abortが確実に効く
- [ ] mode Dフォーマット
- [ ] Copyトースト
- [ ] prompt caching条件付き適用

---

## 3. “逸脱検知”のための禁止事項リスト（Red Flags）
- [ ] `<all_urls>` を入れた
- [ ] `content_scripts` を入れた
- [ ] content script から Claude API を呼んだ
- [ ] APIキーをcontentへ渡した
- [ ] Doneでreduce-only再実行を入れた（仕様違反）
- [ ] $1.00判定からreduce2を除外した
- [ ] 抽出失敗でもClaudeを呼んだ
- [ ] 例外が生のスタックトレースでUIに出た

---

## 結論要約
- このチェックリストは、AIエージェントが頻繁に自己検証しながら実装しても、仕様（最小権限、キー露出禁止、フル再実行、$1.00上限）から逸脱しないためのガードです。
