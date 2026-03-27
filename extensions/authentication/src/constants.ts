/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export const IS_RUNNING_ON_PWB =
	!!process.env.RS_SERVER_URL && vscode.env.uiKind === vscode.UIKind.Web;

export const ANTHROPIC_API_VERSION = '2023-06-01';
export const KEY_VALIDATION_TIMEOUT_MS = 5000;
export const CREDENTIAL_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
