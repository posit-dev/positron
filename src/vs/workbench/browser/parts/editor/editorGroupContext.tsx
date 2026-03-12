/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext, useContext } from 'react';
import type { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';

/**
 * React context that provides the editor group to action bar widgets.
 * This allows widgets to resolve their state from the correct editor group
 * rather than the globally active (focused) editor.
 */
export const EditorGroupContext = createContext<IEditorGroup | undefined>(undefined);

/**
 * Hook to access the editor group from the action bar context.
 * Returns undefined if used outside of an EditorGroupContext provider.
 */
export function useEditorGroup(): IEditorGroup | undefined {
	return useContext(EditorGroupContext);
}
