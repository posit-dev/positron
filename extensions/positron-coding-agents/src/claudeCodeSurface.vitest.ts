/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { getClaudeCodeSurface } from './claudeCodeSurface';

describe('getClaudeCodeSurface', () => {
	it('opens a new chat when useTerminal is off', () => {
		expect(getClaudeCodeSurface('2.1.282', false)).toBe('chat');
	});

	it('opens a new terminal session when useTerminal is on', () => {
		expect(getClaudeCodeSurface('2.1.282', true)).toBe('terminal');
	});

	it('accepts the first version whose chat takes a prompt', () => {
		expect(getClaudeCodeSurface('2.0.35', false)).toBe('chat');
	});

	it('rejects versions whose chat ignores the prompt', () => {
		expect(getClaudeCodeSurface('2.0.34', false)).toBeUndefined();
		expect(getClaudeCodeSurface('1.0.126', false)).toBeUndefined();
	});

	it('opens a terminal session on any version, since it runs the CLI directly', () => {
		expect(getClaudeCodeSurface('1.0.126', true)).toBe('terminal');
	});
});

