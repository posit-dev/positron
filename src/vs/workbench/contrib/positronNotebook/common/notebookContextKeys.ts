/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';

/** Notebook-level context keys for the Positron notebook editor. */
export namespace NotebookContextKeys {
	/** Set when the Positron notebook editor container is focused. */
	export const editorFocused = new RawContextKey<boolean>('positronNotebookEditorFocused', false, { type: 'boolean', description: localize('positronNotebookFocused', "Whether a Positron notebook editor or a notebook editor widget (e.g. a cell editor or the find widget) has focus") });
	/** Set when a cell editor (Monaco editor within a notebook cell) is focused. */
	export const cellEditorFocused = new RawContextKey<boolean>('positronNotebookCellEditorFocused', false, { type: 'boolean', description: localize('positronNotebookCellEditorFocused', "Whether a code editor within a Positron notebook cell is focused") });
	/** Mirrors the `positron.notebook.experimental` configuration. */
	export const experimental = new RawContextKey<boolean>('positronNotebook.experimental', false, { type: 'boolean', description: localize('positronNotebookExperimental', "Whether experimental Positron Notebook features are enabled") });
	/** Composite notebook AI gate: true only when both `ai.enabled` and `notebook.ai.enabled` are on. Derived from configuration; see `bindNotebookAIEnabledContextKey`. */
	export const aiEnabled = new RawContextKey<boolean>('positronNotebook.aiEnabled', true, { type: 'boolean', description: localize('positronNotebookAiEnabled', "Whether AI features are enabled for Positron notebooks (both the global ai.enabled switch and the notebook.ai.enabled switch are on)") });
}
