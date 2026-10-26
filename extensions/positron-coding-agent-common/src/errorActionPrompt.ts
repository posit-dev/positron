/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'node:path';
import type * as positron from 'positron';
import type * as vscode from 'vscode';
import { ErrorPromptSource, getErrorPrompt, PromptDocument, PromptL10n } from './errorPrompt';

/** The documents a prompt can name; `vscode.workspace` outside of tests. */
export type PromptWorkspace = Pick<typeof vscode.workspace, 'notebookDocuments' | 'textDocuments'>;

/**
 * Build the prompt for an error action, for an agent that can't see Positron.
 * @param workspace `vscode.workspace`, to read the document's state now.
 * @param l10n `vscode.l10n`, to localize the prompt.
 */
export function getErrorActionPrompt(action: positron.ai.ErrorAction, context: positron.ai.ErrorActionContext, workspace: PromptWorkspace, l10n: PromptL10n): string {
	return getErrorPrompt(action, getPromptSource(context, workspace), context.error, l10n);
}

/** Name where the error came from, resolving the document's state now. */
function getPromptSource(context: positron.ai.ErrorActionContext, workspace: PromptWorkspace): ErrorPromptSource {
	switch (context.kind) {
		case 'console':
			return { kind: 'console', sessionName: context.sessionName, languageId: context.languageId, code: context.code };
		case 'notebook':
			return { kind: 'notebook', document: getPromptDocument(context.uri, 'notebook', workspace), cell: context.cell };
		case 'quarto':
			return { kind: 'quarto', document: getPromptDocument(context.uri, 'text', workspace), cell: context.cell };
	}
}

/**
 * Name a notebook or Quarto document by its absolute path, since Positron
 * doesn't know the agent's working directory, with no `~`, which only shells
 * expand. An untitled document is named by its title instead.
 */
function getPromptDocument(uri: vscode.Uri, kind: 'notebook' | 'text', workspace: PromptWorkspace): PromptDocument {
	const uriString = uri.toString();
	const document = kind === 'notebook'
		? workspace.notebookDocuments.find(document => document.uri.toString() === uriString)
		: workspace.textDocuments.find(document => document.uri.toString() === uriString);
	const isUntitled = document?.isUntitled ?? uri.scheme === 'untitled';
	return {
		name: isUntitled ? path.posix.basename(uri.path) : uri.scheme === 'file' ? uri.fsPath : uri.toString(),
		isUntitled,
		isDirty: document?.isDirty === true,
	};
}
