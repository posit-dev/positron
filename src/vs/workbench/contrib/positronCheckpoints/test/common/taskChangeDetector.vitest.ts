/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { DEFAULT_DETECTOR, TaskChangeDetector } from '../../common/taskChangeDetector.js';

const MINUTE = 60_000;

/** A detector that already knows of a small set of changes, at time 0. */
function detectorWithChanges(): TaskChangeDetector {
	const detector = new TaskChangeDetector();
	expect(detector.handle({ type: 'changes', lines: 10, files: 2, time: 0 })).toBe('none');
	return detector;
}

describe('TaskChangeDetector', () => {
	test('uses the numbers of the spec', () => {
		expect(DEFAULT_DETECTOR).toEqual({ pauseMs: 20 * MINUTE, maxLines: 300, maxFiles: 8, minGapMs: 10 * MINUTE });
	});

	test('edit inside the set then outside it gives signal', () => {
		const detector = detectorWithChanges();

		expect(detector.handle({ type: 'edit', path: 'plot_dose.R', inChangedSet: true, time: 1000 })).toBe('none');
		expect(detector.handle({ type: 'edit', path: 'import_march.R', inChangedSet: false, time: 2000 })).toBe('signal');
	});

	test('edit outside the set with no earlier inside edit gives none', () => {
		const detector = detectorWithChanges();

		expect(detector.handle({ type: 'edit', path: 'import_march.R', inChangedSet: false, time: 1000 })).toBe('none');
		expect(detector.handle({ type: 'edit', path: 'readme.md', inChangedSet: false, time: 2000 })).toBe('none');
	});

	test('a checkpoint resets the edit inside the set', () => {
		const detector = detectorWithChanges();
		detector.handle({ type: 'edit', path: 'plot_dose.R', inChangedSet: true, time: 1000 });

		expect(detector.handle({ type: 'checkpoint-created', time: 1500 })).toBe('none');

		expect(detector.handle({ type: 'edit', path: 'import_march.R', inChangedSet: false, time: 2000 })).toBe('none');
	});

	test('edit after a 20 minute pause gives signal', () => {
		const detector = detectorWithChanges();
		detector.handle({ type: 'edit', path: 'import_march.R', inChangedSet: false, time: 0 });

		expect(detector.handle({ type: 'edit', path: 'import_march.R', inChangedSet: false, time: 20 * MINUTE - 1 })).toBe('none');
		expect(detector.handle({ type: 'edit', path: 'import_march.R', inChangedSet: false, time: 40 * MINUTE - 1 })).toBe('signal');
	});

	test('more than 300 lines or more than 8 files gives signal', () => {
		expect(new TaskChangeDetector().handle({ type: 'changes', lines: 300, files: 8, time: 0 })).toBe('none');
		expect(new TaskChangeDetector().handle({ type: 'changes', lines: 301, files: 1, time: 0 })).toBe('signal');
		expect(new TaskChangeDetector().handle({ type: 'changes', lines: 5, files: 9, time: 0 })).toBe('signal');
	});

	test('no second signal within 10 minutes', () => {
		const detector = new TaskChangeDetector();
		expect(detector.handle({ type: 'changes', lines: 400, files: 2, time: 0 })).toBe('signal');

		expect(detector.handle({ type: 'changes', lines: 410, files: 2, time: 10 * MINUTE - 1 })).toBe('none');
		expect(detector.handle({ type: 'changes', lines: 420, files: 2, time: 10 * MINUTE })).toBe('signal');
	});

	test('a dismissal doubles the gap', () => {
		const detector = new TaskChangeDetector();
		expect(detector.handle({ type: 'changes', lines: 400, files: 2, time: 0 })).toBe('signal');
		expect(detector.handle({ type: 'dismissed', time: 1000 })).toBe('none');

		expect(detector.handle({ type: 'changes', lines: 400, files: 2, time: 20 * MINUTE - 1 })).toBe('none');
		expect(detector.handle({ type: 'changes', lines: 400, files: 2, time: 20 * MINUTE })).toBe('signal');

		detector.handle({ type: 'dismissed', time: 20 * MINUTE + 1 });
		expect(detector.handle({ type: 'changes', lines: 400, files: 2, time: 60 * MINUTE - 1 })).toBe('none');
		expect(detector.handle({ type: 'changes', lines: 400, files: 2, time: 60 * MINUTE })).toBe('signal');
	});

	test('no signal when there are no changes', () => {
		const detector = new TaskChangeDetector();
		// Before any changes are known, and after they are reported empty.
		detector.handle({ type: 'edit', path: 'plot_dose.R', inChangedSet: true, time: 0 });
		expect(detector.handle({ type: 'edit', path: 'import_march.R', inChangedSet: false, time: 1000 })).toBe('none');

		detector.handle({ type: 'changes', lines: 0, files: 0, time: 2000 });
		expect(detector.handle({ type: 'edit', path: 'import_march.R', inChangedSet: false, time: 30 * MINUTE })).toBe('none');
	});
});
