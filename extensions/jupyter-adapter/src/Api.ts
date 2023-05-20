/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

import { JupyterKernelSpec } from './JupyterKernelSpec';
import { LanguageRuntimeAdapter } from './LanguageRuntimeAdapter';

export class Api implements vscode.Disposable {
	constructor(private readonly _context: vscode.ExtensionContext,
		private readonly _channel: vscode.OutputChannel) {
	}

	/**
	 * Create an adapter for a Jupyter-compatible kernel.
	 *
	 * @param kernel A Jupyter kernel spec containing the information needed to start the kernel.
	 * @param languageId The language ID for the language this adapter supports; must be one of
	 *    VS Code's built-in language IDs or a language ID registered by another extension.
	 * @param languageVersion The version of the language interpreter.
	 * @param kernelVersion The version of the kernel itself.
	 * @param base64EncodedIconSvg The Base64-encoded icon SVG of the language interpreter
	 * @param inputPrompt The input prompt to use for the kernel, e.g. ">" or ">>>"
	 * @param continuationPrompt The continuation prompt to use for the kernel, e.g. "+" or "..."
	 * @param startupBehavior Whether the runtime should be started automatically
	 * @param lsp An optional function that starts an LSP server, given the port
	 *   on which the kernel is listening, and returns a promise that resolves
	 *   when the server is ready.
	 * @returns A LanguageRuntimeAdapter that wraps the kernel.
	 */
	adaptKernel(kernel: JupyterKernelSpec,
		languageId: string,
		languageVersion: string,
		kernelVersion: string,
		base64EncodedIconSvg: string | undefined,
		inputPrompt: string,
		continuationPrompt: string,
		startupBehavior: positron.LanguageRuntimeStartupBehavior = positron.LanguageRuntimeStartupBehavior.Implicit,
		lsp?: (port: number) => Promise<void>
	): positron.LanguageRuntime {

		return new LanguageRuntimeAdapter(
			this._context,
			kernel,
			languageId,
			languageVersion,
			kernelVersion,
			base64EncodedIconSvg,
			inputPrompt,
			continuationPrompt,
			this._channel,
			startupBehavior,
			lsp
		);
	}

	dispose() {
	}
}
