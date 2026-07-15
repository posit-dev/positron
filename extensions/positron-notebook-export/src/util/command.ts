/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Disposable } from './disposable.js';

export abstract class Command extends Disposable {
	constructor(public readonly id: string) {
		super();

		this._register(vscode.commands.registerCommand(
			this.id,
			(args) => this.run(args)
		));
	}

	/**
	 * Run the command.
	 */
	abstract run(...args: unknown[]): Promise<void>;
}

export abstract class ResourceCommand extends Command {
	run(...args: unknown[]): Promise<void> {
		let resource: vscode.Uri | undefined;
		if (args[0] instanceof vscode.Uri) {
			resource = args[0];
		}
		return this.runWithResource(resource);
	}

	/**
	 * Run the command with an optional resource.
	 * @param resource The resource that the command was called with.
	 */
	abstract runWithResource(resource: vscode.Uri | undefined): Promise<void>;
}

export abstract class NotebookCommand extends ResourceCommand {
	runWithResource(resource: vscode.Uri | undefined): Promise<void> {
		let notebook: vscode.NotebookDocument | undefined;
		if (resource) {
			const resourceStr = resource.toString();
			notebook = vscode.workspace.notebookDocuments.find(doc => doc.uri.toString() === resourceStr);
		} else {
			notebook = vscode.window.activeNotebookEditor?.notebook;
		}
		return this.runWithNotebook(notebook);
	}

	/**
	 * Run the command with an optional notebook.
	 * @param notebook The notebook that the command was called with, or the active notebook.
	 */
	abstract runWithNotebook(notebook: vscode.NotebookDocument | undefined): Promise<void>;
}
