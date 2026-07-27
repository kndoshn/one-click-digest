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

    // Bullets must be separated by exactly one blank line: bullet, blank, bullet, blank, ..., bullet.
    // `block` is expected to contain no lines other than the bullets themselves (headers/blank
    // padding around the block must be validated by the caller).
    function validateBulletBlock(block: string[], expectedCount: number): ValidationResult {
      const expectedLen = expectedCount * 2 - 1;
      if (block.length !== expectedLen) {
        return {
          ok: false,
          reason: `Expected ${expectedCount} bullets separated by blank lines, got ${block.length} line(s)`
        };
      }
      for (let i = 0; i < block.length; i++) {
        const line = block[i] ?? '';
        const trimmed = line.trim();
        if (i % 2 === 0) {
          if (isSummaryLine(line) || isConclusionLine(line)) {
            return { ok: false, reason: 'Unexpected header in bullet block' };
          }
          if (!isBulletLine(line)) {
            return { ok: false, reason: 'Expected bullet line' };
          }
        } else if (trimmed.length !== 0) {
          return { ok: false, reason: 'Expected blank line between bullets' };
        }
      }
      return { ok: true };
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

        const bulletBlock = lines.slice(tldrIndex + 2, conclusionIndex - 1);
        return validateBulletBlock(bulletBlock, 12);
      }

      // Bullet-only modes
      const expected = expectedBulletCount(mode);
      return validateBulletBlock(lines, expected);
    }
  }
}
