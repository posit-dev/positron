/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/



import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import { readFile } from 'fs';
import { readFile as fsReadFile } from 'fs/promises';

// Make sure this matches the error message type defined where used
// (src/vs/workbench/contrib/positronNotebook/browser/notebookCells/DeferredImage.tsx)
type CoversionErrorMsg = {
	status: 'error';
	message: string;
};

/** Map from session key -> Terminal */
const marimoSessions = new Map<string, vscode.Terminal>();

let marimoOutput: vscode.OutputChannel | undefined;

function findMarimoBinary(): string | null {
	try {
		if (process.platform === 'win32') {
			const res = cp.spawnSync('where', ['marimo'], { encoding: 'utf8' });
			if (res.status === 0 && res.stdout) {
				const p = res.stdout.split(/\r?\n/)[0].trim();
				return p || null;
			}
			return null;
		} else {
			const res = cp.spawnSync('which', ['marimo'], { encoding: 'utf8' });
			if (res.status === 0 && res.stdout) {
				const p = res.stdout.split(/\r?\n/)[0].trim();
				return p || null;
			}
			return null;
		}
	} catch (err) {
		return null;
	}
}

async function getPositronRunAppApi(): Promise<any> {
	const runAppExt = vscode.extensions.getExtension<any>('positron.positron-run-app');
	if (!runAppExt) {
		throw new Error('positron.positron-run-app extension not found');
	}
	return runAppExt.activate();
}

