/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';

/**
 * Editor input for the Positron Control Gallery -- a developer-only environment for working
 * on Positron controls (Positron List, Positron Tree, etc.). The input has no document state;
 * it is a singleton identified by its class, so it carries no resource URI and is opened
 * directly by the Developer action, not through URI-based editor resolution.
 */
export class PositronControlGalleryEditorInput extends EditorInput {
	static readonly TypeID = 'workbench.input.positronControlGallery';
	static readonly EditorID = 'workbench.editor.positronControlGallery';

	// EditorInput requires a resource. The Control Gallery is a singleton with no document
	// state, so we return undefined; identity is established by class via matches() instead.
	override get resource(): URI | undefined {
		return undefined;
	}

	override get editorId(): string {
		return PositronControlGalleryEditorInput.EditorID;
	}

	override get typeId(): string {
		return PositronControlGalleryEditorInput.TypeID;
	}

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton;
	}

	override getName(): string {
		return localize('positronControlGallery.editorName', "Control Gallery");
	}

	override matches(otherInput: EditorInput | IUntypedEditorInput): boolean {
		return otherInput instanceof PositronControlGalleryEditorInput;
	}
}
