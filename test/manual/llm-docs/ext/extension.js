/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Throwaway extension for exercising positron.docs.getLocalDocs() by hand.
// Reports timing as well as the result, since the 10s bounded wait is one of
// the things worth checking and it is invisible in the return value.

const vscode = require('vscode');
const positron = require('positron');

/** @param {vscode.ExtensionContext} context */
function activate(context) {
	const out = vscode.window.createOutputChannel('Docs QA');
	context.subscriptions.push(out);

	const call = async (label) => {
		const started = Date.now();
		try {
			const docs = await positron.docs.getLocalDocs();
			const elapsed = Date.now() - started;
			out.appendLine(`${label}  ${elapsed}ms  ${docs ? JSON.stringify(docs, null, 2) : 'undefined'}`);
			return { docs, elapsed };
		} catch (error) {
			out.appendLine(`${label}  threw: ${error}`);
			throw error;
		}
	};

	context.subscriptions.push(vscode.commands.registerCommand('docsQa.getLocalDocs', async () => {
		out.show(true);
		const { docs, elapsed } = await call('getLocalDocs');
		// `resolution` is deliberately not on the public API - read it from
		// state.json or the [llm-docs] log when you need it.
		vscode.window.showInformationMessage(
			docs
				? `${elapsed}ms - ${docs.version} (exact: ${docs.isExactMatch}, profile: ${docs.profile})`
				: `${elapsed}ms - undefined (see Docs QA output)`);
	}));

	// Both calls start before either is awaited, which is what makes this a
	// single-flight check rather than two sequential calls.
	context.subscriptions.push(vscode.commands.registerCommand('docsQa.getLocalDocsTwice', async () => {
		out.show(true);
		const [a, b] = await Promise.all([call('concurrent A'), call('concurrent B')]);
		vscode.window.showInformationMessage(
			`A: ${a.docs?.version ?? 'undefined'} (${a.elapsed}ms), B: ${b.docs?.version ?? 'undefined'} (${b.elapsed}ms). `
			+ `Check the fixture server log for exactly one GET.`);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('docsQa.readIndex', async () => {
		const docs = await positron.docs.getLocalDocs();
		if (!docs) {
			vscode.window.showWarningMessage('No local docs - nothing to open.');
			return;
		}
		const index = vscode.Uri.file(`${docs.path}/llms.txt`);
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(index));
	}));
}

function deactivate() { }

module.exports = { activate, deactivate };
