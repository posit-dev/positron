/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { SessionLessStaticRouteInputs, shouldUseSessionLessStaticRoute } from '../../node/positronStaticRoute.js';

const base: SessionLessStaticRouteInputs = {
	isWorkbench: true,
	hasStaticRoute: true,
	quality: 'dailies',
	sessionCommit: 'abc123',
	workbenchSendsPreviewCommit: true,
	workbenchStaticCommit: undefined
};
const decide = (overrides: Partial<SessionLessStaticRouteInputs>) => shouldUseSessionLessStaticRoute({ ...base, ...overrides });

describe('shouldUseSessionLessStaticRoute', () => {
	describe('Workbench older than 2026.11', () => {
		it('keeps session-scoped URLs for daily builds', () => {
			expect(decide({ workbenchSendsPreviewCommit: false })).toBe(false);
		});

		it('keeps the shared static route for other qualities', () => {
			expect(decide({ workbenchSendsPreviewCommit: false, quality: 'releases' })).toBe(true);
			expect(decide({ workbenchSendsPreviewCommit: false, quality: undefined })).toBe(true);
		});

		it('ignores a stray static commit', () => {
			expect(decide({ workbenchSendsPreviewCommit: false, workbenchStaticCommit: 'abc123' })).toBe(false);
		});
	});

	describe('Workbench 2026.11+, non-preview session (no static commit)', () => {
		it('uses the shared static route for daily and release builds alike', () => {
			expect(decide({})).toBe(true);
			expect(decide({ quality: 'releases' })).toBe(true);
		});
	});

	describe('Workbench 2026.11+, preview session (static commit present)', () => {
		it('uses the shared static route when the commits match', () => {
			expect(decide({ workbenchStaticCommit: 'abc123' })).toBe(true);
		});

		it('uses session-scoped URLs when the commits differ or are unknown', () => {
			expect(decide({ workbenchStaticCommit: 'def456' })).toBe(false);
			expect(decide({ workbenchStaticCommit: 'unknown' })).toBe(false);
			expect(decide({ workbenchStaticCommit: 'def456', sessionCommit: undefined })).toBe(false);
		});
	});

	it('returns false when not running under Workbench, regardless of the rest', () => {
		expect(decide({ isWorkbench: false, quality: 'releases' })).toBe(false);
	});

	it('returns false when the host lacks the static route, regardless of the rest', () => {
		expect(decide({ hasStaticRoute: false, quality: 'releases' })).toBe(false);
	});
});
