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

export const ANTHROPIC_AUTH_PROVIDER_ID = 'anthropic-api';
export const POSIT_AUTH_PROVIDER_ID = 'posit-ai';
export const AWS_AUTH_PROVIDER_ID = 'amazon-bedrock';
export const FOUNDRY_AUTH_PROVIDER_ID = 'ms-foundry';
export const OPENAI_AUTH_PROVIDER_ID = 'openai-api';
export const CUSTOM_PROVIDER_AUTH_PROVIDER_ID = 'openai-compatible';
export const GEMINI_AUTH_PROVIDER_ID = 'google';
