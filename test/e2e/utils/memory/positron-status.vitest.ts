/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, test } from 'vitest';
import { parseStatusOutput } from './positron-status.js';

const SAMPLE = [
	'Version:          Positron 2026.08.0+304',
	'Memory (System):  36.00GB (0.10GB free)',
	'',
	'CPU %	Mem MB	   PID	Process',
	'    2	42749012088	  6650	positron',
	'    0	14249670696	  6653	   gpu-process',
	'    0	14249670696	  6654	   utility-network-service',
	'    0	28499341392	  6655	window [1] (Welcome)',
	'    0	14249670696	  6952	shared-process',
	'    0	14249670696	  8367	extension-host [1]',
	'    0	     0	  8404	     /opt/positron/extensions/positron-python/python-env-tools/pet server',
].join('\n');

describe('parseStatusOutput', () => {
	test('maps pids to names and skips the preamble', () => {
		const names = parseStatusOutput(SAMPLE);
		expect(names.get(6650)).toBe('positron');
		expect(names.get(6655)).toBe('window [1] (Welcome)');
		expect(names.get(6952)).toBe('shared-process');
		expect(names.get(8367)).toBe('extension-host [1]');
	});

	test('strips the indentation Positron adds to unnamed children', () => {
		expect(parseStatusOutput(SAMPLE).get(6653)).toBe('gpu-process');
	});

	test('keeps every pid in the table', () => {
		expect(parseStatusOutput(SAMPLE).size).toBe(7);
	});

	test('ignores the memory column entirely', () => {
		// The values above are the real, broken output (issue #15382). Parsing
		// must not depend on them being sane.
		expect(() => parseStatusOutput(SAMPLE)).not.toThrow();
	});

	test('returns an empty map when the table header never appears', () => {
		expect(parseStatusOutput('some unrelated CLI error').size).toBe(0);
	});

	test('parses the captured real output fixture', () => {
		const fixture = readFileSync(join(__dirname, 'fixtures', 'status-linux.txt'), 'utf8');
		const names = parseStatusOutput(fixture);
		expect(names.size).toBeGreaterThan(3);
		expect([...names.values()]).toContain('gpu-process');
	});
});
