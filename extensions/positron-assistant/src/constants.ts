/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { DocumentSelector } from 'vscode-languageclient';

/** The extension root directory. */
export const EXTENSION_ROOT_DIR = path.join(__dirname, '..');

/** Selects all documents. */
export const ALL_DOCUMENTS_SELECTOR: DocumentSelector = [{ scheme: '*' }];
