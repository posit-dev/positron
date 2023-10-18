/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { initializeLogging, trace } from './logging';
import { NotebookController } from './notebookController';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	initializeLogging();

	const knownLanguageIds = new Set<string>();
	// Ensure that a notebook controller is registered for a given language.
	const ensureNotebookController = (languageId: string) => {
		if (!knownLanguageIds.has(languageId)) {
			const controller = new NotebookController(languageId);
			knownLanguageIds.add(languageId);
			context.subscriptions.push(controller);
			trace(`Registered notebook controller for language: ${languageId}`);
		}
	};

	// Register notebook controllers for newly registered runtimes.
	context.subscriptions.push(positron.runtime.onDidRegisterRuntime((runtime) => {
		ensureNotebookController(runtime.metadata.languageId);
	}));

	// Register notebook controllers for existing runtimes.
	for (const runtime of await positron.runtime.getRegisteredRuntimes()) {
		ensureNotebookController(runtime.metadata.languageId);
	}
}
