/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { URI } from '../../../../base/common/uri.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { PositronObjectExplorerUri } from '../../../services/positronObjectExplorer/common/positronObjectExplorerUri.js';
import { IPositronObjectExplorerService } from '../../../services/positronObjectExplorer/browser/interfaces/positronObjectExplorerService.js';

/**
 * The longest object title shown in a tab before it is truncated.
 */
const MAX_TITLE_LENGTH = 30;

/**
 * PositronObjectExplorerEditorInput class.
 */
export class PositronObjectExplorerEditorInput extends EditorInput {
	static readonly TypeID = 'workbench.input.positronObjectExplorer';
	static readonly EditorID = 'workbench.editor.positronObjectExplorer';

	private _name = localize('positron.objectExplorer.editorName', "Object Explorer");

	constructor(
		readonly resource: URI,
		@IPositronObjectExplorerService private readonly _objectExplorerService: IPositronObjectExplorerService,
	) {
		super();
	}

	override dispose(): void {
		// Closing the tab closes the comm, unless the comm is shared with an inline view.
		const identifier = PositronObjectExplorerUri.parse(this.resource);
		if (identifier) {
			this._objectExplorerService.closeInstance(identifier);
		}
		super.dispose();
	}

	override get typeId(): string {
		return PositronObjectExplorerEditorInput.TypeID;
	}

	override get editorId(): string {
		return PositronObjectExplorerEditorInput.EditorID;
	}

	override getName(): string {
		return this._name;
	}

	/**
	 * Sets the tab name from the title of the explored object.
	 * @param title The title of the explored object.
	 */
	setTitle(title: string): void {
		const truncated = title.length > MAX_TITLE_LENGTH ? `${title.substring(0, MAX_TITLE_LENGTH - 3)}...` : title;
		this._name = localize('positron.objectExplorer.tabTitle', "Object: {0}", truncated);
		this._onDidChangeLabel.fire();
	}

	override getIcon(): ThemeIcon {
		return Codicon.listTree;
	}

	override matches(otherInput: EditorInput | IUntypedEditorInput): boolean {
		return otherInput instanceof PositronObjectExplorerEditorInput &&
			otherInput.resource.toString() === this.resource.toString();
	}
}
