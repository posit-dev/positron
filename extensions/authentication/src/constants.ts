/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export const IS_RUNNING_ON_PWB =
	!!process.env.RS_SERVER_URL && vscode.env.uiKind === vscode.UIKind.Web;

export const ANTHROPIC_API_VERSION = '2023-06-01';

// Budget for a validator's single round trip to the provider (validation/*.ts).
// 5 seconds turned out to be too tight: the OpenAI `/models` call intermittently
// takes longer than that, which aborted a valid key and surfaced as a sign-in
// failure. Kept comfortably under the 15 second window the sign-in e2e tests
// allow for the "Sign out" button to appear.
export const KEY_VALIDATION_TIMEOUT_MS = 10000;
export const CREDENTIAL_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
export const EXPIRY_REFRESH_BUFFER_MS = 60 * 1000;

// Default provider base URLs. Single source of truth so the modal defaults
// (providerSources.ts) and the API-key validators (validation/*.ts) can't drift
// apart, which is what let the Anthropic host lose its version segment.
// anthropic/openai/gemini carry the version segment the `@ai-sdk/*` clients
// expect; deepseek and vertex are intentionally bare (their SDKs add the path
// themselves - see ai-provider-bridge's KNOWN_HOSTS).
export const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';
export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';
export const GEMINI_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
export const DEEPSEEK_DEFAULT_BASE_URL = 'https://api.deepseek.com';
export const VERTEX_DEFAULT_BASE_URL = 'https://aiplatform.googleapis.com';

export const ANTHROPIC_AUTH_PROVIDER_ID = 'anthropic-api';
export const POSIT_AUTH_PROVIDER_ID = 'posit-ai';
export const AWS_AUTH_PROVIDER_ID = 'amazon-bedrock';
export const FOUNDRY_AUTH_PROVIDER_ID = 'ms-foundry';
export const SNOWFLAKE_AUTH_PROVIDER_ID = 'snowflake-cortex';
export const OPENAI_AUTH_PROVIDER_ID = 'openai-api';
export const CUSTOM_PROVIDER_AUTH_PROVIDER_ID = 'openai-compatible';
export const GEMINI_AUTH_PROVIDER_ID = 'google';
export const GOOGLE_CLOUD_AUTH_PROVIDER_ID = 'google-cloud';
export const DEEPSEEK_AUTH_PROVIDER_ID = 'deepseek-api';
export const DATABRICKS_AUTH_PROVIDER_ID = 'databricks';

export const DATABRICKS_OAUTH_SESSION_ID = 'databricks-oauth';

/**
 * The one authentication provider every `providers.custom` entry is served
 * under, with the entry name as the scope. Static so it can be allowlisted in
 * product.json's `trustedExtensionAuthAccess`, which a user-chosen entry name
 * never can. See {@link CustomProviderAggregate}.
 */
export const POSITRON_CUSTOM_AUTH_PROVIDER_ID = 'positron-custom-provider';

export const DATABRICKS_OAUTH_CLIENT_ID = 'databricks-cli';
export const DATABRICKS_OAUTH_PORT_MIN = 8020;
export const DATABRICKS_OAUTH_PORT_MAX = 8040;
export const DATABRICKS_OAUTH_SCOPES = 'all-apis offline_access';
