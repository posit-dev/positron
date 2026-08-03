/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { routeExternalOpen } from '../../common/positronCanvasMode.js';

describe('routeExternalOpen', () => {

	it('proceeds when Canvas mode is not engaged, under either policy', () => {
		expect(routeExternalOpen(false, false, 'defer')).toBe('proceed');
		expect(routeExternalOpen(false, false, 'exit-and-open')).toBe('proceed');
		expect(routeExternalOpen(false, true, 'defer')).toBe('proceed');
	});

	it('holds an unwaited open until Canvas releases under the defer policy', () => {
		expect(routeExternalOpen(true, false, 'defer')).toBe('defer');
	});

	it('leaves Canvas and proceeds under the exit-and-open policy', () => {
		expect(routeExternalOpen(true, false, 'exit-and-open')).toBe('exit-and-proceed');
	});

	it('never holds a waited open, which would block the requesting process', () => {
		expect(routeExternalOpen(true, true, 'defer')).toBe('exit-and-proceed');
		expect(routeExternalOpen(true, true, 'exit-and-open')).toBe('exit-and-proceed');
	});
});
