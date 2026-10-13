// Canned Claude API replies for `node eval/run.ts --dry-run`: valid summaries in the requested
// format, so the harness can be checked without an API key or cost.

export function installFakeApi(): void {
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
    const prompt = JSON.stringify(body.messages);
    let text: string;
    if (prompt.includes('You are grading a summary')) {
      text = '{"faithful": true, "unsupported": [], "coverage": 4, "notes": "dry run"}';
    } else if (body.system) {
      text = '- A point from this chunk.';
    } else {
      const count = Number(/exactly (\d+) bullet points/.exec(prompt)?.[1] ?? 12);
      const ja = /Output language: ja/.test(prompt);
      const bullets = Array.from({ length: count }, (_, i) => (ja ? `- 要点${i + 1}です。` : `- Point ${i + 1}.`));
      text = /Conclusion|結論/.test(prompt)
        ? [
            ja ? '要約: 概要です。' : 'Summary: An overview.',
            '',
            ...bullets.flatMap((b) => [b, '']),
            ja ? '結論: まとめです。' : 'Conclusion: The end.'
          ].join('\n')
        : bullets.join('\n\n');
    }
    const json = {
      id: 'msg_dry_run',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      usage: { input_tokens: Math.ceil(prompt.length / 4), output_tokens: Math.ceil(text.length / 4) }
    };
    return new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}
