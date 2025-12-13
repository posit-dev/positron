/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { JuliaInstallation } from './julia-installation';
import { JupyterKernelSpec } from './positron-supervisor';
import { LOGGER } from './extension';

/**
 * Creates a Jupyter kernel spec for launching Julia with IJulia.
 *
 * @param installation The Julia installation to create a kernel spec for.
 * @returns A JupyterKernelSpec for the Julia installation.
 */
export function createJuliaKernelSpec(installation: JuliaInstallation): JupyterKernelSpec {
	// Get the log level from configuration
	const config = vscode.workspace.getConfiguration('positron.julia.kernel');
	const logLevel = config.get<string>('logLevel', 'warn');

	// Build the kernel arguments
	// The {connection_file} placeholder is replaced by the supervisor with the actual connection file path
	// Note: We match the standard IJulia kernel.json format closely for compatibility
	const argv = [
		installation.binpath,
		'-i',  // Interactive mode
		'--color=yes',  // Enable colored output
		'-e',
		getKernelStartupCode(),
		'{connection_file}',
	];

	// Build environment variables
	const env: NodeJS.ProcessEnv = {
		// Julia-specific environment variables
		JULIA_NUM_THREADS: process.env.JULIA_NUM_THREADS || 'auto',

		// Positron-specific environment variables
		POSITRON: '1',
		POSITRON_VERSION: vscode.version,
		POSITRON_MODE: 'console',

		// Log level for debugging
		JULIA_DEBUG: logLevel === 'trace' || logLevel === 'debug' ? 'all' : '',
	};

	// Add any user-configured environment variables
	const userEnv = config.get<Record<string, string>>('env', {});
	Object.assign(env, userEnv);

	LOGGER.debug(`Creating kernel spec for Julia ${installation.version}`);
	LOGGER.debug(`  argv: ${argv.join(' ')}`);

	return {
		argv,
		display_name: `Julia ${installation.version}`,
		language: 'julia',
		interrupt_mode: 'signal',
		env,
		kernel_protocol_version: '5.3',  // IJulia supports Jupyter protocol 5.3
	};
}

/**
 * Returns the Julia code that starts the IJulia kernel.
 *
 * This code:
 * 1. Loads IJulia (installing it if necessary)
 * 2. Starts the kernel with IJulia.run_kernel()
 *
 * The connection file is passed as a command line argument and is
 * automatically read by IJulia.run_kernel().
 *
 * TODO: In the future, this will also load PositronJulia.jl for
 * custom comms support (variables, plots, data explorer, etc.)
 */
function getKernelStartupCode(): string {
	// Match the standard IJulia kernel startup command exactly
	// The connection file is passed as the first argument after -e code
	return 'import IJulia; IJulia.run_kernel()';
}
