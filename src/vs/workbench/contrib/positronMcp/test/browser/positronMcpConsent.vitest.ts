/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IPositronModalDialogsService } from '../../../../services/positronModalDialogs/common/positronModalDialogs.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { UserConsentManager } from '../../browser/positronMcpConsent.js';

describe('UserConsentManager', () => {
	/**
	 * A modal-dialog stub whose prompt returns the queued answers in order. The
	 * consent flow asks at most two prompts (allow-this, then allow-all), so a
	 * queue is enough to script each scenario.
	 */
	function consentManager(answers: boolean[]) {
		const prompt = vi.fn(async () => answers.shift() ?? false);
		const modal = stubInterface<IPositronModalDialogsService>({ showSimpleModalDialogPrompt: prompt });
		return { consent: new UserConsentManager(modal, new NullLogService()), prompt };
	}

	it('returns false and does not cache when the first prompt is denied', async () => {
		const { consent, prompt } = consentManager([false]);
		expect(await consent.requestCodeExecutionConsent('python', 'print(1)')).toBe(false);
		// A denied decision is not cached, so a re-request prompts again.
		await consent.requestCodeExecutionConsent('python', 'print(1)');
		expect(prompt).toHaveBeenCalledTimes(2);
	});

	it('caches a one-time allow so identical code is not re-prompted', async () => {
		// allow this once, decline allow-all.
		const { consent, prompt } = consentManager([true, false]);
		expect(await consent.requestCodeExecutionConsent('python', 'print(1)')).toBe(true);
		expect(await consent.requestCodeExecutionConsent('python', 'print(1)')).toBe(true);
		// Two prompts for the first call (allow, allow-all), none for the cached second.
		expect(prompt).toHaveBeenCalledTimes(2);
	});

	it('allow-all approves later, different code with no prompt', async () => {
		// allow this once, then allow-all.
		const { consent, prompt } = consentManager([true, true]);
		expect(await consent.requestCodeExecutionConsent('python', 'a = 1')).toBe(true);
		expect(await consent.requestCodeExecutionConsent('r', 'b <- 2')).toBe(true);
		expect(prompt).toHaveBeenCalledTimes(2);
	});

	it('reset clears the cache and the allow-all decision', async () => {
		const { consent, prompt } = consentManager([true, true, false]);
		await consent.requestCodeExecutionConsent('python', 'a = 1');
		consent.reset();
		// After reset, allow-all no longer holds and the cache is empty, so the
		// next request prompts again (and we deny it here).
		expect(await consent.requestCodeExecutionConsent('python', 'a = 1')).toBe(false);
		expect(prompt).toHaveBeenCalledTimes(3);
	});
});
