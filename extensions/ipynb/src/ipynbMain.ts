/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { activate as keepNotebookModelStoreInSync } from './notebookModelStoreSync';
import { notebookImagePasteSetup } from './notebookImagePaste';
import { AttachmentCleaner } from './notebookAttachmentCleaner';
import { serializeNotebookToString } from './serializers';
import { defaultNotebookFormat } from './constants';

// --- Start Positron ---
import * as positron from 'positron';

// Module-level counter to maintain state across calls and prevent race conditions
const untitledNotebookCounter = new Map<string, number>();

/**
 * Optional cleanup function for the counter cache
 * Can be called periodically to prevent unbounded growth
 */
function cleanupCounterCache() {
	// Reset counters if they get too high or after certain time
	untitledNotebookCounter.clear();
}
// --- End Positron ---

// From {nbformat.INotebookMetadata} in @jupyterlab/coreutils
type NotebookMetadata = {
	kernelspec?: {
		name: string;
		display_name: string;
		[propName: string]: unknown;
	};
	language_info?: {
		name: string;
		codemirror_mode?: string | {};
		file_extension?: string;
		mimetype?: string;
		pygments_lexer?: string;
		[propName: string]: unknown;
	};
	orig_nbformat?: number;
	[propName: string]: unknown;
};

type OptionsWithCellContentMetadata = vscode.NotebookDocumentContentOptions & { cellContentMetadata: { attachments: boolean } };


