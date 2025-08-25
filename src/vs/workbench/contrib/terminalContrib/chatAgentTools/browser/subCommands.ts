/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { OperatingSystem } from '../../../../../base/common/platform.js';
import { isPowerShell } from './runInTerminalHelpers.js';

// Derived from https://github.com/microsoft/vscode/blob/315b0949786b3807f05cb6acd13bf0029690a052/extensions/terminal-suggest/src/tokens.ts#L14-L18
// Some of these can match the same string, so the order matters. Always put the more specific one
// first (eg. >> before >)
const shellTypeResetChars = new Map<'sh' | 'zsh' | 'pwsh', string[]>([
	['sh', ['&>>', '2>>', '>>', '2>', '&>', '||', '&&', '|&', '<<', '&', ';', '{', '>', '<', '|']],
	['zsh', ['<<<', '2>>', '&>>', '>>', '2>', '&>', '<(', '<>', '||', '&&', '|&', '&', ';', '{', '<<', '<(', '>', '<', '|']],
	['pwsh', ['*>>', '2>>', '>>', '2>', '&&', '*>', '>', '<', '|', ';', '!', '&']],
]);

export function splitCommandLineIntoSubCommands(commandLine: string, envShell: string, envOS: OperatingSystem): string[] {
	let shellType: 'sh' | 'zsh' | 'pwsh';
	const envShellWithoutExe = envShell.replace(/\.exe$/, '');
	if (isPowerShell(envShell, envOS)) {
		shellType = 'pwsh';
	} else {
		switch (envShellWithoutExe) {
			case 'zsh': shellType = 'zsh'; break;
			default: shellType = 'sh'; break;
		}
	}
	const subCommands = [commandLine];
	const resetChars = shellTypeResetChars.get(shellType);
	if (resetChars) {
		for (const chars of resetChars) {
			for (let i = 0; i < subCommands.length; i++) {
				const subCommand = subCommands[i];
				if (subCommand.includes(chars)) {
					subCommands.splice(i, 1, ...subCommand.split(chars).map(e => e.trim()));
					i--;
				}
			}
		}
	}
	return subCommands;
}

export function extractInlineSubCommands(commandLine: string, envShell: string, envOS: OperatingSystem): Set<string> {
	const inlineCommands: string[] = [];
	const shellType = isPowerShell(envShell, envOS) ? 'pwsh' : 'sh';

	/**
	 * Extract command substitutions that start with a specific prefix and are enclosed in parentheses
	 * Handles nested parentheses correctly
	 */
	function extractWithPrefix(text: string, prefix: string): string[] {
		const results: string[] = [];
		let i = 0;

		while (i < text.length) {
			const startIndex = text.indexOf(prefix, i);
			if (startIndex === -1) {
				break;
			}

			const contentStart = startIndex + prefix.length;
			if (contentStart >= text.length || text[contentStart] !== '(') {
				i = startIndex + 1;
				continue;
			}

			// Find the matching closing parenthesis, handling nested parentheses
			let parenCount = 1;
			let j = contentStart + 1;

			while (j < text.length && parenCount > 0) {
				if (text[j] === '(') {
					parenCount++;
				} else if (text[j] === ')') {
					parenCount--;
				}
				j++;
			}

			if (parenCount === 0) {
				// Found matching closing parenthesis
				const innerCommand = text.substring(contentStart + 1, j - 1).trim();
				if (innerCommand) {
					results.push(innerCommand);
					// Recursively extract nested inline commands
					results.push(...extractInlineSubCommands(innerCommand, envShell, envOS));
				}
			}

			i = startIndex + 1;
		}

		return results;
	}

	/**
	 * Extract backtick command substitutions (legacy POSIX)
	 */
	function extractBackticks(text: string): string[] {
		const results: string[] = [];
		let i = 0;

		while (i < text.length) {
			const startIndex = text.indexOf('`', i);
			if (startIndex === -1) {
				break;
			}

			const endIndex = text.indexOf('`', startIndex + 1);
			if (endIndex === -1) {
				break;
			}

			const innerCommand = text.substring(startIndex + 1, endIndex).trim();
			if (innerCommand) {
				results.push(innerCommand);
				// Recursively extract nested inline commands
				results.push(...extractInlineSubCommands(innerCommand, envShell, envOS));
			}

			i = endIndex + 1;
		}

		return results;
	}

	if (shellType === 'pwsh') {
		// PowerShell command substitution patterns
		inlineCommands.push(...extractWithPrefix(commandLine, '$'));  // $(command)
		inlineCommands.push(...extractWithPrefix(commandLine, '@'));  // @(command)
		inlineCommands.push(...extractWithPrefix(commandLine, '&'));  // &(command)
	} else {
		// POSIX shell (bash, zsh, sh) command substitution patterns
		inlineCommands.push(...extractWithPrefix(commandLine, '$'));  // $(command)
		inlineCommands.push(...extractWithPrefix(commandLine, '<'));  // <(command) - process substitution
		inlineCommands.push(...extractWithPrefix(commandLine, '>'));  // >(command) - process substitution
		inlineCommands.push(...extractBackticks(commandLine));        // `command`
	}

	return new Set(inlineCommands);
}
