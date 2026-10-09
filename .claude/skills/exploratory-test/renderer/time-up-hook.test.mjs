/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTimeLimit, timeUpOutput } from './time-up-hook.mjs';

const HOOK = fileURLToPath(new URL('./time-up-hook.mjs', import.meta.url));

function scratch(limit) {
	const dir = mkdtempSync(join(tmpdir(), 'hook-test-'));
	if (limit !== undefined) {
		writeFileSync(join(dir, 'time-limit'), limit);
	}
	writeFileSync(join(dir, 'msg.md'), 'Time is up.\n');
	return { dir, limitPath: join(dir, 'time-limit'), messagePath: join(dir, 'msg.md'), done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('readTimeLimit reads whole minutes, and none from a blank, bad or missing file', () => {
	const s = scratch('15\n');
	try {
		assert.equal(readTimeLimit(s.limitPath), 15);
		writeFileSync(s.limitPath, '0');
		assert.equal(readTimeLimit(s.limitPath), 0);
		for (const text of ['', 'none', '-3']) {
			writeFileSync(s.limitPath, text);
			assert.equal(readTimeLimit(s.limitPath), null, text);
		}
		assert.equal(readTimeLimit(join(s.dir, 'missing')), null);
	} finally {
		s.done();
	}
});

test('the hook adds nothing before the limit and the message from then on', () => {
	const s = scratch('10');
	try {
		const at = now => timeUpOutput({ hook_event_name: 'PostToolUse' }, { ...s, startedMs: 0, minuteMs: 1, now });
		assert.equal(at(9), '');
		assert.deepEqual(JSON.parse(at(10)), { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'Time is up.' } });
	} finally {
		s.done();
	}
});

test('the hook script prints the message once the limit has passed', () => {
	const s = scratch('0');
	try {
		const out = execFileSync(process.execPath, [HOOK, s.limitPath, String(Date.now()), s.messagePath], { input: JSON.stringify({ hook_event_name: 'PostToolUseFailure' }), encoding: 'utf8' });
		assert.equal(JSON.parse(out).hookSpecificOutput.hookEventName, 'PostToolUseFailure');
		writeFileSync(s.limitPath, '');
		assert.equal(execFileSync(process.execPath, [HOOK, s.limitPath, '0', s.messagePath], { input: '{}', encoding: 'utf8' }), '');
	} finally {
		s.done();
	}
});
