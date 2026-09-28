/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

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
 * Apply an interpreter definition to a kernel spec: its env wins over the
 * kernel's, and its startup script runs after any existing startup command.
 * Startup scripts need a POSIX shell, so they are skipped on Windows.
 */
export function applyInterpreterDefinition(kernel: JupyterKernelSpec, definition: InterpreterDefinition, platform: NodeJS.Platform): JupyterKernelSpec {
	const script = definition.startupScript && platform !== 'win32' ? `. "${definition.startupScript}"` : undefined;
	return {
		...kernel,
		env: { ...kernel.env, ...definition.env },
		startup_command: [kernel.startup_command, script].filter(Boolean).join(' && ') || undefined,
	};
}
