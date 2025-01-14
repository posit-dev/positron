/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Use the tags listed below to selectively run e2e tests against your PR.
 *
 * Each tag corresponds to a specific feature, functionality, or area of the application. Use them
 * thoughtfully to ensure your tests align with the intended scope.
 *
 * Add `@:win` tag to enable the tests to run on windows. Add the `@:web` tag to enable a web run.
 * The default will only run Linux electron e2e tests.
 *
 * DON'T FORGET TO ADD THE COLON `:` AFTER THE `@` SYMBOL when tagging tests in a PR description.
 *   -> Correct:   `@:tag`
 *   -> Incorrect: `@tag`
*/
export enum TestTags {

	// features and functionality
	EDITOR_ACTION_BAR = '@editor-action-bar',
	APPS = '@apps',
	CONNECTIONS = '@connections',
	CONSOLE = '@console',
	CRITICAL = '@critical',
	DATA_EXPLORER = '@data-explorer',
	DUCK_DB = '@duck-db',
	HELP = '@help',
	HTML = '@html',
	INTERPRETER = '@interpreter',
	LAYOUTS = '@layouts',
	VIEWER = '@viewer',
	EDITOR = '@editor',
	QUARTO = '@quarto',
	NEW_PROJECT_WIZARD = '@new-project-wizard',
	NOTEBOOKS = '@notebooks',
	OUTLINE = '@outline',
	OUTPUT = '@output',
	PLOTS = '@plots',
	R_MARKDOWN = '@r-markdown',
	R_PKG_DEVELOPMENT = '@r-pkg-development',
	RETICULATE = '@reticulate',
	TEST_EXPLORER = '@test-explorer',
	TOP_ACTION_BAR = '@top-action-bar',
	VARIABLES = '@variables',
	WELCOME = '@welcome',

	// platform
	WEB = '@web',
	WIN = '@win'
}
