/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { afterEach, describe, expect, it } from 'vitest';
import {
	isRemoteLicenseManagerMode,
	startRemoteLicenseManager,
	stopRemoteLicenseManager,
} from '../../node/remoteLicenseKey.js';
import { LICENSE_MANAGER_STUB_SOURCE } from './licenseManagerStub.js';

/**
 * Integration-style tests for remote license manager mode: a real child process
 * stands in for the binary, and the assertions are about what the server would
 * do with it — start, refuse to start, or enforce mid-session.
 */
describe('remote license manager mode', () => {
	let stop: (() => Promise<void>) | undefined;
	const savedEnv = { ...process.env };

	afterEach(async () => {
		await stop?.();
		stop = undefined;
		process.env = { ...savedEnv };
	});

	/** Starts the license manager against the stub in the given mode. */
	function start(mode: string, overrides: {
		graceMs?: number;
		startupTimeoutMs?: number;
		onUnlicensed?: () => void;
		flipMs?: number;
	} = {}) {
		const session = startRemoteLicenseManager({
			binaryPath: process.execPath,
			args: ['-e', LICENSE_MANAGER_STUB_SOURCE],
			env: {
				...process.env,
				LM_STUB_MODE: mode,
				LM_STUB_FLIP_MS: String(overrides.flipMs ?? 100),
			},
			graceMs: overrides.graceMs ?? 100,
			startupTimeoutMs: overrides.startupTimeoutMs ?? 3000,
			restartDelayMs: 50,
			onUnlicensed: overrides.onUnlicensed,
		});
		return session;
	}

	/** Resolves after `ms`. */
	function delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	describe('isRemoteLicenseManagerMode', () => {
		it('is off when POSITRON_LICENSE_MANAGER_PATH is unset', () => {
			delete process.env.POSITRON_LICENSE_MANAGER_PATH;

			expect(isRemoteLicenseManagerMode()).toBe(false);
		});

		it('is on when POSITRON_LICENSE_MANAGER_PATH is set', () => {
			process.env.POSITRON_LICENSE_MANAGER_PATH = '/usr/lib/positron-server/bin/lm';

			expect(isRemoteLicenseManagerMode()).toBe(true);
		});

		it('takes precedence over a license key, so the key path is not used', () => {
			// The SageMaker image sets only the manager path, but a stale
			// POSITRON_LICENSE_KEY must not silently win if both are present.
			process.env.POSITRON_LICENSE_MANAGER_PATH = '/usr/lib/positron-server/bin/lm';
			process.env.POSITRON_LICENSE_KEY = '{"connection_token":"x"}';

			expect(isRemoteLicenseManagerMode()).toBe(true);
		});
	});

	it('reports a valid license once the client checks one out', async () => {
		const session = start('activated');
		stop = () => session.stop();

		const result = await session.validation;

		expect(result.valid).toBe(true);
	});

	it('refuses to start when the client can never check a license out', async () => {
		const session = start('expired', { startupTimeoutMs: 300 });
		stop = () => session.stop();

		const result = await session.validation;

		// This is what makes the server exit rather than run unlicensed.
		expect(result.valid).toBe(false);
	});

	// A binary that fails to spawn is exercised directly against
	// LicenseManagerSupervisor in licenseManagerSupervisor.vitest.ts; no need to
	// re-verify the same spawn failure through this extra layer of wiring.

	it('enforces after the grace period when the license is lost mid-session', async () => {
		let enforced = 0;
		const session = start('flip', {
			flipMs: 100,
			graceMs: 150,
			onUnlicensed: () => { enforced++; },
		});
		stop = () => session.stop();

		expect((await session.validation).valid).toBe(true);
		// Not enforced immediately: the grace period exists so a transient
		// failure does not kill a live session.
		await delay(120);
		expect(enforced).toBe(0);

		await delay(300);
		expect(enforced).toBe(1);
	});

	// The negative-control complement (staying licensed never enforces) is
	// covered at the unit level by LicenseStateMachine's "stays licensed
	// through long silences" test; no need to re-verify it through a real
	// child process here too.

	it('does not enforce because of the shutdown it performed itself', async () => {
		// stop() kills the client, which the state machine cannot tell apart
		// from a crash. If that counted as losing the license, shutting the
		// server down would trigger enforcement on the way out.
		let enforced = 0;
		const session = start('activated', {
			graceMs: 50,
			onUnlicensed: () => { enforced++; },
		});

		await session.validation;
		await session.stop();
		await delay(300);

		expect(enforced).toBe(0);
		// A stopped session must not leave a child behind that would keep the
		// seat checked out for the rest of the lease.
		expect(session.isRunning).toBe(false);
	});

	it('is safe to stop on shutdown when this mode is not in use', async () => {
		// Server shutdown calls this unconditionally, so it has to be a no-op
		// for every deployment that licenses Positron with a key instead.
		await expect(stopRemoteLicenseManager()).resolves.toBeUndefined();
	});
});
