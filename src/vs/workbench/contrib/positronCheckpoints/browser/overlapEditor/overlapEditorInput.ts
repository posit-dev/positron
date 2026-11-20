/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { URI } from '../../../../../base/common/uri.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../../common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { Strings } from '../../common/checkpointsStrings.js';

/**
 * The input of the overlap editor, where the person chooses what to keep for each overlap. It has
 * no state of its own: the editor shows the overlaps of the window's `ISyncController`. Every
 * instance matches every other, so a window has at most one overlap editor. No serializer is
 * registered, so the editor is not restored after a restart.
 *
 * `onClosed` runs when the input is disposed, which happens when its last tab closes. The
 * creator uses it to forget the choices made in the editor.
 */
export class OverlapEditorInput extends EditorInput {
	static readonly TypeID = 'workbench.input.positronCheckpointsOverlaps';
	static readonly EditorID = 'workbench.editor.positronCheckpointsOverlaps';

	constructor(private readonly _onClosed?: () => void) {
		super();
	}

	override get resource(): URI | undefined {
		return undefined;
	}

	override get typeId(): string {
		return OverlapEditorInput.TypeID;
	}

	override get editorId(): string {
		return OverlapEditorInput.EditorID;
	}

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton;
	}

	override getName(): string {
		return Strings.overlaps.heading();
	}

	override getIcon(): ThemeIcon {
		return Codicon.gitMerge;
	}

	override matches(otherInput: EditorInput | IUntypedEditorInput): boolean {
		return otherInput instanceof OverlapEditorInput;
	}

	override dispose(): void {
		this._onClosed?.();
		super.dispose();
	}
}
