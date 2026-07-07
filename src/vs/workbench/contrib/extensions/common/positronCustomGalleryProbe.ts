/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure, DI-free decision logic for the custom-gallery reachability probe.
 * Kept separate from the electron-browser contribution so it is unit-testable
 * without DI services or a live network.
 */

/** Raw outcome of a probe attempt, before it is turned into a user-facing decision. */
export type ProbeOutcome =
	| { kind: 'invalid-url' }
	| { kind: 'http'; status: number; hasResultsArray: boolean }
	| { kind: 'error'; reason: string };

/** Whether to surface a warning, and (if so) a short sanitized reason. */
export type ProbeDecision =
	| { notify: false }
	| { notify: true; reason: string };

/**
 * Maps a raw probe outcome to a user-facing decision. The reason is always a
 * short, normalized string (never a raw transport/stack message), so
 * notifications stay clean and leak no internals.
 */
export function interpretProbeResult(outcome: ProbeOutcome): ProbeDecision {
	switch (outcome.kind) {
		case 'invalid-url':
			return { notify: true, reason: 'not a valid URL' };
		case 'http':
			if (outcome.status >= 200 && outcome.status < 300) {
				return outcome.hasResultsArray
					? { notify: false }
					: { notify: true, reason: 'the server did not return a gallery response' };
			}
			return { notify: true, reason: `HTTP ${outcome.status}` };
		case 'error':
			return { notify: true, reason: outcome.reason };
	}
}

/**
 * Tracks the last value that produced a warning so the probe warns at most once
 * per distinct value -- no notification spam while the user edits the setting.
 */
export class WarnOnceCache {
	private lastWarnedValue: string | undefined;

	/** Returns true if a warning should be shown for this value now. */
	shouldWarn(value: string): boolean {
		if (this.lastWarnedValue === value) {
			return false;
		}
		this.lastWarnedValue = value;
		return true;
	}

	/** Forget the last-warned value (e.g. after a success), so it can warn again later. */
	clear(): void {
		this.lastWarnedValue = undefined;
	}
}

/**
 * Returns a credential-free display form of a URL, for use in user-facing
 * messages. A custom gallery URL can be rejected for carrying credentials, a
 * query, or a fragment -- any of which may hold secrets/tokens -- so all of
 * those are stripped before display. Input that does not parse as a URL cannot
 * contain URL credentials and is returned trimmed as-is.
 */
export function redactUrlForDisplay(raw: string): string {
	try {
		const url = new URL(raw.trim());
		url.username = '';
		url.password = '';
		url.search = '';
		url.hash = '';
		return url.href.replace(/\/+$/, '');
	} catch {
		return raw.trim();
	}
}

/** Shape of a gallery extensionquery request body. */
export interface ProbeQueryBody {
	readonly filters: { criteria: unknown[]; pageNumber: number; pageSize: number; sortBy: number; sortOrder: number }[];
	readonly flags: number;
}

/** Minimal extension-query body: ask for a single result to confirm the gallery responds. */
export function buildProbeQueryBody(): ProbeQueryBody {
	return {
		filters: [{ criteria: [], pageNumber: 1, pageSize: 1, sortBy: 0, sortOrder: 0 }],
		flags: 0,
	};
}
