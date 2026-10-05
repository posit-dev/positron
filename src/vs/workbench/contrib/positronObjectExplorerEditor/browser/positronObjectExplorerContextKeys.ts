/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { PositronObjectExplorerEditorInput } from './positronObjectExplorerEditorInput.js';
import { ContextKeyExpr, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';

/**
 * True when the active editor is an object explorer.
 */
export const POSITRON_OBJECT_EXPLORER_IS_ACTIVE_EDITOR = ContextKeyExpr.equals(
	'activeEditor',
	PositronObjectExplorerEditorInput.EditorID
);

/**
 * True when focus is within an object explorer.
 */
export const POSITRON_OBJECT_EXPLORER_IS_FOCUSED = new RawContextKey<boolean>(
	'positronObjectExplorerFocused',
	false
);

/**
 * True when the explored object was read from a file.
 */
export const POSITRON_OBJECT_EXPLORER_IS_FILE_BACKED = new RawContextKey<boolean>(
	'positronObjectExplorerIsFileBacked',
	false
);

/**
 * The kind of the selected node, or an empty string when no node is selected.
 */
export const POSITRON_OBJECT_EXPLORER_SELECTED_KIND = new RawContextKey<string>(
	'positronObjectExplorerSelectedKind',
	''
);
