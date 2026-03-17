"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.TestTags = void 0;
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
 * Cross-browser tag:
 * Add `@:cross-browser` to tests that run in multiple browsers (Chrome, Firefox, WebKit, Edge).
 * This signals that changes to these tests should consider cross-browser compatibility.
 *
*/
var TestTags;
(function (TestTags) {
    // feature tags
    TestTags["ACCESSIBILITY"] = "@:accessibility";
    TestTags["APPS"] = "@:apps";
    TestTags["ARK"] = "@:ark";
    TestTags["ASSISTANT"] = "@:assistant";
    TestTags["CATALOG_EXPLORER"] = "@:catalog-explorer";
    TestTags["CONNECTIONS"] = "@:connections";
    TestTags["CONSOLE"] = "@:console";
    TestTags["CRITICAL"] = "@:critical";
    TestTags["DATABOT"] = "@:databot";
    TestTags["DATA_EXPLORER"] = "@:data-explorer";
    TestTags["DEBUG"] = "@:debug";
    TestTags["DUCK_DB"] = "@:duck-db";
    TestTags["EDITOR_ACTION_BAR"] = "@:editor-action-bar";
    TestTags["EXTENSIONS"] = "@:extensions";
    TestTags["HELP"] = "@:help";
    TestTags["HTML"] = "@:html";
    TestTags["ASSISTANT_EVAL"] = "@:assistant-eval";
    TestTags["INTERPRETER"] = "@:interpreter";
    TestTags["LAYOUTS"] = "@:layouts";
    TestTags["VIEWER"] = "@:viewer";
    TestTags["EDITOR"] = "@:editor";
    TestTags["QUARTO"] = "@:quarto";
    TestTags["MODAL"] = "@:modal";
    TestTags["NEW_FOLDER_FLOW"] = "@:new-folder-flow";
    TestTags["NOTEBOOKS"] = "@:notebooks";
    TestTags["POSITRON_NOTEBOOKS"] = "@:positron-notebooks";
    TestTags["OUTLINE"] = "@:outline";
    TestTags["OUTPUT"] = "@:output";
    TestTags["PLOTS"] = "@:plots";
    TestTags["PROBLEMS"] = "@:problems";
    TestTags["PUBLISHER"] = "@:publisher";
    TestTags["PYREFLY"] = "@:pyrefly";
    TestTags["REFERENCES"] = "@:references";
    TestTags["R_MARKDOWN"] = "@:r-markdown";
    TestTags["R_PKG_DEVELOPMENT"] = "@:r-pkg-development";
    TestTags["RETICULATE"] = "@:reticulate";
    TestTags["SCM"] = "@:scm";
    TestTags["SEARCH"] = "@:search";
    TestTags["SESSIONS"] = "@:sessions";
    TestTags["TASKS"] = "@:tasks";
    TestTags["TEST_EXPLORER"] = "@:test-explorer";
    TestTags["TOP_ACTION_BAR"] = "@:top-action-bar";
    TestTags["VARIABLES"] = "@:variables";
    TestTags["WELCOME"] = "@:welcome";
    TestTags["VSCODE_SETTINGS"] = "@:vscode-settings";
    // performance tags
    TestTags["PERFORMANCE"] = "@:performance";
    // platform  tags
    TestTags["CROSS_BROWSER"] = "@:cross-browser";
    TestTags["RHEL_ELECTRON"] = "@:rhel-electron";
    TestTags["RHEL_WEB"] = "@:rhel-web";
    TestTags["SUSE_ELECTRON"] = "@:suse-electron";
    TestTags["SUSE_WEB"] = "@:suse-web";
    TestTags["SLES_ELECTRON"] = "@:sles-electron";
    TestTags["SLES_WEB"] = "@:sles-web";
    TestTags["DEBIAN_ELECTRON"] = "@:debian-electron";
    TestTags["DEBIAN_WEB"] = "@:debian-web";
    TestTags["WEB"] = "@:web";
    TestTags["WEB_ONLY"] = "@:web-only";
    TestTags["WIN"] = "@:win";
    TestTags["WORKBENCH"] = "@:workbench";
    TestTags["REMOTE_SSH"] = "@:remote-ssh";
    // soft fail tag for tests that shouldn't fail merge to main
    TestTags["SOFT_FAIL"] = "@:soft-fail";
})(TestTags || (exports.TestTags = TestTags = {}));
function validateTags(tags) {
    // This enforces that all tags conform to the @: pattern
}
validateTags(TestTags);
//# sourceMappingURL=test-tags.js.map