export function activate(context: vscode.ExtensionContext, serializer: vscode.NotebookSerializer) {
	keepNotebookModelStoreInSync(context);
	const notebookSerializerOptions: OptionsWithCellContentMetadata = {
		transientOutputs: false,
		transientDocumentMetadata: {
			cells: true,
			indentAmount: true
		},
		transientCellMetadata: {
			breakpointMargin: true,
			id: false,
			metadata: false,
			attachments: false
		},
		cellContentMetadata: {
			attachments: true
		}
	};
	context.subscriptions.push(vscode.workspace.registerNotebookSerializer('jupyter-notebook', serializer, notebookSerializerOptions));

	const interactiveSerializeOptions: OptionsWithCellContentMetadata = {
		transientOutputs: false,
		transientCellMetadata: {
			breakpointMargin: true,
			id: false,
			metadata: false,
			attachments: false
		},
		cellContentMetadata: {
			attachments: true
		}
	};
	context.subscriptions.push(vscode.workspace.registerNotebookSerializer('interactive', serializer, interactiveSerializeOptions));

	vscode.languages.registerCodeLensProvider({ pattern: '**/*.ipynb' }, {
		provideCodeLenses: (document) => {
			if (
				document.uri.scheme === 'vscode-notebook-cell' ||
				document.uri.scheme === 'vscode-notebook-cell-metadata' ||
				document.uri.scheme === 'vscode-notebook-cell-output'
			) {
				return [];
			}
			const codelens = new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), { title: 'Open in Notebook Editor', command: 'ipynb.openIpynbInNotebookEditor', arguments: [document.uri] });
			return [codelens];
		}
	});

	// --- Start Positron ---

	/**
	 * Helper function to check if a notebook with the given URI already exists
	 */
	function notebookExistsWithUri(uri: vscode.Uri): boolean {
		return vscode.workspace.notebookDocuments.some(doc =>
			doc.uri.toString() === uri.toString()
		);
	}


	/**
	 * Generate the next available untitled notebook URI using VS Code's standard naming convention
	 */
	function getNextUntitledNotebookUri(): vscode.Uri {
		const basePattern = 'Untitled-{n}.ipynb';

		// Get or initialize counter
		let counter = untitledNotebookCounter.get(basePattern) || 1;

		let untitledUri: vscode.Uri;
		do {
			untitledUri = vscode.Uri.from({
				scheme: 'untitled',
				path: `Untitled-${counter}.ipynb`
			});
			counter++;
		} while (notebookExistsWithUri(untitledUri));

		// Store the next counter to reduce collision probability
		untitledNotebookCounter.set(basePattern, counter);

		return untitledUri;
	}

	context.subscriptions.push(vscode.commands.registerCommand('ipynb.newUntitledIpynb', async (languageId?: string) => {
		// Try to use Positron's foreground session's language, fall back to 'plaintext'.
		const language = languageId ?? (await positron.runtime.getForegroundSession())?.runtimeMetadata?.languageId ?? 'plaintext';

		// Create an untitled URI for the notebook using standard naming convention
		const untitledUri = getNextUntitledNotebookUri();

		// Use vscode.open command to trigger proper editor resolution
		// This will respect workbench.editorAssociations settings
		try {
			const editor = await vscode.commands.executeCommand('vscode.open', untitledUri, {
				preview: false,
				override: 'jupyter-notebook' // Specify the notebook view type
			}) as vscode.NotebookEditor | undefined;

			if (!editor || !editor.notebook) {
				throw new Error('Failed to open notebook editor via vscode.open command');
			}

			// After opening, initialize the notebook with default content
			const cell = new vscode.NotebookCellData(vscode.NotebookCellKind.Code, '', language);
			const edit = new vscode.WorkspaceEdit();
			edit.set(editor.notebook.uri, [
				vscode.NotebookEdit.insertCells(0, [cell]),
				vscode.NotebookEdit.updateNotebookMetadata({
					cells: [],
					metadata: {},
					nbformat: defaultNotebookFormat.major,
					nbformat_minor: defaultNotebookFormat.minor,
				})
			]);
			await vscode.workspace.applyEdit(edit);
		} catch (error) {
			// Use proper logging and show user notification for critical failures
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error('Failed to open notebook with editor associations:', errorMessage);

			// Show user notification about the fallback
			vscode.window.showWarningMessage(
				'Unable to open notebook with preferred editor. Using default editor instead.',
				'OK'
			);
			const cell = new vscode.NotebookCellData(vscode.NotebookCellKind.Code, '', language);
			const data = new vscode.NotebookData([cell]);
			data.metadata = {
				cells: [],
				metadata: {},
				nbformat: defaultNotebookFormat.major,
				nbformat_minor: defaultNotebookFormat.minor,
			};
			const doc = await vscode.workspace.openNotebookDocument('jupyter-notebook', data);
			await vscode.window.showNotebookDocument(doc);
		}
	}));
	// --- End Positron ---

	context.subscriptions.push(vscode.commands.registerCommand('ipynb.openIpynbInNotebookEditor', async (uri: vscode.Uri) => {
		if (vscode.window.activeTextEditor?.document.uri.toString() === uri.toString()) {
			await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
		}
		const document = await vscode.workspace.openNotebookDocument(uri);
		await vscode.window.showNotebookDocument(document);
	}));

	context.subscriptions.push(notebookImagePasteSetup());

	const enabled = vscode.workspace.getConfiguration('ipynb').get('pasteImagesAsAttachments.enabled', false);
	if (enabled) {
		const cleaner = new AttachmentCleaner();
		context.subscriptions.push(cleaner);
	}

	return {
		get dropCustomMetadata() {
			return true;
		},
		exportNotebook: (notebook: vscode.NotebookData): Promise<string> => {
			return Promise.resolve(serializeNotebookToString(notebook));
		},
		setNotebookMetadata: async (resource: vscode.Uri, metadata: Partial<NotebookMetadata>): Promise<boolean> => {
			const document = vscode.workspace.notebookDocuments.find(doc => doc.uri.toString() === resource.toString());
			if (!document) {
				return false;
			}

			const edit = new vscode.WorkspaceEdit();
			edit.set(resource, [vscode.NotebookEdit.updateNotebookMetadata({
				...document.metadata,
				metadata: {
					...(document.metadata.metadata ?? {}),
					...metadata
				} satisfies NotebookMetadata,
			})]);
			return vscode.workspace.applyEdit(edit);
		},
	};
}

export function deactivate() {
	// --- Start Positron ---
	// Clean up the counter cache when the extension is deactivated
	cleanupCounterCache();
	// --- End Positron ---
}
