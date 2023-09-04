/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';

/**
 * This set of type definitions defines the interfaces used by the Positron
 * Jupyter Adapter extension.
 */

/**
 * Represents a registered Jupyter Kernel. These types are defined in the
 * Jupyter documentation at:
 *
 * https://jupyter-client.readthedocs.io/en/stable/kernels.html#kernel-specs
 */
export interface JupyterKernelSpec {
	/** Command used to start the kernel and an array of command line arguments */
	argv: Array<string>;

	/** The kernel's display name */
	display_name: string;  // eslint-disable-line

	/** The language the kernel executes */
	language: string;

	/** Interrupt mode (signal or message) */
	interrupt_mode?: 'signal' | 'message'; // eslint-disable-line

	/** Environment variables to set when starting the kernel */
	env?: { [key: string]: string };
}

/**
 * A language runtime that wraps a Jupyter kernel.
 */
export interface JupyterLanguageRuntime extends positron.LanguageRuntime {
	/**
	 * Convenience method for starting the Positron LSP server, if the
	 * language runtime supports it.
	 *
	 * @param clientAddress The address of the client that will connect to the
	 *  language server.
	 */
	startPositronLsp(clientAddress: string): Thenable<void>;

	/**
	 * Convenience method for starting the Positron DAP server, if the
	 * language runtime supports it.
	 *
	 * @param serverPort The port on which to bind locally.
	 * @param debugType Passed as `vscode.DebugConfiguration.type`.
	 * @param debugName Passed as `vscode.DebugConfiguration.name`.
	 */
	startPositronDap(
		serverPort: number,
		debugType: string,
		debugName: string,
	): Thenable<void>;

	/**
	 * Method for emitting a message to the language server's Jupyter output
	 * channel.
	 *
	 * @param message A message to emit to the Jupyter log.
	 */
	emitJupyterLog(message: string): void;
}

/**
 * The Jupyter Adapter API as exposed by the Jupyter Adapter extension.
 */
export interface JupyterAdapterApi extends vscode.Disposable {

	/**
	 * Create an adapter for a Jupyter-compatible kernel.
	 *
	 * @param kernel A Jupyter kernel spec containing the information needed to
	 *   start the kernel.
	 * @param metadata The metadata for the language runtime to be wrapped by the
	 *   adapter.
	 * @param extra Optional implementations for extra functionality.
	 * @returns A LanguageRuntimeAdapter that wraps the kernel.
	 */
	adaptKernel(
		kernel: JupyterKernelSpec,
		metadata: positron.LanguageRuntimeMetadata,
		dynState: positron.LanguageRuntimeDynState,
		extra?: JupyterKernelExtra,
	): JupyterLanguageRuntime;

	/**
	 * Finds an available TCP port for a server
	 *
	 * @param excluding A list of ports to exclude from the search
	 * @param maxTries The maximum number of attempts
	 * @returns An available TCP port
	 */
	findAvailablePort(excluding: Array<number>, maxTries: number): Promise<number>;
}

/** Specific functionality implemented by runtimes */
export interface JupyterKernelExtra {
	attachOnStartup?: {
		init: (args: Array<String>) => void;
		attach: () => Promise<void>;
	};
	sleepOnStartup?: {
		init: (args: Array<String>, delay: number) => void;
	};
}