function quoteShellArg(arg: string): string {
	if (process.platform === 'win32') {
		return `"${arg.replace(/"/g, '\\"')}"`;
	}
	const escaped = arg.replace(/'/g, `'\\''`);
	return `'${escaped}'`;
}

function buildMarimoCommand(kind: MarimoSessionKind, filePath: string, marimoPath: string): string {
	const config = vscode.workspace.getConfiguration();
	let viewerArgs = config.get<string[]>('positron.marimo.viewerArgs') || [];
	const runArgs = config.get<string[]>('positron.marimo.runArgs') || [];

	// TO-BE-DELETED_AFTER_CORRECT_IMPL: Crucial sanitization step: Ensure viewer opens without a token by default

	//if (kind === 'edit' && !viewerArgs.includes('--no-token')) {
	//	viewerArgs = [...viewerArgs, '--no-token'];
	//}

	// Crucial sanitization step: Ensure Marimo opens with --no-token and --headless flags by default
	if (kind === 'edit') {
		if (!viewerArgs.includes('--no-token')) {
			viewerArgs = [...viewerArgs, '--no-token'];
		}
		if (!viewerArgs.includes('--headless')) {
			viewerArgs = [...viewerArgs, '--headless'];
		}
	}
	const args = kind === 'edit' ? viewerArgs : runArgs;

	const quotedPath = quoteShellArg(filePath);
	const quotedMarimo = quoteShellArg(marimoPath);

	// Sanitize args: only allow simple flags/values (no newline/semicolons)
	const safeArgs = args.map(a => String(a).replace(/\r|\n/g, ''));
	const quotedArgs = safeArgs.map(a => quoteShellArg(a)).join(' ');

	return kind === 'edit'
		? `${quotedMarimo} edit ${quotedArgs ? quotedArgs + ' ' : ''}${quotedPath}`
		: `${quotedMarimo} run ${quotedArgs ? quotedArgs + ' ' : ''}${quotedPath}`;
}

/**
 * Map image file extension to MIME type.
 */
const mimeTypeMap: Record<string, string> = {
	png: 'image/png',
	apng: 'image/apng',
	avif: 'image/avif',
	ico: 'image/vnd.microsoft.icon',
	jpeg: 'image/jpeg',
	jpg: 'image/jpeg',
	gif: 'image/gif',
	bmp: 'image/bmp',
	webp: 'image/webp',
	svg: 'image/svg+xml',
	tiff: 'image/tiff',
	tif: 'image/tiff',
};

type MarimoSessionKind = 'edit' | 'run';

export function activate(context: vscode.ExtensionContext) {
	marimoOutput = vscode.window.createOutputChannel('Marimo');
	context.subscriptions.push(marimoOutput);
	// Command that converts an image from the local file-system to a base64 string.
	context.subscriptions.push(
		vscode.commands.registerCommand(
			'positronNotebookHelpers.convertImageToBase64',
			async (imageSrc: string, baseLoc: string) => new Promise<string | CoversionErrorMsg>((resolve) => {
				const fullImagePath = path.join(baseLoc, imageSrc);
				const fileExtension = path.extname(imageSrc).slice(1);
				const mimeType = mimeTypeMap[fileExtension.toLowerCase()];
				if (!mimeType) {
					resolve({
						status: 'error',
						message: `Unsupported file type: "${fileExtension}."`,
					});
					return;
				}
				try {
					readFile(fullImagePath, (err: NodeJS.ErrnoException | null, data?: Buffer) => {
						if (err) {
							resolve({
								status: 'error',
								message: err.message,
							});
						} else if (!data) {
							resolve({
								status: 'error',
								message: `No data found in file "${fullImagePath}."`,
							});
						} else {
							resolve(`data:${mimeType};base64,${data.toString('base64')}`);
						}
					});
				} catch (e) {
					resolve({ status: 'error', message: e instanceof Error ? e.message : 'Unknown error' });
				}
			})
		)
	);

	// Keep marimoSessions map up-to-date when terminals close.
	const removeClosedTerminal = vscode.window.onDidCloseTerminal((terminal) => {
		for (const [key, tracked] of marimoSessions.entries()) {
			if (tracked === terminal) {
				marimoSessions.delete(key);
			}
		}
	});
	context.subscriptions.push(removeClosedTerminal);

	context.subscriptions.push(
		vscode.commands.registerCommand('positron.marimo.openInViewer', () => startMarimoSession(context, marimoSessions, 'edit'))
	);
	// Run does NOT currently work, because (I believe) it'd require marimo engine for it to work.
	context.subscriptions.push(
		vscode.commands.registerCommand('positron.marimo.run', () => startMarimoSession(context, marimoSessions, 'run'))
	);
	// Stop implementation: we could borrow from the 'Stop' button in the Viewer pane for other apps.
	context.subscriptions.push(
		vscode.commands.registerCommand('positron.marimo.stop', () => stopMarimoSession(marimoSessions))
	);

	// We prefer to open localhost URLs in the Viewer by invoking the
	// contributed opener 'positron.viewer' via `openExternal` when possible.
	// NOTE: This is not working at the current state. It opens in the browser by default.
	// However, if user Cmd+Click link and then press 'Open in Viewer' pane, then it is possible to open it.


	// Provide CodeLens actions when a Python file imports marimo
	class MarimoCodeLensProvider implements vscode.CodeLensProvider {
		public provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
			if (document.languageId !== 'python') {
				return [];
			}
			const text = document.getText();
			if (!isLikelyMarimoNotebook(text)) {
				return [];
			}
			const top = new vscode.Range(0, 0, 0, 0);

			// The implementation of this would need additional work and discussion.
			// It requires passing the local host URI without the token, so that Viewer pane can open it.
			// My intention would be for the Viewer pane to open this by default.
			const openCmd: vscode.Command = {
				title: 'Open in Marimo Viewer',
				command: 'positron.marimo.openInViewer',
				arguments: [document.uri],
			};

			// Run with Marimo is NOT intended to be functional now, because it'd require hooking up the Marimo engine behind the process.
			// Out of Scope for Phase 1
			const runCmd: vscode.Command = {
				title: 'Run with Marimo',
				command: 'positron.marimo.run',
				arguments: [document.uri],
			};
			return [new vscode.CodeLens(top, openCmd), new vscode.CodeLens(top, runCmd)];
		}
	}

	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider({ language: 'python', scheme: 'file' }, new MarimoCodeLensProvider())
	);
}

export function deactivate() {
	for (const term of marimoSessions.values()) {
		try { term.dispose(); } catch (e) { }
	}
	marimoSessions.clear();
}

async function startMarimoSession(
	context: vscode.ExtensionContext,
	marimoSessions: Map<string, vscode.Terminal>,
	kind: MarimoSessionKind
) {
	let uri: vscode.Uri | undefined;
	let text: string | undefined;
	let contentSource: 'disk' | 'unsaved' = 'disk';

	// if (arguments.length >= 4 && arguments[3]) { /* guard for unexpected calls */ }

	// If caller passed a URI (via CodeLens or command argument), prefer it.
	const maybeUri = (arguments && arguments[0]) as vscode.Uri | undefined;
	if (maybeUri && maybeUri.scheme === 'file') {
		uri = maybeUri;
		try {
			const doc = await vscode.workspace.openTextDocument(uri);
			text = doc.getText();
			contentSource = doc.isDirty ? 'unsaved' : 'disk';
		} catch (e) {
			try {
				const bytes = await fsReadFile(uri.fsPath);
				text = bytes.toString();
				contentSource = 'disk';
			} catch (err: any) {
				void vscode.window.showErrorMessage(`Failed to read file: ${err?.message || String(err)}`);
				return;
			}
		}
	} else {
		const target = await resolveMarimoTarget();
		if (!target) {
			return;
		}
		uri = target.uri;
		text = target.text;
		contentSource = target.contentSource;
	}
	if (!isLikelyMarimoNotebook(text)) {
		void vscode.window.showErrorMessage(
			'This file does not look like a Marimo notebook (no "import marimo" found).'
		);
		return;
	}

	const marimoPath = findMarimoBinary();
	if (!marimoPath) {
		void vscode.window.showErrorMessage('Marimo CLI not found. Please install Marimo and ensure it is on your PATH.');

		// Log to output channel for diagnostics
		try { marimoOutput?.appendLine('Marimo CLI not found on PATH'); } catch (e) { }
		return;
	}

	const sessionKey = `${kind}:${uri.toString()}`;
	const existing = marimoSessions.get(sessionKey);
	if (existing) {
		existing.show(true);
		void vscode.window.showInformationMessage('Using existing Marimo session in the terminal.');
		return;
	}

	const terminalName = `marimo ${kind}: ${path.basename(uri.fsPath)}`;
	const terminal = vscode.window.createTerminal({
		name: terminalName,
		location: vscode.TerminalLocation.Panel,
	});
	marimoSessions.set(sessionKey, terminal);
	context.subscriptions.push(terminal);

	const command = buildMarimoCommand(kind, uri.fsPath, marimoPath);
	// Log the command we are running to the output channel
	try { marimoOutput?.appendLine(`> ${command}`); } catch (e) { }
	terminal.sendText(command, true);
	terminal.show(true);

	// Viewer mode is terminal-driven (marimo edit opens a viewer).

	const hint =
		kind === 'edit'
			? 'Opening Marimo viewer (no code executed). Use the terminal to stop it.'
			: 'Running Marimo notebook. Use the terminal to stop it.';
	void vscode.window.showInformationMessage(hint);

	// If the document was unsaved, remind the user they are running the in-memory content.
	if (contentSource === 'unsaved') {
		void vscode.window.showWarningMessage(
			'You ran an unsaved buffer. Save the file to keep Marimo in sync with future edits.'
		);
	}
}

async function stopMarimoSession(marimoSessions: Map<string, vscode.Terminal>) {
	if (marimoSessions.size === 0) {
		void vscode.window.showInformationMessage('No Marimo sessions are currently running.');
		return;
	}

	const picks = Array.from(marimoSessions.entries()).map(([key, terminal]) => ({
		label: terminal.name || key,
		description: key.split(':')[0] === 'edit' ? 'viewer' : 'run',
		target: terminal,
		key,
	}));

	const choice = await vscode.window.showQuickPick(picks, {
		placeHolder: 'Select a Marimo session to stop',
	});

	if (choice?.target) {
		choice.target.dispose();
		marimoSessions.delete(choice.key);
		void vscode.window.showInformationMessage(`Stopped ${choice.description} session "${choice.label}".`);
	}
}

function isLikelyMarimoNotebook(text: string): boolean {
	const importRegex = /\bimport\s+marimo\b/;
	const fromImportRegex = /\bfrom\s+marimo\s+import\b/;
	return importRegex.test(text) || fromImportRegex.test(text);
}

async function resolveMarimoTarget(): Promise<{ uri: vscode.Uri; text: string; contentSource: 'disk' | 'unsaved' } | undefined> {
	const activeEditor = vscode.window.activeTextEditor;
	if (activeEditor?.document.languageId === 'python' && activeEditor.document.uri.scheme === 'file') {
		return {
			uri: activeEditor.document.uri,
			text: activeEditor.document.getText(),
			contentSource: activeEditor.document.isDirty ? 'unsaved' : 'disk',
		};
	}

	const picked = await vscode.window.showOpenDialog({
		canSelectFiles: true,
		canSelectMany: false,
		canSelectFolders: false,
		filters: { Python: ['py'] },
	});

	if (!picked || picked.length === 0) {
		return undefined;
	}

	const uri = picked[0];
	if (uri.scheme !== 'file') {
		void vscode.window.showErrorMessage('Only local Python files are supported for Marimo.');
		return undefined;
	}

	try {
		const bytes = await fsReadFile(uri.fsPath);
		return { uri, text: bytes.toString(), contentSource: 'disk' };
	} catch (e: any) {
		void vscode.window.showErrorMessage(`Failed to read file: ${e?.message || String(e)}`);
		return undefined;
	}
}
