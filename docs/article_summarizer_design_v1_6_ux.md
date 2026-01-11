# Article Summarizer Extension Design v1.6-UX

更新日: 2026-01-11

本ドキュメントは、現行実装（milestone: **100%**）を前提に、UX と保守性の観点から仕様・設計を整理したものです。

## 目的
- ユーザーが閲覧中の **一般的な HTML 記事**から本文を抽出し、Claude で要約して **同一ページ上のオーバーレイ UI**に表示する。
- 要約の粒度（4モード）を切り替え、短時間で記事概要を理解する。
- 長文では **コスト/時間の見積もり**と **ユーザー承認**を挟み、意図しない高コスト実行を避ける。

## 非目的（v1）
- 常時注入（always-on）の `content_scripts` は行わない（アクションクリック時のみ注入）。
- PDF / SNS / Notion 等の特殊コンテンツ対応（v2+）。
- ストリーミング表示（v2+）。

## v1.6での改善（m100）

### 1) APIキー有無の判定を「UI側でブロックしない」
- 目的: 起動直後などで `GET_SETTINGS` 反映が間に合わない場合に、UI側の `apiKeySet=false` が原因で誤ブロックするレースを回避する。
- 方針:
  - UIは `apiKeySet=false` の時に注意文は出すが、要約実行は **Background の応答で最終判断**する。
  - Background が `api_key_missing` を返した場合は、UIでユーザー向けメッセージに変換して表示する。

### 2) 「チャンク化見込み→実際は1チャンク」フォールバックのモデル整合
- 目的: 見積（Estimate）と実際のClaude呼び出しモデルがズレることで、推定コストが過小になる/上限判定が破綻するリスクを排除する。
- 方針:
  - `estimate.chunkCount > 1` でも `Chunker.chunkText(...)` の結果が 1 チャンクだった場合、**single-pass として map model** で実行する。
  - repair（フォーマット修復）も single-pass と同じモデル（map）で実行する。

### 3) 自動検証の「最小E2E」を追加
- `dist/content/*.js` は MV3 で classic script として注入されるため、DOM込みのE2EをCIで安定稼働させるのが難しい。
- 代替として、Node の `vm` で classic scripts を評価し、DOM/Chrome API をスタブして
  - short: single-pass
  - long: approval → map-reduce → repair
 までを「コントローラ統合テスト」として自動検証する。
- 実装: `test/e2e_simulated_controller_flow.test.js`

### 4) Abortの堅牢化（同一 runId の同時リクエストを許容）
- 背景:
  - `COUNT_TOKENS` が走っている間にユーザーが承認して要約を開始するなど、同一 `runId` で複数リクエストが **一時的に並走**し得る。
- 方針:
  - Background は `runId -> Set<AbortController>` の **registry** を持ち、`ABORT_RUN` ではその runId の in-flight を **全て abort** する。
  - 新規リクエスト開始時に既存リクエストを暗黙 abort しない（意図しないキャンセルを防ぐ）。

### 5) Token refine のUX改善（refining表示が stuck しない）
- `count_tokens` は best-effort。APIキー未設定/通信失敗時は、
  - 例外で止めず、
  - 画面上の「refining」表示を解除し、
  - 概算見積のまま継続する。

## UXの要点

### 基本フロー
1. 拡張アイコンをクリック → content 側へオンデマンド注入 → 右上パネル表示
2. 本文抽出（Readability → フォールバック）
3. 事前見積もり（Preflight）
   - 概算（文字数・CJK 比率ベース）
   - 可能なら `count_tokens` で入力 token を精緻化（成功時のみ UI を更新）
4. 承認が必要な場合のみ、ユーザー確認（Confirm）
5. 要約生成
   - 短文: single-pass（map model）
   - 長文: map-reduce（map model → final model）+ 失敗時のみrepair
6. DONE: 要約表示、Copy、モード/言語切替（フル再実行）、Close

## 機能仕様（抜粋）

### 要約モード（4択）
| モード | 出力フォーマット | 用途 |
|---|---|---|
| `BULLETS_3` | 箇条書き 3 行 | 最短で把握 |
| `BULLETS_5` | 箇条書き 5 行 | 標準 |
| `BULLETS_10` | 箇条書き 10 行 | 重要点を多めに |
| `TLDR_12_CONCLUSION` | `TL;DR:` 1 行 + 箇条書き 12 行 + `Conclusion:` 1 行 | 長文の要点と結論 |

#### モード自動フォールバック
- 選択されたモードに対して本文が短い場合、より短いモードに自動調整し、トーストで通知。
- 目的: 無理に行数を稼いで誤要約/水増しを誘発しない。

### 言語
- 既定は `Auto`（`Accept-Language` 優先順先頭を採用）
- UIで `Accept-Language` 候補から手動選択可能
- DONEで言語変更した場合は **必ずフル再実行**

### 本文抽出
- Readability（cloneした `document`）を第一候補
- フォールバック: `article/main/[role=main]` 等 + 不要要素除外 + 最長テキスト採用
- 「要約できない」判定（緩め）: 短すぎ/リンク密度が高すぎ/本文が取れない 等

### 長文（map-reduce）
- chunking: 段落境界優先 + 大段落は分割
- Map: 各 chunk を最大 5 箇条書きに要約
- Reduce: chunk要約を統合して指定モードのフォーマットで出力
- Repair: フォーマット検証失敗時のみ 1 回

### 見積もり（Preflight/Confirm）
- 表示: 抽出文字数/送信文字数/推定token/推定コスト/推定所要時間
- $ハード上限（既定 $1.00）: repair込み worst-case が超える場合は実行不可

### Prompt caching
- reduce/repair で共通 prefix を `cache_control: ephemeral` で指定（Optionsで on/off + TTL）
- モデル別の最小キャッシュ可能長を下回る場合は効果が出ない

## 検証戦略（TDD的チェック）

### 自動検証の柱
- 状態遷移（runId のstale対策を含む）
- 見積（worst-case / hard limit / caching係数）
- フォーマット検証（4モード）
- chunking
- 抽出（Readability + fallback の存在）
- 最小E2E（controller統合: approval → map-reduce → repair）

## OSS公開時の注意（README/PRIVACYと整合）

- 本リポジトリは OSS として公開する前提のため、
  - ライセンス（`LICENSE`）
  - 第三者ライセンス（`THIRD_PARTY_NOTICES.md`）
  - プライバシーポリシー（`PRIVACY.md`）
  - 脆弱性報告（`SECURITY.md`）
  を用意する。
- Chrome Web Store に公開する場合は、ストア要件に合わせてプライバシーポリシー URL 等を追加する（本リポジトリの `PRIVACY.md` を基に整備）。
