/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import { JupyterKernelSpec } from './positron-supervisor';

/**
 * An entry in the `interpreters.definitions` setting. Mirrors
 * IInterpreterDefinition in core (languageRuntime/common/interpreterDefinitions.ts).
 */
export interface InterpreterDefinition {
	language: string;
	path: string;
	label: string;
	env?: Record<string, string>;
	startupScript?: string;
}

/**
 * Find the definition a runtime variant was created from. Setting values are
 * not type-checked when read, so malformed values are ignored rather than
 * throwing.
 */
export function findInterpreterDefinition(definitions: unknown, languageId: string, label: string): InterpreterDefinition | undefined {
	if (!Array.isArray(definitions)) {
		return undefined;
	}
	return definitions.find((d): d is InterpreterDefinition =>
		!!d && typeof d === 'object' && d.language === languageId && d.label === label);
}

/**
 * Apply an interpreter definition to a kernel spec: its env wins over the
 * kernel's, and its startup script runs after any existing startup command.
 * The script path has a leading ~ expanded and is single-quoted for the shell.
 * Startup scripts need a POSIX shell, so they are skipped on Windows.
 */
export function applyInterpreterDefinition(kernel: JupyterKernelSpec, definition: InterpreterDefinition, platform: NodeJS.Platform): JupyterKernelSpec {
	const scriptPath = definition.startupScript?.replace(/^~(?=$|\/)/, os.homedir());
	const script = scriptPath && platform !== 'win32' ? `. '${scriptPath.replace(/'/g, `'\\''`)}'` : undefined;
	return {
		...kernel,
		env: { ...kernel.env, ...definition.env },
		startup_command: [kernel.startup_command, script].filter(Boolean).join(' && ') || undefined,
	};
}
