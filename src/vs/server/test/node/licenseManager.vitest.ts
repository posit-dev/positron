/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { ILicenseManagerOptions, ILicenseManagerProcess, LicenseManager, parseLicenseManagerLine } from '../../node/licenseManager.js';
import { ensureNoLeakedDisposables } from '../../../test/vitest/vitestUtils.js';

const FAKE_HMAC_LINE = 'ZmFrZS1zaWduYXR1cmUtbm90LWEtcmVhbC1obWFj';

const ACTIVATED_FRAME =
	`${FAKE_HMAC_LINE}\n` +
	'{"status":"activated","expiration":9999999999000,"ts":1700000000000,' +
	'"product-key":"","shiny-users":"0","users":"5","user-activity-days":"0",' +
	'"allow-apis":"1","days-left":7,"has-key":false,"has-trial":false,' +
	'"license-scope":"","sessions":"0","enable-launcher":"1","max-repo-count":"0"}\n';

const EXPIRED_FRAME =
	`${FAKE_HMAC_LINE}\n` +
	'{"status":"expired","expiration":0,"ts":1700000010000,' +
	'"product-key":"","shiny-users":"0","users":"0","user-activity-days":"0",' +
	'"allow-apis":"","days-left":0,"has-key":false,"has-trial":false,' +
	'"license-scope":"","sessions":"0","enable-launcher":"0","max-repo-count":"0"}\n';

function linesOf(frame: string): string[] {
	return frame.split('\n').filter(line => line !== '');
}

describe('parseLicenseManagerLine', () => {
	it('ignores the HMAC line that precedes each JSON frame', () => {
		expect(parseLicenseManagerLine(linesOf(ACTIVATED_FRAME)[0])).toBeUndefined();
	});

	it('decodes an activated frame, coercing the string-encoded fields', () => {
		// `users` arrives as "5" because of Go's `,string` struct tag, while
		// `days-left` and `expiration` are plain JSON numbers.
		expect(parseLicenseManagerLine(linesOf(ACTIVATED_FRAME)[1])).toMatchInlineSnapshot(`
			{
			  "daysLeft": 7,
			  "expirationMs": 9999999999000,
			  "status": "activated",
			  "users": 5,
			}
		`);
	});

	it('decodes an expired frame', () => {
		expect(parseLicenseManagerLine(linesOf(EXPIRED_FRAME)[1])?.status).toBe('expired');
	});

	it('ignores a truncated JSON line rather than throwing', () => {
		expect(parseLicenseManagerLine('{"status":"activa')).toBeUndefined();
	});
});

class FakeClient extends EventEmitter implements ILicenseManagerProcess {
	readonly stdout = new PassThrough();
	readonly stderr = new PassThrough();
	readonly kill = vi.fn((_signal: NodeJS.Signals) => true);

	exit(): void {
		this.emit('exit');
	}
}

