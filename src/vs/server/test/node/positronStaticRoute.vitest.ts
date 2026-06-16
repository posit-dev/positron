/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { shouldUseSessionLessStaticRoute } from '../../node/positronStaticRoute.js';

describe('shouldUseSessionLessStaticRoute', () => {
	it('returns false for a daily build so it uses session-scoped URLs', () => {
		expect(shouldUseSessionLessStaticRoute(true, true, 'dailies')).toBe(false);
	});

	it('only carves out daily builds: other qualities keep the shared static route', () => {
		expect(shouldUseSessionLessStaticRoute(true, true, 'releases')).toBe(true);
		expect(shouldUseSessionLessStaticRoute(true, true, undefined)).toBe(true);
	});

	it('returns false when not running under Workbench, regardless of quality', () => {
		expect(shouldUseSessionLessStaticRoute(false, true, 'releases')).toBe(false);
	});

	it('returns false when the host lacks the static route, regardless of quality', () => {
		expect(shouldUseSessionLessStaticRoute(true, false, 'releases')).toBe(false);
	});
});
