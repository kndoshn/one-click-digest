namespace AS {
  export namespace Chunker {
    function splitParagraphs(text: string): string[] {
      // Prefer paragraph boundaries produced by the extractor.
      const normalized = (text || '').replace(/\r\n/g, '\n').trim();
      if (!normalized) return [];
      return normalized
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
    }

    function splitLargeParagraph(para: string, targetTokens: number): string[] {
      // Fallback: split by approximate char count; try to cut on whitespace/punctuation.
      const tokens = Estimate.estimateTokens(para);
      const high = Math.max(1, tokens.high);
      const charsPerToken = para.length / high;
      const maxChars = Math.max(500, Math.floor(charsPerToken * targetTokens));

      const out: string[] = [];
      let i = 0;
      while (i < para.length) {
        let end = Math.min(para.length, i + maxChars);

        // Try to find a nicer break point within the last ~120 chars.
        const windowStart = Math.max(i + 200, end - 120);
        const window = para.slice(windowStart, end);
        const m = window.match(/([\s\n]|[。！？.!?])(?=[^\s\n]*$)/);
        if (m && m.index !== undefined) {
          end = windowStart + m.index + 1;
        }

        const chunk = para.slice(i, end).trim();
        if (chunk) out.push(chunk);
        i = end;
      }
      return out;
    }

    /**
     * Chunk by paragraph boundaries aiming for targetTokens (rough) per chunk.
     * Output chunks are plain text.
     */
    export function chunkText(text: string, targetTokens: number): string[] {
      const paras0 = splitParagraphs(text);
      if (paras0.length === 0) return [];

      // Expand any huge paragraph first.
      const paras: string[] = [];
      for (const p of paras0) {
        const t = Estimate.estimateTokens(p).high;
        if (t > targetTokens * 1.2) {
          paras.push(...splitLargeParagraph(p, targetTokens));
        } else {
          paras.push(p);
        }
      }

      // Performance notes:
      // - Avoid repeatedly calling Estimate.estimateTokens() on the growing "candidate" string.
      //   That leads to quadratic-time scans on long articles. Instead, keep running char/CJK
      //   counts and estimate from those.
      // - Avoid repeated string concatenations; keep an array and join once per chunk.

      const SEP = '\n\n';
      const sepChars = SEP.length;

      const chunks: string[] = [];

      let currentParas: string[] = [];
      let currentChars = 0;
      let currentCjk = 0;

      const flush = () => {
        const joined = currentParas.join(SEP).trim();
        if (joined) chunks.push(joined);
        currentParas = [];
        currentChars = 0;
        currentCjk = 0;
      };

      for (const para of paras) {
        const paraChars = para.length;
        const paraCjk = Estimate.countCjkChars(para);

        if (currentParas.length === 0) {
          currentParas.push(para);
          currentChars = paraChars;
          currentCjk = paraCjk;
          continue;
        }

        const nextChars = currentChars + sepChars + paraChars;
        const nextCjk = currentCjk + paraCjk;
        const nextHigh = Estimate.estimateTokensFromCounts(nextChars, nextCjk).high;

        if (nextHigh <= targetTokens) {
          currentParas.push(para);
          currentChars = nextChars;
          currentCjk = nextCjk;
        } else {
          flush();
          currentParas.push(para);
          currentChars = paraChars;
          currentCjk = paraCjk;
        }
      }

      if (currentParas.length > 0) flush();
      return chunks;
    }
  }
}
