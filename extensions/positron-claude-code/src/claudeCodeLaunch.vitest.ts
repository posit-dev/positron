/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { formatPrompt, formatTerminalPrompt, getClaudeCodeSurface } from './claudeCodeLaunch';

describe('formatPrompt', () => {
	it('inlines the error context as a fenced block after the prompt', () => {
		expect(formatPrompt({
			action: 'fix',
			prompt: 'Fix this console error.',
			context: 'NameError: name "x" is not defined',
			contextName: 'Console Error',
		})).toBe('Fix this console error.\n\nConsole Error:\n```\nNameError: name "x" is not defined\n```');
	});

	it('lengthens the fence past any backticks in the context', () => {
		expect(formatPrompt({
			action: 'explain',
			prompt: 'Explain this error.',
			context: 'code: ```x```',
			contextName: 'Notebook Cell Error',
		})).toBe('Explain this error.\n\nNotebook Cell Error:\n````\ncode: ```x```\n````');
	});

	it('sends only the prompt when there is no context', () => {
		expect(formatPrompt({ action: 'fix', prompt: 'Fix this.', context: '', contextName: 'Console Error' })).toBe('Fix this.');
	});
});

describe('formatTerminalPrompt', () => {
	const request = { action: 'fix' as const, prompt: 'Fix this console error.', context: 'Error:\n! boom', contextName: 'Console Error' };

	it('keeps the prompt on one line and @-mentions the context file', () => {
		expect(formatTerminalPrompt(request, '/tmp/positron-claude-code/error-1.txt'))
			.toBe('Fix this console error. Console Error: @/tmp/positron-claude-code/error-1.txt');
	});

	it('quotes a context path that contains spaces', () => {
		expect(formatTerminalPrompt(request, 'C:\\Users\\Ada Lovelace\\error.txt'))
			.toBe('Fix this console error. Console Error: @"C:\\Users\\Ada Lovelace\\error.txt"');
	});

	it('flattens newlines in the prompt itself', () => {
		expect(formatTerminalPrompt({ ...request, prompt: 'Explain.\nDo not edit files.' }, undefined))
			.toBe('Explain. Do not edit files.');
	});
});

describe('getClaudeCodeSurface', () => {
	it('opens a new chat when useTerminal is off', () => {
		expect(getClaudeCodeSurface('2.1.282', false)).toEqual({ kind: 'chat' });
	});

	it('opens a new terminal session when useTerminal is on', () => {
		expect(getClaudeCodeSurface('2.1.282', true)).toEqual({ kind: 'terminal' });
	});

	it('accepts the first versions that take a prompt', () => {
		expect(getClaudeCodeSurface('2.0.35', false)).toEqual({ kind: 'chat' });
		expect(getClaudeCodeSurface('2.0.24', true)).toEqual({ kind: 'terminal' });
	});

	it('reports versions that ignore the prompt as outdated', () => {
		expect(getClaudeCodeSurface('2.0.34', false)).toEqual({ kind: 'outdated', minimumVersion: '2.0.35' });
		expect(getClaudeCodeSurface('2.0.23', true)).toEqual({ kind: 'outdated', minimumVersion: '2.0.24' });
		expect(getClaudeCodeSurface('1.0.126', false)).toEqual({ kind: 'outdated', minimumVersion: '2.0.35' });
	});
});
