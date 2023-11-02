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
		return formatDocument(document, this.runtimes);
	}

}

async function formatDocument(document: vscode.TextDocument, runtimes: Map<string, RRuntime>): Promise<vscode.TextEdit[]> {
	if (!lastRuntimePath) {
		throw new Error(`No running R runtime to provide R package tasks.`);
	}

	const runtime = await getRunningRRuntime(runtimes);

	// We can only use styler on files right now, so write the document to a temp file
	const source = document.getText();
	let formattedSource = '';
	const tempdir = os.tmpdir();
	const fileToStyle = path.basename(document.fileName);
	const stylerFile = path.join(tempdir, `styler-${fileToStyle}`);
	fs.writeFileSync(stylerFile, JSON.stringify(source));


	const id = randomUUID();
	// Actual formatting is done by styler
	runtime.execute(`styler::style_file('${stylerFile}')`,
		id,
		positron.RuntimeCodeExecutionMode.Silent,
		positron.RuntimeErrorBehavior.Continue);
	const disp1 = runtime.onDidReceiveRuntimeMessage(runtimeMessage => {
		if (runtimeMessage.parent_id === id &&
			runtimeMessage.type === positron.LanguageRuntimeMessageType.State) {
			const runtimeMessageState = runtimeMessage as positron.LanguageRuntimeState;
			if (runtimeMessageState.state === positron.RuntimeOnlineState.Idle) {
				// Read the now formatted file and then delete it
				formattedSource = fs.readFileSync(stylerFile).toString();
				fs.promises.unlink(stylerFile);
				disp1.dispose();
			}
		}
	});

	return [vscode.TextEdit.insert(document.lineAt(0).range.start, formattedSource)];

}
