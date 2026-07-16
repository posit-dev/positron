/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Use the tags listed below to selectively run e2e tests against your PR.
 *
 * Tags are split across three enums by role, then merged into a single
 * `TestTags` object (and `TestTags` type) so tests keep using them uniformly
 * (`tags.CONSOLE`, `tags.WIN`, ...). The split is the source of truth for the
 * PR auto-tagging scripts, which infer a tag's role from the enum it lives in
 * (scripts/lib/pr-tags-lib.sh `feature_enum_tags` parses the FeatureTags block).
 *
 * FeatureTags:
 * Each tag corresponds to a feature/area of the application and runs in the
 * default Linux/Electron lane. These are the ONLY tags the auto test-change
 * tag derivation may select -- touching an e2e test auto-adds the minimal
 * feature tag(s) needed to run it (see scripts/derive-test-change-tags.mjs).
 *
 * PlatformTags:
 * Platform/lane selectors. By default PRs only run Linux/Electron; these opt
 * into other OSes, browsers, or Workbench/remote lanes, each of which spins up
 * a dedicated CI job. They are author-controlled (add the tag to the PR body)
 * and are NOT auto-derived from test-file changes -- the one exception is
 * @:win/@:web, which a newly-added tags.WIN/tags.WEB in a test file enables via
 * scripts/lib/pr-tags-lib.sh `scan_added_platform_tags`.
 *
 * SpecialTags:
 * Modifiers that don't select a feature area or a lane (e.g. @:soft-fail marks
 * a test that shouldn't fail merge to main). Never auto-derived.
 *
 * Cross-browser:
 * Add `@:cross-browser` to tests that run in multiple browsers (Chrome,
 * Firefox, WebKit, Edge). This signals that changes should consider
 * cross-browser compatibility.
 *
 * Adding a new feature tag:
 * If it corresponds to a source directory, add that directory to
 * .github/workflows/test-tag-paths-map.json so PRs touching it get auto-tagged.
 * scripts/check-test-tag-map.sh guards against the two drifting apart.
 *
*/

// Feature/area tags -- run in the default Linux/Electron lane and are the only
// tags eligible for auto test-change tag derivation.
export enum FeatureTags {
	ACCESSIBILITY = '@:accessibility',
	APPS = '@:apps',
	ARK = '@:ark',
	ASSISTANT = '@:assistant',
	CATALOG_EXPLORER = '@:catalog-explorer',
	CONNECT = '@:connect',
	CONNECTIONS = '@:connections',
	CONSOLE = '@:console',
	CRITICAL = '@:critical',
	DATA_EXPLORER = '@:data-explorer',
	DEBUG = '@:debug',
	DUCK_DB = '@:duck-db',
	EDITOR_ACTION_BAR = '@:editor-action-bar',
	ENVIRONMENT_MODULES = '@:environment-modules',
	EXTENSIONS = '@:extensions',
	HELP = '@:help',
	HTML = '@:html',
	ASSISTANT_EVAL = '@:assistant-eval',
	INTERPRETER = '@:interpreter',
	JUPYTER = '@:jupyter',
	LAYOUTS = '@:layouts',
	VIEWER = '@:viewer',
	EDITOR = '@:editor',
	QUARTO = '@:quarto',
	MODAL = '@:modal',
	NEW_FOLDER_FLOW = '@:new-folder-flow',
	NOTEBOOKS = '@:notebooks',
	POSITRON_NOTEBOOKS = '@:positron-notebooks',
	OUTLINE = '@:outline',
	OUTPUT = '@:output',
	PACKAGES_PANE = '@:packages-pane',
	PDF = '@:pdf',
	PERFORMANCE = '@:performance',
	PLOTS = '@:plots',
	PROBLEMS = '@:problems',
	PUBLISHER = '@:publisher',
	PYREFLY = '@:pyrefly',
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
}

// Platform/lane selectors -- each opts into a dedicated CI job. Author-controlled
// and never auto-derived from test-file changes (except @:win/@:web via the
// newly-added-tag scan). Excluded from the auto test-change tag derivation.
export enum PlatformTags {
	CROSS_BROWSER = '@:cross-browser',
	RHEL_ELECTRON = '@:rhel-electron',
	RHEL_WEB = '@:rhel-web',
	SUSE_ELECTRON = '@:suse-electron',
	SUSE_WEB = '@:suse-web',
	SLES_ELECTRON = '@:sles-electron',
	SLES_WEB = '@:sles-web',
	DEBIAN_ELECTRON = '@:debian-electron',
	DEBIAN_WEB = '@:debian-web',
	WEB = '@:web',
	WEB_ONLY = '@:web-only',
	WIN = '@:win',
	WORKBENCH = '@:workbench',
	WORKBENCH_STABLE = '@:workbench-stable',
	WORKBENCH_SNOWFLAKE = '@:workbench-snowflake',
	WORKBENCH_DATABRICKS = '@:workbench-databricks',
	WORKBENCH_AZURE = '@:workbench-azure',
	REMOTE_SSH = '@:remote-ssh',
	REMOTE_WSL = '@:remote-wsl',
}

// Modifiers that select neither a feature area nor a lane. Never auto-derived.
export enum SpecialTags {
	// Soft fail tag for tests that shouldn't fail merge to main.
	SOFT_FAIL = '@:soft-fail',
}

// Merge the role enums into a single value + type so tests use tags uniformly
// (`tags.CONSOLE`, `tags.WIN`) regardless of role. Declaration merging keeps
// `TestTags` usable as both a value (member access) and a type (`TestTags[]`),
// exactly as the single enum was.
export const TestTags = { ...FeatureTags, ...PlatformTags, ...SpecialTags };
export type TestTags = FeatureTags | PlatformTags | SpecialTags;


type TestTagValue = `@:${string}`;

function validateTags(tags: Record<string, TestTagValue>): void {
	// This enforces that all tags conform to the @: pattern
}

validateTags(TestTags);
