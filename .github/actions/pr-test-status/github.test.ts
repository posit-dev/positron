/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { statusState } from './github.ts';
import type { LaneOutput } from './render.ts';

test('statusState maps lane outputs to the four status states', () => {
	const out = (status: LaneOutput['status'], conclusion?: LaneOutput['conclusion']): LaneOutput => ({ status, conclusion, title: 't', summary: 's' });
	assert.deepStrictEqual([
		out('in_progress'), out('completed', 'success'), out('completed', 'failure'),
		out('completed', 'cancelled'), out('completed', 'timed_out'), out('completed', 'neutral'),
	].map(statusState), ['pending', 'success', 'failure', 'error', 'error', 'error']);
});
