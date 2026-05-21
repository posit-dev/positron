/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Configuration helpers for model providers.
 *
 * These functions are separated from config.ts to avoid circular dependencies.
 * config.ts imports from ./providers, which imports provider classes that extend ModelProvider.
 * ModelProvider needs these config functions, creating a cycle if they're in config.ts.
 */

import * as vscode from 'vscode';
import { DEFAULT_PROVIDER_TIMEOUT_SEC } from './constants.js';

/**
 * Gets the provider timeout in milliseconds from user configuration.
 */
export function getProviderTimeoutMs(): number {
	const cfg = vscode.workspace.getConfiguration('positron.assistant');
	const timeoutSec = cfg.get<number>('providerTimeout', DEFAULT_PROVIDER_TIMEOUT_SEC);
	return timeoutSec * 1000;
}
