/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from 'vitest';
import { resolveTraceSnapshots } from './reporting.fixtures.js';

describe('resolveTraceSnapshots', () => {
	test('stays off when tracing snapshots are disabled, whatever is requested', () => {
		expect(resolveTraceSnapshots(false, {})).toBe(false);
		expect(resolveTraceSnapshots(false, { PW_TRACE_SNAPSHOTS: 'aria' })).toBe(false);
	});

	test('is DOM-only by default, so CI pays nothing for aria or screen', () => {
		expect(resolveTraceSnapshots(true, {})).toBe(true);
		expect(resolveTraceSnapshots(true, { PW_TRACE_SNAPSHOTS: '' })).toBe(true);
		expect(resolveTraceSnapshots(true, { PW_TRACE_SNAPSHOTS: ' , ' })).toBe(true);
	});

	test('adds the requested snapshot kinds and keeps DOM on', () => {
		expect(resolveTraceSnapshots(true, { PW_TRACE_SNAPSHOTS: 'aria' }))
			.toEqual({ dom: true, aria: true, screen: false });
		expect(resolveTraceSnapshots(true, { PW_TRACE_SNAPSHOTS: 'screen' }))
			.toEqual({ dom: true, aria: false, screen: true });
		expect(resolveTraceSnapshots(true, { PW_TRACE_SNAPSHOTS: 'aria,screen' }))
			.toEqual({ dom: true, aria: true, screen: true });
	});

	test('tolerates whitespace and casing', () => {
		expect(resolveTraceSnapshots(true, { PW_TRACE_SNAPSHOTS: ' ARIA , Screen ' }))
			.toEqual({ dom: true, aria: true, screen: true });
	});

	test('throws on an unrecognized kind rather than silently recording nothing extra', () => {
		expect(() => resolveTraceSnapshots(true, { PW_TRACE_SNAPSHOTS: 'dom' }))
			.toThrow(/unrecognized value\(s\) dom/);
		expect(() => resolveTraceSnapshots(true, { PW_TRACE_SNAPSHOTS: 'aria,sceen' }))
			.toThrow(/unrecognized value\(s\) sceen/);
	});
});
