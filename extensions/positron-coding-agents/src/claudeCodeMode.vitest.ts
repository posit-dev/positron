/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { getClaudeCodeMode } from './claudeCodeMode';

describe('getClaudeCodeMode', () => {
	it('opens the chat when Use Terminal is off', () => {
		expect(getClaudeCodeMode({ extensionVersion: '2.1.303', useTerminal: false, hasCommand: true })).toBe('chat');
	});

	it('opens a terminal when Use Terminal is on', () => {
		expect(getClaudeCodeMode({ extensionVersion: '2.1.303', useTerminal: true, hasCommand: true })).toBe('terminal');
	});

	it('opens a terminal with only the command installed', () => {
		expect(getClaudeCodeMode({ extensionVersion: undefined, useTerminal: false, hasCommand: true })).toBe('terminal');
	});

	it('reports a missing command when Use Terminal is on', () => {
		expect(getClaudeCodeMode({ extensionVersion: '2.1.303', useTerminal: true, hasCommand: false })).toBe('commandNotFound');
	});

	it('accepts the first version whose chat takes a prompt, and rejects older ones', () => {
		expect([
			getClaudeCodeMode({ extensionVersion: '2.0.35', useTerminal: false, hasCommand: false }),
			getClaudeCodeMode({ extensionVersion: '2.0.34', useTerminal: false, hasCommand: true }),
			getClaudeCodeMode({ extensionVersion: '1.0.126', useTerminal: false, hasCommand: true }),
		]).toEqual(['chat', 'tooOld', 'tooOld']);
	});

	it('opens a terminal with any version, since it runs the command directly', () => {
		expect(getClaudeCodeMode({ extensionVersion: '1.0.126', useTerminal: true, hasCommand: true })).toBe('terminal');
	});
});
