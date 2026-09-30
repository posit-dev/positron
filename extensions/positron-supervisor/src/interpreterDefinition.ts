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
	return definitions.find((definition): definition is InterpreterDefinition => {
		if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
			return false;
		}
		const candidate = definition as Record<string, unknown>;
		return candidate.language === languageId &&
			typeof candidate.path === 'string' &&
			candidate.path.length > 0 &&
			candidate.label === label &&
			(candidate.env === undefined || isStringRecord(candidate.env)) &&
			(candidate.startupScript === undefined || typeof candidate.startupScript === 'string');
	});
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return !!value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(v => typeof v === 'string');
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
