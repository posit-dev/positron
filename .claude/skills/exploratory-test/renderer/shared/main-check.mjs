/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// A finding's Origin, from its replay on a build of main: inherited when users
// on main can hit it, introduced when they cannot, and no label, with the
// reason, when the replay does not settle it. Nothing guessed from the diff
// fills the label.

/**
 * Whether `mainTries` on main are enough to say a finding does not happen
 * there: as many as the PR build took, and twice as many when the PR build
 * saw it in under half its tries.
 */
export function enoughTries(pr, mainTries) {
	if (!(pr?.m >= 1)) {
		return false;
	}
	const needed = pr.n / pr.m < 0.5 ? 2 * pr.m : pr.m;
	return mainTries >= needed;
}

const none = (reason, detail = '') => ({ origin: '', reason, detail });
const label = origin => ({ origin, reason: '', detail: '' });

/**
 * A finding's Origin from its `main` field: `{ origin, reason, detail }`, with
 * `origin` '' and a `reason` when the replay does not settle it. `drift` says
 * whether the files of the fix differ between the main build and the base:
 * 'none', 'drift', or 'unchecked' when there were no files to compare. An
 * unchecked drift leaves Inherited standing, since main showed the bug, but
 * not Introduced, since main may have fixed it after the base.
 */
export function originFromMain({ main, reproduced, drift, hasMainBuild }) {
	if (!hasMainBuild) {
		return none('no main build');
	}
	if (!main) {
		return none('not replayed');
	}
	// The ID is new in the change, so what main did since does not matter.
	if (main.missing?.length) {
		return label('introduced');
	}
	if (main.couldNotRun || !main.steps?.length) {
		return none('could not run', main.couldNotRun ?? '');
	}
	if (drift === true || drift === 'drift') {
		return none('drift');
	}
	if (main.steps.some(s => s.n > 0)) {
		return label('inherited');
	}
	const tries = Math.min(...main.steps.map(s => s.m));
	if (!enoughTries(reproduced, tries)) {
		return none('too few tries', `not seen in ${tries} tries on main`);
	}
	return drift === 'unchecked' ? none('drift unchecked') : label('introduced');
}

/** The main counts as the page shows them: `step 5 0/2, step 9 2/2`. */
export function formatCounts(main) {
	return [...(main?.steps ?? [])].sort((a, b) => a.step - b.step).map(s => `step ${s.step} ${s.n}/${s.m}`).join(', ');
}

/**
 * Milliseconds the explorer spent on main replays: each run of consecutive
 * action log lines from a `-main` session, first line to last.
 */
export function mainReplayMs(actionsLog) {
	let total = 0;
	let first = null;
	let last = null;
	const close = () => {
		if (first !== null) {
			total += last - first;
		}
		first = last = null;
	};
	for (const line of String(actionsLog ?? '').split('\n')) {
		const m = /^(\S+) \S+ -s=(\S+?):/.exec(line);
		if (!m) {
			continue;
		}
		if (!m[2].endsWith('-main')) {
			close();
			continue;
		}
		const at = Date.parse(m[1]);
		first ??= at;
		last = at;
	}
	close();
	return total;
}
