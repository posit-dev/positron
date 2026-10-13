/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { describe, it, expect } from 'vitest';
import { getPortableEnvOverride, normalizePortableEnv } from './bootstrap-portable-env.js';

describe('getPortableEnvOverride', () => {
	it('prefers POSITRON_PORTABLE over VSCODE_PORTABLE', () => {
		expect(getPortableEnvOverride({ POSITRON_PORTABLE: '/positron', VSCODE_PORTABLE: '/vscode' })).toBe('/positron');
	});

	it('falls back to VSCODE_PORTABLE when POSITRON_PORTABLE is unset or empty', () => {
		expect(getPortableEnvOverride({ VSCODE_PORTABLE: '/vscode' })).toBe('/vscode');
		expect(getPortableEnvOverride({ POSITRON_PORTABLE: '', VSCODE_PORTABLE: '/vscode' })).toBe('/vscode');
	});

	it('returns undefined when neither is set', () => {
		expect(getPortableEnvOverride({})).toBeUndefined();
	});
});

describe('normalizePortableEnv', () => {
	it('sets POSITRON_PORTABLE and removes VSCODE_PORTABLE when portable', () => {
		const env: Record<string, string | undefined> = { VSCODE_PORTABLE: '/data' };

		normalizePortableEnv(env, '/data', true);

		expect(env).toEqual({ POSITRON_PORTABLE: '/data' });
	});

	it('removes both variables when not portable, so a stale VSCODE_PORTABLE cannot survive', () => {
		const env: Record<string, string | undefined> = { VSCODE_PORTABLE: '/missing', POSITRON_PORTABLE: '/also-missing', OTHER: 'kept' };

		normalizePortableEnv(env, '/missing', false);

		expect(env).toEqual({ OTHER: 'kept' });
	});
});
