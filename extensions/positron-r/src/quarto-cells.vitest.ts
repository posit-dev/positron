/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import {
	claimQuartoCells,
	hasQuartoCellsOwner,
	onDidChangeQuartoCellsOwnership,
	quartoCellsNotebookPath,
	releaseQuartoCells,
} from './quarto-cells';

describe('quartoCellsNotebookPath', () => {
	// Mirrors `quartoNotebookUri` in core's quartoVirtualNotebookService.ts. A
	// path that drifts from core's names a notebook that does not exist, and the
	// session's selector then matches nothing.
	it.each([
		['/home/me/doc.qmd', '/home/me/doc.qmd.ipynb'],
		['/home/me/doc.Rmd', '/home/me/doc.Rmd.ipynb'],
		['/home/me/DOC.QMD', '/home/me/DOC.QMD.ipynb'],
		['Untitled-1', 'Untitled-1.qmd.ipynb'],
	])('%s -> %s', (source, expected) => {
		expect(quartoCellsNotebookPath(source)).toBe(expected);
	});
});

describe('Quarto cells ownership registry', () => {
	const NOTEBOOK = 'quarto-cells:/home/me/doc.qmd.ipynb';
	const OTHER = 'quarto-cells:/home/me/other.qmd.ipynb';
	const OWNER_A = 'session-a';
	const OWNER_B = 'session-b';

	afterEach(() => {
		releaseQuartoCells(NOTEBOOK, OWNER_A);
		releaseQuartoCells(NOTEBOOK, OWNER_B);
		releaseQuartoCells(OTHER, OWNER_A);
	});

	it('reports a claim for the claimed notebook only', () => {
		claimQuartoCells(NOTEBOOK, OWNER_A);

		expect([hasQuartoCellsOwner(NOTEBOOK), hasQuartoCellsOwner(OTHER)]).toEqual([true, false]);
	});

	it('forgets a released claim', () => {
		claimQuartoCells(NOTEBOOK, OWNER_A);
		releaseQuartoCells(NOTEBOOK, OWNER_A);

		expect(hasQuartoCellsOwner(NOTEBOOK)).toBe(false);
	});

	it('frees the key after one release even though the same owner claimed it twice', () => {
		// A set of owner ids, not a count: a repeat claim from the same owner
		// must not need a second release to free the key.
		claimQuartoCells(NOTEBOOK, OWNER_A);
		claimQuartoCells(NOTEBOOK, OWNER_A);
		releaseQuartoCells(NOTEBOOK, OWNER_A);

		expect(hasQuartoCellsOwner(NOTEBOOK)).toBe(false);
	});

	it('stays owned when a stale release from one owner lands while another still holds the key', () => {
		// Close a titled .qmd and reopen it quickly, or restart its session: the
		// new client reaches State.Running and claims before the old client's
		// State.Stopped release lands. The stale release must not take the new
		// claim with it.
		claimQuartoCells(NOTEBOOK, OWNER_A);
		claimQuartoCells(NOTEBOOK, OWNER_B);
		releaseQuartoCells(NOTEBOOK, OWNER_A);

		expect(hasQuartoCellsOwner(NOTEBOOK)).toBe(true);
	});

	it('reports the key unowned once the last owner releases it', () => {
		claimQuartoCells(NOTEBOOK, OWNER_A);
		claimQuartoCells(NOTEBOOK, OWNER_B);
		releaseQuartoCells(NOTEBOOK, OWNER_A);
		releaseQuartoCells(NOTEBOOK, OWNER_B);

		expect(hasQuartoCellsOwner(NOTEBOOK)).toBe(false);
	});

	it('treats a release from an owner that never claimed as a no-op, with no notification', () => {
		// Also covers a session that fails during startup: it never claimed
		// anything, so its release on the way down must not disturb another
		// owner's claim or fire a spurious event.
		claimQuartoCells(NOTEBOOK, OWNER_A);
		const events: [string, boolean][] = [];
		const subscription = onDidChangeQuartoCellsOwnership((uri, owned) => {
			events.push([uri, owned]);
		});

		releaseQuartoCells(NOTEBOOK, OWNER_B);
		releaseQuartoCells(OTHER, OWNER_A);

		subscription.dispose();
		expect(hasQuartoCellsOwner(NOTEBOOK)).toBe(true);
		expect(events).toEqual([]);
	});

	it('notifies listeners once per change, not per call', () => {
		// The console client clears its diagnostics on a claim, so an event has
		// to mean the key's owned state really changed: not a repeat claim, not
		// a release of something never claimed, and not an owner arriving or
		// leaving while another still holds the key.
		const events: [string, boolean][] = [];
		const subscription = onDidChangeQuartoCellsOwnership((uri, owned) => {
			events.push([uri, owned]);
		});

		claimQuartoCells(NOTEBOOK, OWNER_A);
		claimQuartoCells(NOTEBOOK, OWNER_A);
		claimQuartoCells(NOTEBOOK, OWNER_B);
		releaseQuartoCells(NOTEBOOK, OWNER_A);
		releaseQuartoCells(NOTEBOOK, OWNER_B);
		releaseQuartoCells(NOTEBOOK, OWNER_B);
		subscription.dispose();
		claimQuartoCells(NOTEBOOK, OWNER_A);

		expect(events).toEqual([
			[NOTEBOOK, true],
			[NOTEBOOK, false],
		]);
	});
});
