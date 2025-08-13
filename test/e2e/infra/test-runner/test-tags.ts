/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Use the tags listed below to selectively run e2e tests against your PR.
 *
 * Feature tags:
 * Each tag corresponds to a specific feature, functionality of the application. Use them
 * thoughtfully to ensure your tests align with the intended scope.
 *
 * Platform tags:
 * By default PRs will only run e2e tests against Linux / Electron.
 * Add `@:win` tag to enable the tests to run on windows. Add the `@:web` tag to enable a web run.
 *
*/

export enum TestTags {
	// feature tags
	ACCESSIBILITY = '@:accessibility',
	APPS = '@:apps',
	ARK = '@:ark',
	ASSISTANT = '@:assistant',
	CONNECTIONS = '@:connections',
	CONSOLE = '@:console',
	CRITICAL = '@:critical',
	DATA_EXPLORER = '@:data-explorer',
	DEBUG = '@:debug',
	DUCK_DB = '@:duck-db',
	EDITOR_ACTION_BAR = '@:editor-action-bar',
	EXTENSIONS = '@:extensions',
	HELP = '@:help',
	HTML = '@:html',
	INSPECT_AI = '@:inspect-ai',
	INTERPRETER = '@:interpreter',
	LAYOUTS = '@:layouts',
	VIEWER = '@:viewer',
	EDITOR = '@:editor',
	QUARTO = '@:quarto',
	MODAL = '@:modal',
	NEW_FOLDER_FLOW = '@:new-folder-flow',
	NOTEBOOKS = '@:notebooks',
	OUTLINE = '@:outline',
	OUTPUT = '@:output',
	PLOTS = '@:plots',
	PROBLEMS = '@:problems',
	PUBLISHER = '@:publisher',
	REFERENCES = '@:references',
	R_MARKDOWN = '@:r-markdown',
	R_PKG_DEVELOPMENT = '@:r-pkg-development',
	RETICULATE = '@:reticulate',
	SCM = '@:scm',
	SEARCH = '@:search',
	SESSIONS = '@:sessions',
	TASKS = '@:tasks',
	TEST_EXPLORER = '@:test-explorer',
	TOP_ACTION_BAR = '@:top-action-bar',
	VARIABLES = '@:variables',
	WELCOME = '@:welcome',
	VSCODE_SETTINGS = '@:vscode-settings',

	// performance tags
	PERFORMANCE = '@:performance',

	// platform  tags
	WEB = '@:web',
	WEB_ONLY = '@:web-only',
	WIN = '@:win',

	// exclude tags
	NIGHTLY_ONLY = '@:nightly-only'
}


type TestTagValue = `@:${string}`;

function validateTags(tags: Record<string, TestTagValue>): void {
	// This enforces that all tags conform to the @: pattern
}

validateTags(TestTags);
