/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';

/**
 * Editor input for the developer-only Counter demo. It has no document state and no
 * resource URI; identity is by class. It is deliberately not a singleton, so the editor
 * can be split into two groups to show both copies staying in sync.
 */
export class CounterEditorInput extends EditorInput {
	static readonly TypeID = 'workbench.input.positronCounter';
	static readonly EditorID = 'workbench.editor.positronCounter';

	// No document state, so no resource; identity is established by class via matches().
	override get resource(): URI | undefined {
		return undefined;
	}

	override get editorId(): string {
		return CounterEditorInput.EditorID;
	}

	override get typeId(): string {
		return CounterEditorInput.TypeID;
	}

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly;
	}

	override getName(): string {
		return localize('positron.counter.editorName', "Counter");
	}

	override matches(otherInput: EditorInput | IUntypedEditorInput): boolean {
		return otherInput instanceof CounterEditorInput;
	}
}
