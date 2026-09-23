/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Kept in its own module, free of runtime imports, so the Vitest unit lane can
// import it without pulling in test/e2e-only dependencies (which are not
// installed on a CI cache hit).
import type { TraceSnapshots } from '../../infra/code.js';

/**
 * Resolve the `snapshots` option passed to `tracing.start()`.
 *
 * DOM snapshots are always on when tracing snapshots are enabled; aria and
 * screen snapshots are opt-in via `PW_TRACE_SNAPSHOTS` (a comma-separated list
 * of `aria` and/or `screen`). Both grow the trace and slow the run -- aria
 * roughly doubles action duration, screen is several times worse -- so CI never
 * pays for them and a debugging session asks for them explicitly.
 */
export function resolveTraceSnapshots(snapshots: boolean, env: NodeJS.ProcessEnv = process.env): TraceSnapshots {
	if (!snapshots) {
		return false;
	}

	const requested = (env.PW_TRACE_SNAPSHOTS ?? '')
		.split(',')
		.map(token => token.trim().toLowerCase())
		.filter(token => token.length > 0);

	const unknown = requested.filter(token => token !== 'aria' && token !== 'screen');
	if (unknown.length > 0) {
		throw new Error(`PW_TRACE_SNAPSHOTS: unrecognized value(s) ${unknown.join(', ')}. Expected a comma-separated list of: aria, screen.`);
	}

	if (requested.length === 0) {
		return true;
	}

	return { dom: true, aria: requested.includes('aria'), screen: requested.includes('screen') };
}
