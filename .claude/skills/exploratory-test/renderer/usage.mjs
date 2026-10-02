/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Counts local runs, which otherwise stay on the tester's machine unless
// published. One row per run goes to a Google Form; EXPLORATORY_TEST_NO_USAGE=1
// opts out.

import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FORM = 'https://docs.google.com/forms/d/e/1FAIpQLSej9NcG_g9863v99I4y1b83hzZ19IUPogH9rAT31Qo8wUBvhA/formResponse';
const ENTRY = {
	email: 'entry.1986494673',
	event: 'entry.1826220406',
	runId: 'entry.1395150276',
	stats: 'entry.1080692673',
};

/** Sends one row; never throws, and gives up after `timeoutMs`. */
export async function reportUsage({ email, event, runId, stats }, { fetch = globalThis.fetch, env = process.env, timeoutMs = 3000 } = {}) {
	if (env.EXPLORATORY_TEST_NO_USAGE) {
		return false;
	}
	try {
		const res = await fetch(FORM, {
			method: 'POST',
			body: new URLSearchParams({
				[ENTRY.email]: email ?? '',
				[ENTRY.event]: event,
				[ENTRY.runId]: runId,
				[ENTRY.stats]: JSON.stringify(stats),
			}),
			signal: AbortSignal.timeout(timeoutMs),
		});
		return res.ok;
	} catch {
		// Offline, slow, or refused: a run must not fail over its usage row.
		return false;
	}
}

/** Written once a run's row is sent, so re-rendering the run sends no second row. */
export const REPORTED_FILE = 'usage-reported';

/** Sends the run's row unless an earlier render already did; a failed send is retried next render. */
export async function reportUsageOnce(runDir, row, options) {
	const marker = join(runDir, REPORTED_FILE);
	if (existsSync(marker)) {
		return false;
	}
	const sent = await reportUsage(row, options);
	if (sent) {
		writeFileSync(marker, '');
	}
	return sent;
}
