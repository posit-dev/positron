/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { PositronDataExplorerEditorInput } from './positronDataExplorerEditorInput.js';
import { ContextKeyExpr, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { PositronDataExplorerLayout } from '../../../services/positronDataExplorer/browser/interfaces/positronDataExplorerService.js';

/**
 * A ContextKeyExpression that is true when the active editor is a Positron data explorer editor.
 */
export const POSITRON_DATA_EXPLORER_IS_ACTIVE_EDITOR = ContextKeyExpr.equals(
	'activeEditor',
	PositronDataExplorerEditorInput.EditorID
);

/**
 * Raw context keys.
 */
export const POSITRON_DATA_EXPLORER_LAYOUT = new RawContextKey<PositronDataExplorerLayout>(
	'positronDataExplorerLayout',
	PositronDataExplorerLayout.SummaryOnLeft
);
export const POSITRON_DATA_EXPLORER_IS_COLUMN_SORTING = new RawContextKey<boolean>(
	'positronDataExplorerIsColumnSorting',
	false
);
export const POSITRON_DATA_EXPLORER_IS_PLAINTEXT = new RawContextKey<boolean>(
	'positronDataExplorerIsPlaintext',
	false
);
