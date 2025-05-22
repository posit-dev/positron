/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { DocumentSelector } from 'vscode-languageclient';

/** The extension root directory. */
export const EXTENSION_ROOT_DIR = path.join(__dirname, '..');

/** Directory containing markdown files (e.g. prompt templates). */
export const MARKDOWN_DIR = path.join(EXTENSION_ROOT_DIR, 'src', 'md');

/** Selects all documents. */
export const ALL_DOCUMENTS_SELECTOR: DocumentSelector = [{ scheme: '*' }];

/** The default max token output if a model's maximum is unknown */
export const DEFAULT_MAX_TOKEN_OUTPUT = 4_096;