describe('LicenseManager', () => {
	const disposables = ensureNoLeakedDisposables();

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const flush = () => new Promise<void>(resolve => setImmediate(resolve));

	function createManager(overrides: Partial<ILicenseManagerOptions> = {}) {
		const clients: FakeClient[] = [];
		const onUnlicensed = vi.fn();
		const manager = disposables.add(new LicenseManager({
			binaryPath: '/fake/license-manager-aws-sagemaker',
			onUnlicensed,
			graceMs: 10_000,
			startupTimeoutMs: 60_000,
			restartDelayMs: 5_000,
			spawn: () => {
				const client = new FakeClient();
				clients.push(client);
				return client;
			},
			...overrides,
		}));
		return { manager, onUnlicensed, clients };
	}

	it('reports licensed once the client checks a seat out', async () => {
		const { manager, clients } = createManager();

		const started = manager.start();
		clients[0].stdout.write(ACTIVATED_FRAME);
		await flush();

		await expect(started).resolves.toBe(true);
	});

	it('fails startup when the client never checks a seat out', async () => {
		const { manager, onUnlicensed, clients } = createManager();

		const started = manager.start();
		clients[0].stdout.write(EXPIRED_FRAME);
		await flush();
		vi.advanceTimersByTime(60_000);

		await expect(started).resolves.toBe(false);
		expect(onUnlicensed).not.toHaveBeenCalled();
	});

	it('does not read the client stderr diagnostics as lease messages', async () => {
		const { manager, clients } = createManager();

		const started = manager.start();
		clients[0].stderr.write(ACTIVATED_FRAME);
		await flush();
		vi.advanceTimersByTime(60_000);

		await expect(started).resolves.toBe(false);
	});

	it('holds the license through a silent client, and enforces only after grace', async () => {
		const { manager, onUnlicensed, clients } = createManager();

		const started = manager.start();
		clients[0].stdout.write(ACTIVATED_FRAME);
		await flush();
		await expect(started).resolves.toBe(true);

		// Leases run up to 90 minutes, so silence is not a failure signal.
		vi.advanceTimersByTime(90 * 60_000);
		expect(onUnlicensed).not.toHaveBeenCalled();

		clients[0].stdout.write(EXPIRED_FRAME);
		await flush();
		vi.advanceTimersByTime(9_999);
		expect(onUnlicensed).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1);
		expect(onUnlicensed).toHaveBeenCalledTimes(1);
	});

	it('does not restart the grace countdown on repeated failures', async () => {
		// The client reports roughly every 10s while failing; rearming each time
		// would keep the server running unlicensed indefinitely.
		const { manager, onUnlicensed, clients } = createManager();

		const started = manager.start();
		clients[0].stdout.write(ACTIVATED_FRAME);
		await flush();
		await expect(started).resolves.toBe(true);

		for (let elapsed = 0; elapsed < 10_000; elapsed += 1_000) {
			clients[0].stdout.write(EXPIRED_FRAME);
			await flush();
			vi.advanceTimersByTime(1_000);
		}

		expect(onUnlicensed).toHaveBeenCalledTimes(1);
	});

	it('respawns the client after it exits, and the new lease clears grace', async () => {
		const { manager, onUnlicensed, clients } = createManager();

		const started = manager.start();
		clients[0].stdout.write(ACTIVATED_FRAME);
		await flush();
		await expect(started).resolves.toBe(true);

		clients[0].exit();
		vi.advanceTimersByTime(5_000);
		expect(clients).toHaveLength(2);

		clients[1].stdout.write(ACTIVATED_FRAME);
		await flush();
		vi.advanceTimersByTime(60_000);
		expect(onUnlicensed).not.toHaveBeenCalled();
	});

	it('waits for the client to check the seat back in when stopped', async () => {
		const { manager, clients } = createManager({ stopTimeoutMs: 5_000 });

		const started = manager.start();
		clients[0].stdout.write(ACTIVATED_FRAME);
		await flush();
		await expect(started).resolves.toBe(true);

		let returned = false;
		const stopping = manager.stop().then(() => { returned = true; });
		await flush();

		// The signal has gone out, but the client has not finished the check-in
		// until it exits -- exiting the server here would kill it part-way.
		expect(clients[0].kill).toHaveBeenCalledWith('SIGTERM');
		expect(returned).toBe(false);

		clients[0].exit();
		await stopping;
		expect(returned).toBe(true);
	});

	it('gives up on a client that does not exit, rather than blocking shutdown', async () => {
		const { manager, clients } = createManager({ stopTimeoutMs: 5_000 });

		const started = manager.start();
		clients[0].stdout.write(ACTIVATED_FRAME);
		await flush();
		await expect(started).resolves.toBe(true);

		const stopping = manager.stop();
		vi.advanceTimersByTime(5_000);

		await expect(stopping).resolves.toBeUndefined();
		// A wedged client must not be respawned on the way out either.
		expect(clients).toHaveLength(1);
	});

	it('signals the client and cancels pending enforcement when disposed', async () => {
		const { manager, onUnlicensed, clients } = createManager();

		const started = manager.start();
		clients[0].stdout.write(ACTIVATED_FRAME);
		await flush();
		await expect(started).resolves.toBe(true);

		clients[0].stdout.write(EXPIRED_FRAME);
		await flush();
		manager.dispose();

		expect(clients[0].kill).toHaveBeenCalledWith('SIGTERM');
		vi.advanceTimersByTime(60_000);
		expect(onUnlicensed).not.toHaveBeenCalled();
		expect(clients).toHaveLength(1);
	});
});

describe('LicenseManager (real child process)', () => {
	const disposables = ensureNoLeakedDisposables();

	it('reads frames from a real client on stdout', async () => {
		const script = `process.stdout.write(${JSON.stringify(ACTIVATED_FRAME)}); setInterval(() => {}, 1000);`;
		const manager = disposables.add(new LicenseManager({
			binaryPath: process.execPath,
			args: ['-e', script],
			onUnlicensed: vi.fn(),
			startupTimeoutMs: 10_000,
		}));

		await expect(manager.start()).resolves.toBe(true);
	});
});
