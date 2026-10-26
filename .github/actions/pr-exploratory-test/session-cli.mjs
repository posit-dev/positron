/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// runSession from the command line, for callers outside this action (drive-positron's heal/):
//
//   node session-cli.mjs --prompt-file F --system-file F --tools Bash,Read --model opus \
//     --max-turns 120 [--time-limit 45] [--effort high] [--write-root DIR] --cwd DIR --label finder --out FILE

import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { parsePosIntEnv, parseTimeLimit } from './lib.mjs';
import { runSession } from './session.mjs';

const { values: a } = parseArgs({
	options: {
		'prompt-file': { type: 'string' }, 'system-file': { type: 'string' }, tools: { type: 'string' },
		model: { type: 'string', default: 'opus' }, 'max-turns': { type: 'string', default: '120' },
		'time-limit': { type: 'string', default: '' }, effort: { type: 'string', default: '' },
		cwd: { type: 'string' }, 'write-root': { type: 'string' }, label: { type: 'string', default: 'session' }, out: { type: 'string' },
	},
});
for (const k of ['prompt-file', 'tools', 'cwd', 'out']) {
	if (!a[k]) { console.error(`session-cli: --${k} is required`); process.exit(2); }
}
if (!process.env.ANTHROPIC_API_KEY) { console.error('session-cli: ANTHROPIC_API_KEY is not set'); process.exit(2); }

try {
	const s = await runSession({
		prompt: readFileSync(a['prompt-file'], 'utf8'),
		systemPrompt: a['system-file'] ? readFileSync(a['system-file'], 'utf8') : undefined,
		allowedTools: a.tools.split(','),
		model: a.model,
		maxTurns: parsePosIntEnv('--max-turns', 120, a['max-turns']),
		timeLimit: parseTimeLimit(a['time-limit']),
		effort: a.effort,
		cwd: a.cwd,
		writeRoot: a['write-root'],
		claudeCodePath: process.env.CLAUDE_CODE_PATH || undefined,
		label: a.label,
	});
	writeFileSync(a.out, `${JSON.stringify({ finalText: s.finalText, cost: s.cost, timedOut: s.timedOut, timeWasUp: s.timeWasUp }, null, 2)}\n`);
} catch (err) {
	console.error(`session-cli: ${err?.stack ?? err}`);
	process.exit(1);
}
