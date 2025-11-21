/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { DocumentSelector } from 'vscode-languageclient';
import * as vscode from 'vscode';

/** The extension root directory. */
export const EXTENSION_ROOT_DIR = path.join(__dirname, '..');

/** Directory containing markdown files (e.g. prompt templates). */
export const MARKDOWN_DIR = path.join(EXTENSION_ROOT_DIR, 'src', 'md');

/** Selects all documents. */
export const ALL_DOCUMENTS_SELECTOR: DocumentSelector = [{ scheme: '*' }];

/** The default max token input if a model's maximum is unknown */
export const DEFAULT_MAX_TOKEN_INPUT = 100_000;

/** The default max token output if a model's maximum is unknown */
export const DEFAULT_MAX_TOKEN_OUTPUT = 4_096;

/** Tag used by tools to indicate a workspace must be open in order to use the tool */
export const TOOL_TAG_REQUIRES_WORKSPACE = 'requires-workspace';

/**
 * Tag used by tools to indicate that a session must be active in order to use the tool
 *
 * May be followed by a language ID to indicate that a session for that specific language must be active.
 * e.g. 'requires-session:python' would require an active Python session.
 *
 * If no language ID is specified, it indicates that any active session is sufficient.
 */
export const TOOL_TAG_REQUIRES_ACTIVE_SESSION = 'requires-session';

/**
 * Tag used by tools to indicate that a Positron notebook must be active in order to use the tool.
 *
 * This tag provides fail-fast filtering in getEnabledTools to quickly exclude notebook tools
 * when no notebook is attached with an active editor. Individual notebook tools have additional
 * mode-based checks (Ask/Edit/Agent) in the switch statement for more granular control.
 * See extensions/positron-assistant/src/api.ts (getEnabledTools function) for filtering logic.
 */
export const TOOL_TAG_REQUIRES_NOTEBOOK = 'requires-notebook';

/** Max number of variables to include in language session context */
export const MAX_CONTEXT_VARIABLES = 400;

/** Max number of models to attempt connecting to when checking auth for a provider */
export const DEFAULT_MAX_CONNECTION_ATTEMPTS = 3;

/**
 * Determines if the Posit Web environment is detected.
 */
export const IS_RUNNING_ON_PWB = !!process.env.RS_SERVER_URL && vscode.env.uiKind === vscode.UIKind.Web;
