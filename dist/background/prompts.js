// Prompt builders for the summarization pipeline (single pass, map, reduce, repair).
export const MAP_CHUNK_MAX_OUTPUT_TOKENS = 220;
const MODE_MAX_OUTPUT_TOKENS = {
    BULLETS_3: 450,
    BULLETS_5: 700,
    BULLETS_10: 1200,
    TLDR_12_CONCLUSION: 1600
};
const BULLET_MODE_COUNTS = {
    BULLETS_3: 3,
    BULLETS_5: 5,
    BULLETS_10: 10
};
export function modeMaxOutputTokens(mode) {
    return MODE_MAX_OUTPUT_TOKENS[mode];
}
function normalizeLang(language) {
    return String(language || '').trim().toLowerCase();
}
function headerLabelsFor(language) {
    const lang = normalizeLang(language);
    if (lang.startsWith('ja'))
        return { summary: '要約', conclusion: '結論' };
    if (lang.startsWith('fr'))
        return { summary: 'Résumé', conclusion: 'Conclusion' };
    if (lang.startsWith('de'))
        return { summary: 'Zusammenfassung', conclusion: 'Fazit' };
    if (lang.startsWith('es'))
        return { summary: 'Resumen', conclusion: 'Conclusion' };
    if (lang.startsWith('it'))
        return { summary: 'Sintesi', conclusion: 'Conclusione' };
    if (lang.startsWith('pt'))
        return { summary: 'Resumo', conclusion: 'Conclusão' };
    if (lang.startsWith('zh')) {
        if (lang.includes('tw') || lang.includes('hk') || lang.includes('mo'))
            return { summary: '摘要', conclusion: '結論' };
        return { summary: '摘要', conclusion: '结论' };
    }
    if (lang.startsWith('ko'))
        return { summary: '요약', conclusion: '결론' };
    return { summary: 'Summary', conclusion: 'Conclusion' };
}
// Extra style guidance for bullet text that is language-dependent (e.g. Japanese sentence-final
// punctuation conventions). Kept separate from formatHintFor's structural instructions.
function bulletStyleNoteFor(language) {
    const lang = normalizeLang(language);
    if (lang.startsWith('ja')) {
        return '\nWhen a bullet point is written in Japanese, do not end it with a trailing "。".';
    }
    return '';
}
function formatHintFor(mode, language) {
    const bulletNote = bulletStyleNoteFor(language);
    const bulletCount = BULLET_MODE_COUNTS[mode];
    if (bulletCount !== undefined) {
        return `Return exactly ${bulletCount} bullet points, each starting with "- ", with exactly one blank line between each pair of bullets.${bulletNote}`;
    }
    const labels = headerLabelsFor(language);
    return ('Return EXACTLY this structure, with no other text (27 lines total):\n' +
        `${labels.summary}: <one line>\n` +
        '<blank line>\n' +
        '12 bullet lines, each starting with "- ", with exactly one blank line between each pair of bullets\n' +
        '<blank line>\n' +
        `${labels.conclusion}: <one line>\n` +
        'No headings, no extra text.' +
        bulletNote);
}
export function buildTokenCountPrompt(args) {
    // Keep minimal for speed and to reduce unrelated prompt tokens.
    return [`Title: ${args.title}`, `URL: ${args.url}`, '', 'Article:', args.articleText].join('\n');
}
export function buildSinglePrompt(args) {
    return [
        `Summarize the following web article for quick understanding.`,
        `Output language: ${args.language}.`,
        formatHintFor(args.mode, args.language),
        `Keep each bullet readable (no overly long lines).`,
        `Do not include extra commentary.`,
        '',
        `Title: ${args.title}`,
        `URL: ${args.url}`,
        '',
        `Article:`,
        args.articleText
    ].join('\n');
}
export function buildMapSystem(args) {
    return (`You are an assistant that extracts key points from article chunks.\n` +
        `Output language: ${args.language}.\n` +
        `Return 5 concise bullet points, each starting with "- ".\n` +
        `Focus on facts, claims, and important context. Avoid repetition.\n` +
        `Do not add disclaimers or meta commentary.`);
}
export function buildMapPrompt(args) {
    return [
        `Title: ${args.title}`,
        `URL: ${args.url}`,
        `Chunk: ${args.chunkIndex}/${args.chunkCount}`,
        '',
        `Chunk text:`,
        args.chunkText
    ].join('\n');
}
function buildReducePrefixBlocks(args) {
    const prefix = [
        `You are an assistant that composes a final summary from multiple chunk summaries.`,
        `Output language: ${args.language}.`,
        formatHintFor(args.mode, args.language),
        `Keep each bullet readable (no overly long lines).`,
        `Do not invent details not present in the chunk summaries.`,
        '',
        `Title: ${args.title}`,
        `URL: ${args.url}`,
        '',
        `Chunk summaries:`
    ].join('\n');
    const joined = args.chunkSummaries.map((s, i) => `Chunk ${i + 1}:\n${s}`).join('\n\n');
    const summariesBlock = { type: 'text', text: `\n${joined}` };
    if (args.cacheControl)
        summariesBlock.cache_control = args.cacheControl;
    return [{ type: 'text', text: prefix }, summariesBlock];
}
export function buildReducePrompt(args) {
    const suffix = ['', `Now write the final output.`, `Only return the summary itself (no preamble).`].join('\n');
    return [...buildReducePrefixBlocks(args), { type: 'text', text: `\n${suffix}` }];
}
export function buildRepairPrompt(args) {
    const formatHint = formatHintFor(args.mode, args.language);
    const truncationHint = args.fixTruncation
        ? `If the output looks cut off, complete the last bullet without adding new facts. Keep the bullet count unchanged.`
        : '';
    // If we have chunk summaries, include them as a cached prefix to speed up the repair pass.
    if (args.title && args.url && args.chunkSummaries && args.chunkSummaries.length > 0) {
        const prefixBlocks = buildReducePrefixBlocks({
            title: args.title,
            url: args.url,
            language: args.language,
            mode: args.mode,
            chunkSummaries: args.chunkSummaries,
            cacheControl: args.cacheControl
        });
        const suffix = [
            '',
            `Original output:`,
            args.badOutput,
            '',
            `Reformat the output to match the required format.`,
            formatHint,
            truncationHint,
            `Only return the corrected summary.`
        ].join('\n');
        return [...prefixBlocks, { type: 'text', text: `\n${suffix}` }];
    }
    return [
        `Reformat the summary to match the required format.`,
        `Output language: ${args.language}.`,
        formatHint,
        truncationHint,
        `Only return the corrected summary.`,
        '',
        `Original output:`,
        args.badOutput
    ].join('\n');
}
