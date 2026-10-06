/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { findForegroundProcess, isClaudeCodeCommand, isCodexCommand, parseProcessTable } from './foregroundProcess';

describe('parseProcessTable', () => {
	it('reads pid, ppid, pgid, tpgid, and the full command line', () => {
		expect(parseProcessTable('  101     1   101   205 /bin/zsh -il\n  205   101   205   205 claude --continue\n')).toEqual([
			{ pid: 101, ppid: 1, pgid: 101, tpgid: 205, args: '/bin/zsh -il' },
			{ pid: 205, ppid: 101, pgid: 205, tpgid: 205, args: 'claude --continue' },
		]);
	});

	it('skips lines it cannot read', () => {
		expect(parseProcessTable('garbage\n\n')).toEqual([]);
	});
});

describe('findForegroundProcess', () => {
	it('finds claude running in the foreground of the terminal\'s shell', () => {
		const processes = parseProcessTable([
			'101 1 101 205 /bin/zsh -il',
			'205 101 205 205 claude',
			'206 205 205 205 /opt/positron/kcserver mcp-stdio',
		].join('\n'));
		expect(findForegroundProcess(processes, 101, isClaudeCodeCommand)?.pid).toBe(205);
	});

	it('ignores claude when it is suspended or backgrounded', () => {
		// The shell is back in the foreground; claude's group is not.
		const processes = parseProcessTable([
			'101 1 101 101 /bin/zsh -il',
			'205 101 205 101 claude',
		].join('\n'));
		expect(findForegroundProcess(processes, 101, isClaudeCodeCommand)).toBeUndefined();
	});

	it('ignores claude running under a different terminal', () => {
		const processes = parseProcessTable([
			'101 1 101 101 /bin/zsh -il',
			'301 1 301 305 /bin/zsh -il',
			'305 301 305 305 claude',
		].join('\n'));
		expect(findForegroundProcess(processes, 101, isClaudeCodeCommand)).toBeUndefined();
	});

	it('finds claude when it is the terminal\'s own process', () => {
		const processes = parseProcessTable('205 1 205 205 /Users/ada/.local/bin/claude hello');
		expect(findForegroundProcess(processes, 205, isClaudeCodeCommand)?.pid).toBe(205);
	});
});

describe('isClaudeCodeCommand', () => {
	it('matches the native executable however it was invoked', () => {
		expect(isClaudeCodeCommand('claude')).toBe(true);
		expect(isClaudeCodeCommand('/Users/ada/.local/bin/claude --resume')).toBe(true);
	});

	it('matches the npm package run under Node', () => {
		expect(isClaudeCodeCommand('node /usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js')).toBe(true);
	});

	it('does not match other commands that mention claude', () => {
		expect(isClaudeCodeCommand('vim claude.md')).toBe(false);
		expect(isClaudeCodeCommand('/bin/zsh -c claude-notes')).toBe(false);
		expect(isClaudeCodeCommand('vim /usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js')).toBe(false);
	});
});

describe('isCodexCommand', () => {
	it('matches the native executable however it was invoked', () => {
		expect(isCodexCommand('codex')).toBe(true);
		expect(isCodexCommand('/opt/homebrew/bin/codex resume')).toBe(true);
	});

	it('matches the npm package run under Node', () => {
		expect(isCodexCommand('node /usr/local/lib/node_modules/@openai/codex/bin/codex.js')).toBe(true);
	});

	it('does not match other commands that mention codex', () => {
		expect(isCodexCommand('vim codex.md')).toBe(false);
		expect(isCodexCommand('claude')).toBe(false);
		expect(isCodexCommand('vim /usr/local/lib/node_modules/@openai/codex/README.md')).toBe(false);
		expect(isCodexCommand('vim /usr/local/lib/node_modules/@openai/codex/bin/codex.js')).toBe(false);
	});
});
