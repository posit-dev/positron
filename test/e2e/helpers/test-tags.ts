/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Use the tags listed below to selectively run e2e tests against your PR.
 *
 * - To run all e2e tests, include `@:all` in your PR description.
 * - Avoid using `@:web` and `@:win` tags, as these are reserved for web and Windows platform-specific tests,
 *   which are not currently configured to run in PR workflows.
 *
 * Each tag corresponds to a specific feature, functionality, or area of the application. Use them
 * thoughtfully to ensure your tests align with the intended scope.
 */
export enum TestTags {
	APPS = '@apps',
	CONNECTIONS = '@connections',
	CONSOLE = '@console',
	CRITICAL = '@critical',
	DATA_EXPLORER = '@data-explorer',
	DUCK_DB = '@duck-db',
	HELP = '@help',
	LAYOUTS = '@layouts',
	VIEWER = '@viewer',
	EDITOR = '@editor',
	QUARTO = '@quarto',
	NEW_PROJECT_WIZARD = '@new-project-wizard',
	NOTEBOOK = '@notebook',
	OUTLINE = '@outline',
	OUTPUT = '@output',
	PLOTS = '@plots',
	R_MARKDOWN = '@r-markdown',
	R_PKG_DEVELOPMENT = '@r-pkg-development',
	RETICULATE = '@reticulate',
	TEST_EXPLORER = '@test-explorer',
	TOP_ACTION_BAR = '@top-action-bar',
	VARIABLES = '@variables',
	WEB = '@web',
	WELCOME = '@welcome',
	WIN = '@win'
}
