/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Throwaway extension for exercising positron.docs.getLocalDocs() by hand.
// Reports timing as well as the result, since the 10s bounded wait is one of
// the things worth checking and it is invisible in the return value.

const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const positron = require('positron');

const AI_ENABLED_KEY = 'ai.enabled';
// The cache lives beside globalStorage, so the extension can find it from its
// own storage path without hard-coding a user-data-dir.
const CACHE_DIR_NAME = 'positron-llm-docs';
const FIXTURE_URL = process.env.POSITRON_LLMS_DOCS_URL || 'http://127.0.0.1:8099';
// The ai.enabled listener in the extension host reacts to the config change
// asynchronously. Without a pause, getLocalDocs() can beat invalidate() to the
// cache and read the memo the flip was meant to clear.
const FLIP_SETTLE_MS = 500;

/** @param {vscode.ExtensionContext} context */
function activate(context) {
	const out = vscode.window.createOutputChannel('Docs QA');
	context.subscriptions.push(out);

	// <user-data-dir>/User/globalStorage/<ext-id> -> <user-data-dir>/User/<cache>
	const cacheDir = path.join(path.dirname(path.dirname(context.globalStorageUri.fsPath)), CACHE_DIR_NAME);

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

	/**
	 * One command for a whole scenario: switch the fixture, clear everything that
	 * would let a stale result through, trigger a fetch, and report.
	 *
	 * Clearing is the part that is easy to get wrong by hand. Deleting the cache
	 * directory is not enough on its own - PositronDocsCache memoizes the first
	 * completed attempt per window, and only invalidate() clears that. The one
	 * public route to invalidate() is flipping ai.enabled false-to-true, so that
	 * is what this does.
	 */
	context.subscriptions.push(vscode.commands.registerCommand('docsQa.runScenario', async () => {
		let available;
		try {
			available = await ctl('/_ctl/scenarios', 'json');
		} catch (error) {
			// A 404 means something is listening but does not know this route, which
			// in practice means an older or copied-out server.mjs. Worth separating
			// from "nothing is listening": only the latter can arm the throttle, and
			// only the former is fixed by restarting the right file.
			vscode.window.showErrorMessage(String(error).includes('404')
				? `The fixture CDN at ${FIXTURE_URL} has no /_ctl/scenarios route, so it is not `
				+ `this repo's server.mjs. Restart it from the worktree: `
				+ `"node test/manual/llm-docs/server.mjs".`
				: `Cannot reach the fixture CDN at ${FIXTURE_URL}: ${error}. Start it with `
				+ `"node test/manual/llm-docs/server.mjs" - and note that a failed docs fetch `
				+ `arms the one-hour throttle, so delete the cache directory if one landed.`);
			return;
		}

		const picked = await vscode.window.showQuickPick(
			available.map(s => ({
				label: s.name,
				description: s.expect,
				detail: s.current ? 'currently selected on the fixture server' : undefined,
			})),
			{ title: 'Docs QA: run a scenario', placeHolder: 'Resets the cache and the memo, then calls getLocalDocs()' });
		if (!picked) {
			return;
		}

		out.show(true);
		out.appendLine(`\n${'='.repeat(72)}\nscenario  ${picked.label}\nexpect    ${picked.description}`);

		await ctl(`/_ctl/scenario/${picked.label}`);
		// Order matters: clear the disk before the log, so the log holds only the
		// requests this run provokes.
		await fs.promises.rm(cacheDir, { recursive: true, force: true });
		out.appendLine(`cleared   ${cacheDir}`);
		await ctl('/_ctl/reset');

		await flipAiEnabled();
		out.appendLine(`memo      invalidated via an ${AI_ENABLED_KEY} off/on flip`);

		const { docs, elapsed } = await call('result   ');
		out.appendLine(`disk      ${(await readdir(cacheDir)).join(', ') || '(nothing)'}`);
		out.appendLine(`state     ${await readState(cacheDir)}`);
		out.appendLine(`server    ${(await ctl('/_ctl/log')).trim().split('\n').join('\n          ')}`);
		out.appendLine(`\nNow read the decisions: Output > Extension Host, filter [llm-docs].`);

		vscode.window.showInformationMessage(
			`${picked.label}: ${docs ? `${docs.version} (exact: ${docs.isExactMatch})` : 'undefined'} in ${elapsed}ms. See Docs QA output.`);
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

/** Fixture control plane. Returns parsed JSON or the raw body. */
async function ctl(route, as = 'text') {
	const response = await fetch(`${FIXTURE_URL}${route}`);
	if (!response.ok) {
		throw new Error(`${route} -> ${response.status}`);
	}
	return as === 'json' ? await response.json() : await response.text();
}

/**
 * false-to-true is the transition the extension host listens for, so both writes
 * are needed even when the setting already reads true.
 */
async function flipAiEnabled() {
	const config = vscode.workspace.getConfiguration();
	await config.update(AI_ENABLED_KEY, false, vscode.ConfigurationTarget.Global);
	await config.update(AI_ENABLED_KEY, true, vscode.ConfigurationTarget.Global);
	await new Promise(resolve => setTimeout(resolve, FLIP_SETTLE_MS));
}

/** What landed in the cache root, which is how "no version directory" is checked. */
async function readdir(target) {
	try {
		return await fs.promises.readdir(target);
	} catch {
		return [];
	}
}

/** resolution and lastFailureAt are not on the public API; state.json is the only view. */
async function readState(cacheDir) {
	try {
		const state = JSON.parse(await fs.promises.readFile(path.join(cacheDir, 'state.json'), 'utf8'));
		return `resolution: ${state.resolution}, version: ${state.version ?? '-'}, `
			+ `lastError: ${state.lastError ?? '-'}, lastFailureAt: ${state.lastFailureAt ?? '-'}`;
	} catch {
		return '(no state.json)';
	}
}

function deactivate() { }

module.exports = { activate, deactivate };
