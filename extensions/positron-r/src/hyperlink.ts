/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { RRuntime } from './runtime';

export async function handleRCode(runtime: RRuntime, code: string): Promise<void> {
	const match = matchRunnable(code);

	if (!match) {
		// Didn't match our regex. Not safe to run, or not recognizable as R code.
		return handleNotRunnable(code);
	}
	if (!match.groups) {
		return handleNotRunnable(code);
	}

	const packageName = match.groups.package;
	// Not currently used, but could be useful for showing help documentation on hover
	// const functionName = match.groups.function;

	if (isCorePackage(packageName)) {
		// We never run code prefixed with a core package name, as this is suspicious
		return handleNotRunnable(code);
	}

	if (isBlessedPackage(packageName)) {
		// Attached or not, if it is a blessed package then we automatically run it
		return handleAutomaticallyRunnable(runtime, code);
	}
	if (await runtime.isPackageAttached(packageName)) {
		// Only automatically run unknown package code if the package is already attached
		return handleAutomaticallyRunnable(runtime, code);
	}

	// Otherwise, it looks like runnable code but isn't safe enough to automatically run
	return handleManuallyRunnable(runtime, code);
}

function handleNotRunnable(code: string) {
	vscode.window.showInformationMessage(vscode.l10n.t(
		`Code hyperlink not recognized. Manually run the following if you trust the hyperlink source: \`${code}\`.`
	));
}

function handleManuallyRunnable(_runtime: RRuntime, code: string) {
	const console = positron.window.getConsoleForLanguage('r');

	if (!console) {
		// Not an expected path, but technically possible,
		// and we should still do something somewhat useful.
		vscode.window.showInformationMessage(vscode.l10n.t(
			`Failed to locate an R console. Code hyperlink written to clipboard instead: \`${code}\`.`
		));
		vscode.env.clipboard.writeText(code);
		return;
	}

	console.pasteText(code);
}

function handleAutomaticallyRunnable(runtime: RRuntime, code: string) {
	const id = randomUUID();

	// Fire and forget style
	runtime.execute(
		code,
		id,
		positron.RuntimeCodeExecutionMode.Interactive,
		positron.RuntimeErrorBehavior.Continue
	);
}

export function matchRunnable(code: string): RegExpMatchArray | null {
	// Of the form `package::function(args)` where `args` can't contain `(`, `)`, or `;`.
	// See https://cli.r-lib.org/reference/links.html#security-considerations.
	const runnableRegExp = /^(?<package>\w+)::(?<function>\w+)[(][^();]*[)]$/;
	return code.match(runnableRegExp);
}

function isCorePackage(packageName: string): boolean {
	const corePackages = ['utils', 'base', 'stats'];
	return corePackages.includes(packageName);
}

function isBlessedPackage(packageName: string): boolean {
	const blessedPackages = ['testthat', 'rlang', 'devtools', 'usethis', 'pkgload', 'pkgdown'];
	return blessedPackages.includes(packageName);
}
