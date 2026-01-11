// Readability is injected as a standalone script (third_party/readability/Readability.js)
// and exposes a global `Readability` constructor in the page context.
declare const Readability: any;

namespace AS {
  export namespace Extract {
    type Candidate = {
      el: Element;
      tagScore: number;
      text: string;
      charCount: number;
      linkDensity: number;
      score: number;
    };

    function normalizeText(text: string): string {
      return text
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    function estimateLinkDensityFromHtml(html: string): number {
      try {
        const doc = new DOMParser().parseFromString(html || '', 'text/html');
        const root = doc.body;
        if (!root) return 0;

        const total = (root.textContent || '').trim().length;
        if (total <= 0) return 0;

        let linkTextLen = 0;
        const links = Array.from(root.querySelectorAll('a'));
        for (const a of links) {
          linkTextLen += (a.textContent || '').trim().length;
        }
        return Math.min(1, linkTextLen / total);
      } catch {
        return 0;
      }
    }

    function extractWithReadability(): ExtractOk | null {
      try {
        const ReadabilityCtor = (globalThis as any)?.Readability;
        if (typeof ReadabilityCtor !== 'function') return null;

        // Readability mutates the input document, so we operate on a clone.
        // This is click-to-run only, so the extra work is acceptable.
        const clone = document.cloneNode(true) as Document;
        const reader = new ReadabilityCtor(clone, {
          // Use the same threshold as our own guardrails.
          charThreshold: MIN_ARTICLE_CHARS
        });
        const parsed = reader.parse();
        if (!parsed) return null;

        const textRaw = typeof parsed.textContent === 'string' ? parsed.textContent : '';
        const text = normalizeText(textRaw);
        const charCount = text.length;
        if (charCount <= 0) return null;

        const title = (typeof parsed.title === 'string' && parsed.title.trim().length > 0) ? parsed.title.trim() : getPageTitle();
        const url = getPageUrl();
        const linkDensity = typeof parsed.content === 'string' ? estimateLinkDensityFromHtml(parsed.content) : 0;

        return {
          ok: true,
          title,
          url,
          text,
          charCount,
          linkDensity
        };
      } catch {
        return null;
      }
    }

    function collectText(el: Element): { text: string; charCount: number; linkDensity: number } {
      const blocks = Array.from(el.querySelectorAll('h1,h2,h3,p,li,blockquote,pre'));
      const parts: string[] = [];

      for (const node of blocks) {
        // Skip elements that are likely navigation / footer.
        const className = (node as HTMLElement).className || '';
        const id = (node as HTMLElement).id || '';
        const meta = `${className} ${id}`.toLowerCase();
        if (meta.includes('nav') || meta.includes('footer') || meta.includes('header') || meta.includes('breadcrumb')) {
          continue;
        }

        const raw = (node.textContent || '').trim();
        if (!raw) continue;
        // Avoid extremely short fragments.
        if (raw.length < 20) continue;
        parts.push(raw);
      }

      const text = normalizeText(parts.join('\n'));
      const totalLen = text.length;

      let linkTextLen = 0;
      try {
        const links = Array.from(el.querySelectorAll('a'));
        for (const a of links) {
          const t = (a.textContent || '').trim();
          linkTextLen += t.length;
        }
      } catch {
        // ignore
      }

      const linkDensity = totalLen > 0 ? Math.min(1, linkTextLen / totalLen) : 1;
      return { text, charCount: totalLen, linkDensity };
    }

    function tagBonus(el: Element): number {
      const tag = el.tagName.toLowerCase();
      if (tag === 'article') return 1.25;
      if (tag === 'main') return 1.15;
      return 1.0;
    }

    function gatherCandidates(): Element[] {
      const selectors = [
        'article',
        'main',
        '[role="main"]',
        '.article',
        '.post',
        '.entry-content',
        '#content',
        '#main',
        '#main-content'
      ];

      const els: Element[] = [];
      for (const sel of selectors) {
        try {
          const found = Array.from(document.querySelectorAll(sel));
          for (const el of found) els.push(el);
        } catch {
          // ignore
        }
      }

      // Always include body as a last resort.
      if (document.body) els.push(document.body);

      // Deduplicate preserving order.
      const seen = new Set<Element>();
      const uniq: Element[] = [];
      for (const el of els) {
        if (!seen.has(el)) {
          seen.add(el);
          uniq.push(el);
        }
      }
      return uniq;
    }

    export function extractArticle(): ExtractResult {
      try {
        // 1) Best-effort Readability extraction (higher success rate on general HTML articles).
        const readable = extractWithReadability();
        if (readable) {
          if (readable.charCount < MIN_ARTICLE_CHARS) {
            return {
              ok: false,
              code: 'TOO_SHORT',
              message: 'The extracted text is too short to summarize reliably.',
              charCount: readable.charCount,
              linkDensity: readable.linkDensity
            };
          }

          // If extremely link-heavy, it is likely not a normal article body.
          if (readable.linkDensity > 0.65 && readable.charCount < 10_000) {
            return {
              ok: false,
              code: 'LINK_HEAVY',
              message: 'The page looks link-heavy and may not be an article.',
              charCount: readable.charCount,
              linkDensity: readable.linkDensity
            };
          }

          return readable;
        }

        // 2) Fallback: heuristic extraction.
        const candidatesEls = gatherCandidates();
        const candidates: Candidate[] = [];

        for (const el of candidatesEls) {
          const { text, charCount, linkDensity } = collectText(el);
          if (charCount <= 0) continue;

          const bonus = tagBonus(el);
          // Penalize link-heavy containers.
          const score = charCount * (1 - Math.min(0.9, linkDensity)) * bonus;

          candidates.push({
            el,
            tagScore: bonus,
            text,
            charCount,
            linkDensity,
            score
          });
        }

        if (candidates.length === 0) {
          return { ok: false, code: 'NO_MAIN_TEXT', message: 'No text blocks were found.' };
        }

        candidates.sort((a, b) => b.score - a.score);
        const best = candidates[0];

        if (best.charCount < MIN_ARTICLE_CHARS) {
          return {
            ok: false,
            code: 'TOO_SHORT',
            message: 'The extracted text is too short to summarize reliably.',
            charCount: best.charCount,
            linkDensity: best.linkDensity
          };
        }

        // If extremely link-heavy, it is likely not a normal article body.
        if (best.linkDensity > 0.65 && best.charCount < 10_000) {
          return {
            ok: false,
            code: 'LINK_HEAVY',
            message: 'The page looks link-heavy and may not be an article.',
            charCount: best.charCount,
            linkDensity: best.linkDensity
          };
        }

        const title = getPageTitle();
        const url = getPageUrl();

        return {
          ok: true,
          title,
          url,
          text: best.text,
          charCount: best.charCount,
          linkDensity: best.linkDensity
        };
      } catch (err: any) {
        return { ok: false, code: 'UNKNOWN', message: err?.message || 'Unknown extraction error' };
      }
    }
  }
}
