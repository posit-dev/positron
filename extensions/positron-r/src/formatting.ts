/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { RRuntime, lastRuntimePath } from './runtime';
import { getRunningRRuntime } from './provider';
import { timeout } from './util';
import { randomUUID } from 'crypto';

export async function registerFormatter(context: vscode.ExtensionContext, runtimes: Map<string, RRuntime>) {

	const rDocumentSelector = { scheme: 'file', language: 'r' } as vscode.DocumentSelector;

	context.subscriptions.push(
		vscode.languages.registerDocumentFormattingEditProvider(
			rDocumentSelector,
			new FormatterProvider(runtimes)
		)
	);
}

class FormatterProvider implements vscode.DocumentFormattingEditProvider {
	constructor(public runtimes: Map<string, RRuntime>) { }

	public provideDocumentFormattingEdits(document: vscode.TextDocument):
		vscode.ProviderResult<vscode.TextEdit[]> {
		return this.formatDocument(document, this.runtimes);
	}

	private async formatDocument(
		document: vscode.TextDocument,
		runtimes: Map<string, RRuntime>
	): Promise<vscode.TextEdit[]> {
		if (!lastRuntimePath) {
			throw new Error(`No running R runtime to provide R package tasks.`);
		}

		const runtime = await getRunningRRuntime(runtimes);
		const id = randomUUID();

		// We can only use styler on files right now, so write the document to a temp file
		const originalSource = document.getText();
		const tempdir = os.tmpdir();
		const fileToStyle = path.basename(document.fileName);
		const stylerFile = path.join(tempdir, `styler-${fileToStyle}`);
		fs.writeFileSync(stylerFile, originalSource);

		// A promise that resolves when the runtime is idle:
		const promise = new Promise<void>(resolve => {
			const disp = runtime.onDidReceiveRuntimeMessage(runtimeMessage => {
				if (runtimeMessage.parent_id === id &&
					runtimeMessage.type === positron.LanguageRuntimeMessageType.State) {
					const runtimeMessageState = runtimeMessage as positron.LanguageRuntimeState;
					if (runtimeMessageState.state === positron.RuntimeOnlineState.Idle) {
						resolve();
						disp.dispose();
					}
				}
			});
		});

		// Actual formatting is done by styler
		runtime.execute(
			`styler::style_file('${stylerFile}')`,
			id,
			positron.RuntimeCodeExecutionMode.Silent,
			positron.RuntimeErrorBehavior.Continue);

		// Wait for the the runtime to be idle, or for the timeout:
		await Promise.race([promise, timeout(2e4, 'waiting for formatting')]);

		// Read the now formatted file and then delete it
		const formattedSource = fs.readFileSync(stylerFile).toString();
		fs.promises.unlink(stylerFile);

		// Return the formatted source
		const fileStart = new vscode.Position(0, 0);
		const fileEnd = document.lineAt(document.lineCount - 1).range.end;
		return [new vscode.TextEdit(new vscode.Range(fileStart, fileEnd), formattedSource)];
	}
}
