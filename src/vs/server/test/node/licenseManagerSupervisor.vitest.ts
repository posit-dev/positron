/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { afterEach, describe, expect, it } from 'vitest';
import { LicenseManagerMessage } from '../../node/licenseManagerStream.js';
import { LicenseManagerSupervisor } from '../../node/licenseManagerSupervisor.js';
import { LICENSE_MANAGER_STUB_SOURCE } from './licenseManagerStub.js';

describe('LicenseManagerSupervisor', () => {
	let supervisor: LicenseManagerSupervisor | undefined;

	afterEach(async () => {
		await supervisor?.stop();
		supervisor = undefined;
	});

	/** Builds a supervisor that runs the stub in the given mode. */
	function createSupervisor(
		mode: string,
		handlers: {
			onMessage?: (m: LicenseManagerMessage) => void;
			onChildDown?: (code: number | null) => void;
			restartDelayMs?: number;
		} = {}
	): LicenseManagerSupervisor {
		return new LicenseManagerSupervisor({
			binaryPath: process.execPath,
			args: ['-e', LICENSE_MANAGER_STUB_SOURCE],
			env: { ...process.env, LM_STUB_MODE: mode },
			onMessage: handlers.onMessage ?? (() => { }),
			onChildDown: handlers.onChildDown ?? (() => { }),
			restartDelayMs: handlers.restartDelayMs ?? 50,
		});
	}

	/** Polls until `predicate` holds or the timeout elapses. */
	async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			if (predicate()) {
				return;
			}
			await new Promise(resolve => setTimeout(resolve, 10));
		}
		throw new Error('timed out waiting for condition');
	}

	/** Resolves after `ms`, for asserting that something did *not* happen. */
	function delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	it('surfaces messages parsed from the child stdout', async () => {
		const messages: LicenseManagerMessage[] = [];
		supervisor = createSupervisor('activated', { onMessage: m => messages.push(m) });

		supervisor.start();
		await waitFor(() => messages.length > 0);

		expect(messages[0].status).toBe('activated');
		expect(messages[0].users).toBe(5);
	});

	it('reports expired frames as-is without interpreting them', async () => {
		const messages: LicenseManagerMessage[] = [];
		supervisor = createSupervisor('expired', { onMessage: m => messages.push(m) });

		supervisor.start();
		await waitFor(() => messages.length > 0);

		expect(messages[0].status).toBe('expired');
	});

	it('fires onChildDown with the exit code when the child exits by itself', async () => {
		const exits: (number | null)[] = [];
		supervisor = createSupervisor('exit', { onChildDown: code => exits.push(code) });

		supervisor.start();
		await waitFor(() => exits.length > 0);

		expect(exits[0]).toBe(3);
	});

	it('respawns after the restart delay when the child exits', async () => {
		const messages: LicenseManagerMessage[] = [];
		supervisor = createSupervisor('exit', {
			onMessage: m => messages.push(m),
			restartDelayMs: 50,
		});

		supervisor.start();
		// The stub emits one frame per run, so a second frame can only come
		// from a second process.
		await waitFor(() => messages.length >= 2);

		expect(messages.length).toBeGreaterThanOrEqual(2);
	});

	it('does not respawn after stop()', async () => {
		const exits: (number | null)[] = [];
		const messages: LicenseManagerMessage[] = [];
		supervisor = createSupervisor('activated', {
			onMessage: m => messages.push(m),
			onChildDown: code => exits.push(code),
			restartDelayMs: 50,
		});

		supervisor.start();
		await waitFor(() => messages.length > 0);
		await supervisor.stop();

		const messagesAtStop = messages.length;
		// Well past the restart delay: a respawn would produce another frame.
		await delay(300);

		expect(messages.length).toBe(messagesAtStop);
		expect(exits.length).toBe(1);
	});

	it('stops the child with SIGTERM so it can check the license in', async () => {
		const exits: (number | null)[] = [];
		const messages: LicenseManagerMessage[] = [];
		supervisor = createSupervisor('activated', {
			onMessage: m => messages.push(m),
			onChildDown: code => exits.push(code),
		});

		supervisor.start();
		await waitFor(() => messages.length > 0);
		await supervisor.stop();

		// The stub exits 42 from its SIGTERM handler. Anything else (notably a
		// null code from SIGKILL) means it was not given the chance to check in.
		expect(exits[0]).toBe(42);
	});

	it('escalates to SIGKILL when the child ignores SIGTERM', async () => {
		const messages: LicenseManagerMessage[] = [];
		supervisor = createSupervisor('ignore-sigterm', {
			onMessage: m => messages.push(m),
		});

		supervisor.start();
		await waitFor(() => messages.length > 0);

		await supervisor.stop(100);

		// stop() must resolve rather than hang forever on an unresponsive child.
		expect(messages.length).toBeGreaterThan(0);
	});

	it('does not treat stderr output as messages', async () => {
		const messages: LicenseManagerMessage[] = [];
		const exits: (number | null)[] = [];
		supervisor = createSupervisor('stderr', {
			onMessage: m => messages.push(m),
			onChildDown: code => exits.push(code),
		});

		supervisor.start();
		// Give the stub time to write to stderr and for it to be read.
		await delay(300);

		expect(messages).toEqual([]);
		expect(exits).toEqual([]);
	});

	it('reports the child as down when the binary cannot be spawned', async () => {
		const exits: (number | null)[] = [];
		supervisor = new LicenseManagerSupervisor({
			binaryPath: '/nonexistent/license-manager-aws-sagemaker',
			onMessage: () => { },
			onChildDown: code => exits.push(code),
			restartDelayMs: 10_000,
		});

		supervisor.start();
		// A missing binary raises 'error' and never 'exit', so this only works
		// if the supervisor treats a failed spawn as the child being down.
		await waitFor(() => exits.length > 0);

		expect(exits[0]).toBeNull();
	});

	it('stops without hanging when the binary cannot be spawned', async () => {
		supervisor = new LicenseManagerSupervisor({
			binaryPath: '/nonexistent/license-manager-aws-sagemaker',
			onMessage: () => { },
			onChildDown: () => { },
			restartDelayMs: 10_000,
		});

		supervisor.start();
		await delay(100);

		// Waiting on an exit that will never arrive would hang server shutdown.
		await expect(supervisor.stop(200)).resolves.toBeUndefined();
	});

	it('is safe to stop before it was ever started', async () => {
		supervisor = createSupervisor('activated');

		await expect(supervisor.stop()).resolves.toBeUndefined();
	});
});
