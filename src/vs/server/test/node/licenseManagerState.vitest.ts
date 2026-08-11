/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LicenseManagerMessage } from '../../node/licenseManagerStream.js';
import { LicenseState, LicenseStateMachine } from '../../node/licenseManagerState.js';

/** Builds a message of the given status; other fields are irrelevant here. */
function message(status: string): LicenseManagerMessage {
	return { status, expirationMs: 9999999999000, daysLeft: 7, users: 5 };
}

describe('LicenseStateMachine', () => {
	/** Advances time so grace periods can be tested without waiting. */
	async function advance(ms: number): Promise<void> {
		await vi.advanceTimersByTimeAsync(ms);
	}

	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('starts unlicensed before any message arrives', () => {
		const machine = new LicenseStateMachine();

		expect(machine.state).toBe('unlicensed');
	});

	it('becomes licensed on an activated message', () => {
		const machine = new LicenseStateMachine();

		machine.onMessage(message('activated'));

		expect(machine.state).toBe('licensed');
	});

	it('resolves awaitStartup true when activated arrives within the timeout', async () => {
		const machine = new LicenseStateMachine({ startupTimeoutMs: 60_000 });

		const startup = machine.awaitStartup();
		await advance(30_000);
		machine.onMessage(message('activated'));

		await expect(startup).resolves.toBe(true);
	});

	it('resolves awaitStartup false when no activated message arrives in time', async () => {
		const machine = new LicenseStateMachine({ startupTimeoutMs: 60_000 });

		const startup = machine.awaitStartup();
		await advance(60_001);

		await expect(startup).resolves.toBe(false);
	});

	it('resolves awaitStartup false when only expired messages arrive', async () => {
		const machine = new LicenseStateMachine({ startupTimeoutMs: 60_000 });

		const startup = machine.awaitStartup();
		// The client emits an expired frame every ~10s while it cannot check out.
		for (let i = 0; i < 6; i++) {
			machine.onMessage(message('expired'));
			await advance(10_000);
		}
		await advance(1);

		await expect(startup).resolves.toBe(false);
	});

	it('enters grace on an expired message and stays there until the grace period ends', async () => {
		const machine = new LicenseStateMachine({ graceMs: 600_000 });
		machine.onMessage(message('activated'));

		machine.onMessage(message('expired'));

		expect(machine.state).toBe('grace');
		await advance(599_999);
		expect(machine.state).toBe('grace');
	});

	it('becomes unlicensed once the grace period elapses', async () => {
		const machine = new LicenseStateMachine({ graceMs: 600_000 });
		machine.onMessage(message('activated'));

		machine.onMessage(message('expired'));
		await advance(600_001);

		expect(machine.state).toBe('unlicensed');
	});

	it('does not restart the grace timer on repeated expired messages', async () => {
		const machine = new LicenseStateMachine({ graceMs: 600_000 });
		machine.onMessage(message('activated'));

		// The first expired frame starts the clock; the ~10s repeats that follow
		// must not keep pushing the deadline out, or grace would never end.
		machine.onMessage(message('expired'));
		for (let i = 0; i < 59; i++) {
			await advance(10_000);
			machine.onMessage(message('expired'));
		}
		await advance(10_001);

		expect(machine.state).toBe('unlicensed');
	});

	it('recovers to licensed when an activated message arrives during grace', async () => {
		const machine = new LicenseStateMachine({ graceMs: 600_000 });
		machine.onMessage(message('activated'));
		machine.onMessage(message('expired'));

		await advance(300_000);
		machine.onMessage(message('activated'));

		expect(machine.state).toBe('licensed');
	});

	it('cancels the grace timer on recovery so it cannot fire later', async () => {
		const machine = new LicenseStateMachine({ graceMs: 600_000 });
		machine.onMessage(message('activated'));
		machine.onMessage(message('expired'));
		await advance(300_000);
		machine.onMessage(message('activated'));

		// Past when the original grace deadline would have been.
		await advance(600_000);

		expect(machine.state).toBe('licensed');
	});

	it('enters grace when the child process goes down', () => {
		const machine = new LicenseStateMachine();
		machine.onMessage(message('activated'));

		machine.onChildDown();

		expect(machine.state).toBe('grace');
	});

	it('becomes unlicensed if the child stays down past the grace period', async () => {
		const machine = new LicenseStateMachine({ graceMs: 600_000 });
		machine.onMessage(message('activated'));

		machine.onChildDown();
		await advance(600_001);

		expect(machine.state).toBe('unlicensed');
	});

	it('recovers when the respawned child reports activated', async () => {
		const machine = new LicenseStateMachine({ graceMs: 600_000 });
		machine.onMessage(message('activated'));

		machine.onChildDown();
		await advance(10_000);
		machine.onMessage(message('activated'));

		expect(machine.state).toBe('licensed');
	});

	it('stays licensed through long silences while the child is alive', async () => {
		const machine = new LicenseStateMachine({ graceMs: 600_000 });
		machine.onMessage(message('activated'));

		// A 90 minute lease extended at 75% TTL means ~67 minutes of silence is
		// normal. Silence alone must never revoke the license.
		await advance(67 * 60_000);

		expect(machine.state).toBe('licensed');
	});

	it('notifies subscribers only when the state actually changes', async () => {
		const machine = new LicenseStateMachine({ graceMs: 600_000 });
		const states: LicenseState[] = [];
		machine.onStateChange(s => states.push(s));

		machine.onMessage(message('activated'));
		machine.onMessage(message('activated'));
		machine.onMessage(message('expired'));
		machine.onMessage(message('expired'));
		await advance(600_001);

		expect(states).toEqual(['licensed', 'grace', 'unlicensed']);
	});
});
