/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { isPastClaudeCodeTrustPrompt, isPastCodexTrustPrompt } from './agentTrust';

describe('isPastClaudeCodeTrustPrompt', () => {
	const config = JSON.stringify({
		projects: {
			'/work/trusted': { hasTrustDialogAccepted: true },
			'/work/declined': { hasTrustDialogAccepted: false },
		},
	});

	it('is past the prompt in a trusted directory or below one', () => {
		expect(isPastClaudeCodeTrustPrompt(config, '/work/trusted')).toBe(true);
		expect(isPastClaudeCodeTrustPrompt(config, '/work/trusted/src/app')).toBe(true);
	});

	it('is at the prompt in a directory that was never trusted', () => {
		expect(isPastClaudeCodeTrustPrompt(config, '/work/declined')).toBe(false);
		expect(isPastClaudeCodeTrustPrompt(config, '/work/other')).toBe(false);
		expect(isPastClaudeCodeTrustPrompt(config, '/work')).toBe(false);
	});

	it('is at the prompt when the config has no projects or cannot be read', () => {
		expect(isPastClaudeCodeTrustPrompt('{}', '/work/trusted')).toBe(false);
		expect(isPastClaudeCodeTrustPrompt('not json', '/work/trusted')).toBe(false);
	});
});

describe('isPastCodexTrustPrompt', () => {
	const config = [
		'model = "gpt-5"',
		'',
		'[projects."/work/trusted"]',
		'trust_level = "trusted"',
		'',
		'[projects."/work/read only"]',
		'trust_level = "untrusted"',
		'',
		'[projects.\'/work/literal\']',
		'trust_level = "trusted"',
		'',
		'[projects."/work/quote\\"d"]',
		'trust_level = "trusted"',
	].join('\n');

	it('is past the prompt in a directory the user answered it for, or below one', () => {
		expect(isPastCodexTrustPrompt(config, '/work/trusted')).toBe(true);
		expect(isPastCodexTrustPrompt(config, '/work/trusted/src')).toBe(true);
		// Declining to trust a directory still answers the prompt.
		expect(isPastCodexTrustPrompt(config, '/work/read only')).toBe(true);
		expect(isPastCodexTrustPrompt(config, '/work/literal')).toBe(true);
		expect(isPastCodexTrustPrompt(config, '/work/quote"d')).toBe(true);
	});

	it('is at the prompt in a directory with no project entry', () => {
		expect(isPastCodexTrustPrompt(config, '/work/other')).toBe(false);
		expect(isPastCodexTrustPrompt('', '/work/trusted')).toBe(false);
	});
});
