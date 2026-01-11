namespace AS {
  export namespace Format {
    export type ValidationOk = { ok: true };
    export type ValidationFail = { ok: false; reason: string };
    export type ValidationResult = ValidationOk | ValidationFail;

    const BULLET_RE = /^\s*(?:[-*•・]\s+|\d+[.)]\s+)/;

    function normalize(text: string): string {
      return String(text || '').replace(/\r\n/g, '\n').trim();
    }

    export function expectedBulletCount(mode: SummaryMode): number {
      switch (mode) {
        case 'BULLETS_3':
          return 3;
        case 'BULLETS_5':
          return 5;
        case 'BULLETS_10':
          return 10;
        case 'TLDR_12_CONCLUSION':
          return 12;
      }
    }

    export function extractBulletLines(text: string): string[] {
      const out: string[] = [];
      for (const line of normalize(text).split('\n')) {
        if (BULLET_RE.test(line)) out.push(line.trim());
      }
      return out;
    }

    function firstNonEmptyLine(lines: string[]): string | undefined {
      for (const l of lines) {
        const s = l.trim();
        if (s.length > 0) return s;
      }
      return undefined;
    }

    const SUMMARY_LABELS = ['Summary', '要約', 'Résumé', 'Zusammenfassung', 'Resumen', 'Sintesi', 'Resumo', '摘要', '요약'];
    const CONCLUSION_LABELS = ['Conclusion', '結論', 'Fazit', 'Conclusión', 'Conclusione', 'Conclusão', '结论', '결론'];

    function escapeRegex(value: string): string {
      return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    const SUMMARY_RE = new RegExp(`^\\s*(?:${SUMMARY_LABELS.map(escapeRegex).join('|')})\\s*:`, 'i');
    const CONCLUSION_RE = new RegExp(`^\\s*(?:${CONCLUSION_LABELS.map(escapeRegex).join('|')})\\s*:`, 'i');

    export function isSummaryLine(line: string): boolean {
      return SUMMARY_RE.test(line.trim());
    }

    export function isConclusionLine(line: string): boolean {
      return CONCLUSION_RE.test(line.trim());
    }

    export function isBulletLine(line: string): boolean {
      return BULLET_RE.test(line);
    }

    export function validate(mode: SummaryMode, text: string): ValidationResult {
      const cleaned = normalize(text);
      const lines = cleaned.split('\n');
      const first = firstNonEmptyLine(lines) || '';

      if (mode === 'TLDR_12_CONCLUSION') {
        if (!isSummaryLine(first)) {
          return { ok: false, reason: 'Missing Summary line' };
        }

        const tldrIndex = lines.findIndex((l) => isSummaryLine(l));
        const conclusionIndex = lines.findIndex((l) => isConclusionLine(l));
        if (tldrIndex < 0) {
          return { ok: false, reason: 'Missing Summary line' };
        }
        if (conclusionIndex < 0) {
          return { ok: false, reason: 'Missing Conclusion line' };
        }
        if (tldrIndex >= conclusionIndex) {
          return { ok: false, reason: 'Summary must come before Conclusion' };
        }
        for (let i = 0; i < tldrIndex; i++) {
          if (lines[i].trim().length > 0) {
            return { ok: false, reason: 'Unexpected content before Summary line' };
          }
        }
        if (lines[tldrIndex + 1] === undefined || lines[tldrIndex + 1].trim() !== '') {
          return { ok: false, reason: 'Missing blank line after Summary line' };
        }
        if (lines[conclusionIndex - 1] === undefined || lines[conclusionIndex - 1].trim() !== '') {
          return { ok: false, reason: 'Missing blank line before Conclusion line' };
        }
        for (let i = conclusionIndex + 1; i < lines.length; i++) {
          if (lines[i].trim().length > 0) {
            return { ok: false, reason: 'Unexpected content after Conclusion line' };
          }
        }

        const bullets: string[] = [];
        for (let i = tldrIndex + 2; i <= conclusionIndex - 2; i++) {
          const line = lines[i] ?? '';
          const trimmed = line.trim();
          if (trimmed.length === 0) {
            return { ok: false, reason: 'Unexpected blank line in bullet section' };
          }
          if (!isBulletLine(line)) {
            return { ok: false, reason: 'Expected bullet line in TLDR mode' };
          }
          bullets.push(trimmed);
        }

        if (bullets.length !== 12) {
          return { ok: false, reason: `Expected 12 bullets, got ${bullets.length}` };
        }

        return { ok: true };
      }

      // Bullet-only modes
      const expected = expectedBulletCount(mode);
      const nonEmpty = lines.filter((line) => line.trim().length > 0);
      for (const line of nonEmpty) {
        if (isSummaryLine(line) || isConclusionLine(line)) {
          return { ok: false, reason: 'Unexpected header in bullet-only mode' };
        }
        if (!isBulletLine(line)) {
          return { ok: false, reason: 'Unexpected non-bullet line' };
        }
      }
      if (nonEmpty.length !== expected) {
        return { ok: false, reason: `Expected ${expected} bullets, got ${nonEmpty.length}` };
      }

      return { ok: true };
    }
  }
}
