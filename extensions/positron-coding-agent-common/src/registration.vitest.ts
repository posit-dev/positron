/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { registerWhileInstalled } from './registration';

describe('registerWhileInstalled', () => {
	/** Track registrations, and which are still registered. */
	function createRegister() {
		const live = new Set<number>();
		let next = 0;
		const register = vi.fn(() => {
			const id = next++;
			live.add(id);
			return { dispose: () => live.delete(id) };
		});
		return { register, live };
	}

	it('registers while installed and unregisters once removed', async () => {
		let installed = true;
		const { register, live } = createRegister();
		const registration = registerWhileInstalled(async () => installed, register);

		await registration.update();
		await registration.update();
		expect({ registrations: register.mock.calls.length, live: live.size }).toEqual({ registrations: 1, live: 1 });

		installed = false;
		await registration.update();
		expect(live.size).toBe(0);
	});

	it('follows the latest check when updates overlap', async () => {
		const results = [true, false];
		const { register, live } = createRegister();
		const registration = registerWhileInstalled(async () => results.shift() ?? false, register);

		// The second update arrives while the first check runs, so a check
		// runs again after it and the agent ends up removed.
		const first = registration.update();
		const second = registration.update();
		await Promise.all([first, second]);

		expect({ registrations: register.mock.calls.length, live: live.size }).toEqual({ registrations: 1, live: 0 });
	});

	it('unregisters on dispose, and ignores a check that finishes after', async () => {
		let resolveCheck!: (installed: boolean) => void;
		const { register, live } = createRegister();
		const registration = registerWhileInstalled(() => new Promise(resolve => resolveCheck = resolve), register);

		const update = registration.update();
		registration.dispose();
		resolveCheck(true);
		await update;

		expect({ registrations: register.mock.calls.length, live: live.size }).toEqual({ registrations: 0, live: 0 });
	});
});
