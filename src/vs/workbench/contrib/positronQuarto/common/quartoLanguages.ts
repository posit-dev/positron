/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IRuntimeStartupService } from '../../../services/runtimeStartup/common/runtimeStartupService.js';

/**
 * Shell languages that are executed via terminal.
 */
const SHELL_LANGUAGES = new Set(['bash', 'sh', 'zsh', 'fish', 'shell', 'powershell', 'pwsh', 'cmd']);

/**
 * Check if a language should be executed via terminal.
 */
export function isShellLanguage(language: string): boolean {
	return SHELL_LANGUAGES.has(language.toLowerCase());
}

/**
 * Whether a language can host a kernel or a console session, i.e. whether an
 * extension provides runtimes for it. Extension metadata answers this, so it
 * holds before the extension activates and discovers interpreters.
 */
export function hasRuntimeProvider(language: string, runtimeStartupService: IRuntimeStartupService): boolean {
	return runtimeStartupService.hasLanguageRuntimeProvider(language.toLowerCase());
}

/**
 * Whether a cell's language can be executed: a shell language (terminal) or a
 * language with runtimes (kernel or console). Diagram and markup languages such
 * as mermaid, dot, or plantuml match neither.
 */
export function isExecutableLanguage(language: string, runtimeStartupService: IRuntimeStartupService): boolean {
	return isShellLanguage(language) || hasRuntimeProvider(language, runtimeStartupService);
}
