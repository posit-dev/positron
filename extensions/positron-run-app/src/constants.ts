/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

// Regex to match a string that starts with http:// or https://.
export const HTTP_URL_REGEX = /((https?:\/\/)([a-zA-Z0-9.-]+)(:\d{1,5})?(\/[^\s]*)?)/g;
// A more permissive URL regex to be used when a string containing an {{APP_URL}} placeholder is expected.
export const URL_LIKE_REGEX = /((https?:\/\/)?([a-zA-Z0-9.-]*[.:][a-zA-Z0-9.-]*)(:\d{1,5})?(\/[^\s]*)?)/g;

// App URL Placeholder string.
export const APP_URL_PLACEHOLDER = '{{APP_URL}}';

// Flags to determine where Positron is running.
export const IS_POSITRON_WEB = vscode.env.uiKind === vscode.UIKind.Web;
export const IS_RUNNING_ON_PWB = !!process.env.RS_SERVER_URL && IS_POSITRON_WEB;

// Timeouts.
export const TERMINAL_OUTPUT_TIMEOUT = 25_000;
export const DID_PREVIEW_URL_TIMEOUT = TERMINAL_OUTPUT_TIMEOUT + 5_000;
/** Time between creating a terminal and receiving its onDidChangeTerminalShellIntegration event. */
export const SHELL_INTEGRATION_TIMEOUT = 5_000;
