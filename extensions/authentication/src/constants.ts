/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export const IS_RUNNING_ON_PWB =
	!!process.env.RS_SERVER_URL && vscode.env.uiKind === vscode.UIKind.Web;

// Budget for a validator's single round trip to the provider (validation/*.ts).
// 5 seconds turned out to be too tight: the OpenAI `/models` call intermittently
// takes longer than that, which aborted a valid key and surfaced as a sign-in
// failure. Kept comfortably under the 15 second window the sign-in e2e tests
// allow for the "Sign out" button to appear.
export const KEY_VALIDATION_TIMEOUT_MS = 10000;
export const EXPIRY_REFRESH_BUFFER_MS = 60 * 1000;

export const AWS_AUTH_PROVIDER_ID = 'bedrock';
export const SNOWFLAKE_AUTH_PROVIDER_ID = 'snowflake-cortex';
export const DATABRICKS_AUTH_PROVIDER_ID = 'databricks';

export const DATABRICKS_OAUTH_SESSION_ID = 'databricks-oauth';
export const DATABRICKS_OAUTH_CLIENT_ID = 'databricks-cli';
export const DATABRICKS_OAUTH_PORT_MIN = 8020;
export const DATABRICKS_OAUTH_PORT_MAX = 8040;
export const DATABRICKS_OAUTH_SCOPES = 'all-apis offline_access';
