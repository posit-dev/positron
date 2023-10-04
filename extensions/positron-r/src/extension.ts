/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

import { registerCommands } from './commands';
import { providePackageTasks } from './tasks';
import { setContexts } from './contexts';
import { discoverTests } from './testing';
import { initializeLogging } from './logging';
import { rRuntimeProvider } from './provider';
import { RRuntime } from './runtime';


export function activate(context: vscode.ExtensionContext) {

	const runtimes = new Map<string, RRuntime>();
	positron.runtime.registerLanguageRuntimeProvider(
		'r', rRuntimeProvider(context, runtimes));

	// Initialize logging tools.
	initializeLogging(context);

	// Set contexts.
	setContexts(context);

	// Register commands.
	registerCommands(context, runtimes);

	// Provide tasks.
	providePackageTasks(context);

	// Discover R package tests.
	discoverTests(context);

}
