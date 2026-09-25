/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { formatPrompt, formatTerminalPrompt, getClaudeCodeSurface } from './claudeCodeLaunch';

describe('formatPrompt', () => {
	it('inlines the error context as a fenced block after the instruction', () => {
		expect(formatPrompt({
			instruction: 'Fix this console error.',
			error: 'NameError: name "x" is not defined',
		})).toBe('Fix this console error.\n\n```\nNameError: name "x" is not defined\n```');
	});

	it('lengthens the fence past any backticks in the error', () => {
		expect(formatPrompt({
			instruction: 'Explain this error.',
			error: 'code: ```x```',
		})).toBe('Explain this error.\n\n````\ncode: ```x```\n````');
	});

	it('sends only the instruction when there is no error output', () => {
		expect(formatPrompt({ instruction: 'Fix this.', error: '' })).toBe('Fix this.');
	});
});

describe('formatTerminalPrompt', () => {
	const context = { instruction: 'Fix this console error.', error: 'Error:\n! boom' };

	it('keeps the prompt on one line and @-mentions the error file', () => {
		expect(formatTerminalPrompt(context, '/tmp/positron-claude-code/error-1.txt'))
			.toBe('Fix this console error. @/tmp/positron-claude-code/error-1.txt');
	});

	it('quotes an error path that contains spaces', () => {
		expect(formatTerminalPrompt(context, 'C:\\Users\\Ada Lovelace\\error.txt'))
			.toBe('Fix this console error. @"C:\\Users\\Ada Lovelace\\error.txt"');
	});

	it('flattens newlines in the instruction itself', () => {
		expect(formatTerminalPrompt({ ...context, instruction: 'Explain.\nDo not edit files.' }, undefined))
			.toBe('Explain. Do not edit files.');
	});
});

describe('getClaudeCodeSurface', () => {
	it('opens a new chat when useTerminal is off', () => {
		expect(getClaudeCodeSurface('2.1.282', false)).toBe('chat');
	});

	it('opens a new terminal session when useTerminal is on', () => {
		expect(getClaudeCodeSurface('2.1.282', true)).toBe('terminal');
	});

	it('accepts the first versions that take a prompt', () => {
		expect(getClaudeCodeSurface('2.0.35', false)).toBe('chat');
		expect(getClaudeCodeSurface('2.0.24', true)).toBe('terminal');
	});

	it('rejects versions that ignore the prompt', () => {
		expect(getClaudeCodeSurface('2.0.34', false)).toBeUndefined();
		expect(getClaudeCodeSurface('2.0.23', true)).toBeUndefined();
		expect(getClaudeCodeSurface('1.0.126', false)).toBeUndefined();
	});
});

