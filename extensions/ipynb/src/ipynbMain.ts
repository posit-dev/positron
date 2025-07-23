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
	 * Check if Positron notebooks are configured as the default editor for .ipynb files
	 */
	function isPositronNotebookConfigured(): boolean {
		const config = vscode.workspace.getConfiguration();
		const editorAssociations = config.get<Record<string, string>>('workbench.editorAssociations') || {};
		return editorAssociations['*.ipynb'] === 'workbench.editor.positronNotebook';
	}


	/**
	 * Generate the next available untitled notebook URI using VS Code's standard naming convention
	 */
	function getNextUntitledNotebookUri(): vscode.Uri {
		let counter = 1;
		let uri: vscode.Uri;

		do {
			uri = vscode.Uri.from({
				scheme: 'untitled',
				path: `Untitled-${counter}.ipynb`
			});
			counter++;
		} while (notebookExistsWithUri(uri));

		return uri;
	}

	context.subscriptions.push(vscode.commands.registerCommand('ipynb.newUntitledIpynb', async (languageId?: string) => {
		// Try to use Positron's foreground session's language, fall back to 'plaintext'.
		const language = languageId ?? (await positron.runtime.getForegroundSession())?.runtimeMetadata?.languageId ?? 'plaintext';

		// Create an untitled URI for the notebook using standard naming convention
		const untitledUri = getNextUntitledNotebookUri();

		// Only use vscode.open command when Positron notebooks are configured
		// This ensures proper editor resolution respects workbench.editorAssociations
		if (isPositronNotebookConfigured()) {
			try {
				await vscode.commands.executeCommand('vscode.open', untitledUri, {
					preview: false,
					override: 'jupyter-notebook' // Specify the notebook view type
				});
				// Note that this will cause notebooks opened to have no cells unlike the original
				// approach prefilled with a code cell.
				return;
			} catch (error) {
				// Use proper logging and show user notification for critical failures
				const errorMessage = error instanceof Error ? error.message : String(error);
				console.error('Failed to open notebook with editor associations:', errorMessage);

				// Show user notification about the fallback
				vscode.window.showWarningMessage(
					'Unable to open notebook with preferred editor. Using default editor instead.',
					'OK'
				);
				// Fall through to default approach
			}
		}
		// Default approach: create notebook with a code cell
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

export function deactivate() { }
