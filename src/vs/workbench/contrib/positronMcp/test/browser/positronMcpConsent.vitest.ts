/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
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
	function consentManager(answers: boolean[], auditDetail = 'summary') {
		const prompt = vi.fn(async () => answers.shift() ?? false);
		const modal = stubInterface<IPositronModalDialogsService>({ showSimpleModalDialogPrompt: prompt });
		const configuration = stubInterface<IConfigurationService>({ getValue: () => auditDetail });
		return { consent: new UserConsentManager(modal, configuration, new NullLogService()), prompt };
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

	it('isAllowAllActive tracks the allow-all decision and reset', async () => {
		const { consent } = consentManager([true, true]);
		expect(consent.isAllowAllActive()).toBe(false);
		await consent.requestCodeExecutionConsent('python', 'a = 1');
		expect(consent.isAllowAllActive()).toBe(true);
		consent.reset();
		expect(consent.isAllowAllActive()).toBe(false);
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

	it('onDidChangeAllowAll fires on grant and reset, but not on a redundant reset', async () => {
		const { consent } = consentManager([true, true]);
		const changes: boolean[] = [];
		consent.onDidChangeAllowAll(value => changes.push(value));

		// No allow-all yet, so a reset is a no-op for the event.
		consent.reset();
		expect(changes).toEqual([]);

		await consent.requestCodeExecutionConsent('python', 'a = 1');
		consent.reset();
		consent.reset();
		expect(changes).toEqual([true, false]);
	});

	const claude = { mcpSessionId: 's1', clientName: 'claude-code', clientVersion: '1.0.0' };
	const codex = { mcpSessionId: 's2', clientName: 'codex-mcp-client', clientVersion: '0.9.0' };

	it('names the agent in the consent prompts', async () => {
		const { consent, prompt } = consentManager([true, true]);
		await consent.requestCodeExecutionConsent('python', 'a = 1', claude);
		expect(prompt).toHaveBeenNthCalledWith(1,
			'Execute PYTHON Code?', expect.stringContaining('Claude Code wants to run 1 lines'), 'Allow', 'Deny');
		expect(prompt).toHaveBeenNthCalledWith(2,
			'Allow All Code Execution?', expect.stringContaining('from Claude Code'), 'Allow All', 'Just Once');
	});

	it('claims full code in the logs only when the audit detail setting is full', async () => {
		const summary = consentManager([false]);
		await summary.consent.requestCodeExecutionConsent('python', 'a = 1');
		expect(summary.prompt).toHaveBeenCalledWith(
			expect.anything(), expect.stringContaining('(Code preview in MCP logs)'), 'Allow', 'Deny');

		const full = consentManager([false], 'full');
		await full.consent.requestCodeExecutionConsent('python', 'a = 1');
		expect(full.prompt).toHaveBeenCalledWith(
			expect.anything(), expect.stringContaining('(Full code in the MCP audit log)'), 'Allow', 'Deny');
	});

	it('scopes allow-all to the granting client: one agent cannot ride on another', async () => {
		// Claude: allow + allow-all; Codex: deny.
		const { consent, prompt } = consentManager([true, true, false]);
		await consent.requestCodeExecutionConsent('python', 'a = 1', claude);
		// Same code from another agent still prompts, and the denial holds.
		expect(await consent.requestCodeExecutionConsent('python', 'a = 1', codex)).toBe(false);
		expect(prompt).toHaveBeenCalledTimes(3);
		// Claude's allow-all still covers new Claude code without a prompt.
		expect(await consent.requestCodeExecutionConsent('python', 'b = 2', claude)).toBe(true);
		expect(prompt).toHaveBeenCalledTimes(3);
	});

	it('scopes cached per-code decisions to the client', async () => {
		// Claude: allow once (no allow-all); Codex: allow once (no allow-all).
		const { consent, prompt } = consentManager([true, false, true, false]);
		await consent.requestCodeExecutionConsent('python', 'a = 1', claude);
		// Codex running the identical code does not skip the prompt.
		await consent.requestCodeExecutionConsent('python', 'a = 1', codex);
		expect(prompt).toHaveBeenCalledTimes(4);
	});

	it('scopes an anonymous caller by its session id, not a shared bucket', async () => {
		// Two sessions that never identified themselves (e.g. resumed after a restart).
		const { consent, prompt } = consentManager([true, true, true, false]);
		await consent.requestCodeExecutionConsent('python', 'a = 1', { mcpSessionId: 'anon-1' });
		// The other anonymous session gets neither the cache hit nor the allow-all.
		await consent.requestCodeExecutionConsent('python', 'a = 1', { mcpSessionId: 'anon-2' });
		expect(prompt).toHaveBeenCalledTimes(4);
	});

	it('isAllowAllActive reflects any client, and reset clears every client', async () => {
		const { consent } = consentManager([true, true, true, true]);
		await consent.requestCodeExecutionConsent('python', 'a = 1', claude);
		await consent.requestCodeExecutionConsent('python', 'b = 2', codex);
		expect(consent.isAllowAllActive()).toBe(true);
		consent.reset();
		expect(consent.isAllowAllActive()).toBe(false);
	});
});
