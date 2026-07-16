/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Centralized logging for the positron-assistant extension.
 *
 * This module is intentionally low-level with minimal dependencies to avoid circular
 * imports - many modules need logging but logging should not depend on higher-level
 * extension functionality.
 */

import * as vscode from 'vscode';

/**
 * The shared log instance for the positron-assistant extension.
 * Use this for all logging throughout the extension.
 */
export const log = vscode.window.createOutputChannel('Assistant', { log: true });
