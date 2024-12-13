/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { PositronDataExplorerUri } from '../../../services/positronDataExplorer/common/positronDataExplorerUri.js';
import { IPositronDataExplorerService } from '../../../services/positronDataExplorer/browser/interfaces/positronDataExplorerService.js';

/**
 * PositronDataExplorerEditorInput class.
 */
export class PositronDataExplorerEditorInput extends EditorInput {
	//#region Static Properties

	/**
	 * Gets the type ID.
	 */
	static readonly TypeID: string = 'workbench.input.positronDataExplorer';

	/**
	 * Gets the editor ID.
	 */
	static readonly EditorID: string = 'workbench.editor.positronDataExplorer';

	//#endregion Static Properties

	_name: string = 'Data Explorer';

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param resource The resource.
	 * @param _positronDataExplorerService The Positron data explorer service.
	 */
	constructor(
		readonly resource: URI,
		@IPositronDataExplorerService private readonly _positronDataExplorerService: IPositronDataExplorerService
	) {
		// Call the base class's constructor.
		super();
	}

	/**
	 * dispose override method.
	 */
	override dispose(): void {
		// Dispose of the data explorer client instance.
		const identifier = PositronDataExplorerUri.parse(this.resource);
		if (identifier) {
			const instance = this._positronDataExplorerService.getInstance(identifier);
			if (instance) {
				instance.dataExplorerClientInstance.dispose();
			}
		}

		// Call the base class's dispose method.
		super.dispose();
	}

	//#endregion Constructor & Dispose

	//#region AbstractEditorInput Overrides

	/**
	 * Gets the type identifier.
	 */
	override get typeId(): string {
		return PositronDataExplorerEditorInput.TypeID;
	}

	/**
	 * Gets the editor identifier.
	 */
	override get editorId(): string {
		return PositronDataExplorerEditorInput.EditorID;
	}

	/**
	 * Gets the display name of this input.
	 * @returns The display name of this input.
	 */
	override getName(): string {
		// This is where the tab name comes from
		return this._name;
	}

	setName(name: string) {
		this._name = name;
		this._onDidChangeLabel.fire();
	}

	/**
	 * Determines whether the other input matches this input
	 * @param otherInput The other input.
	 * @returns true if the other input matches this input; otherwise, false.
	 */
	override matches(otherInput: EditorInput | IUntypedEditorInput): boolean {
		return otherInput instanceof PositronDataExplorerEditorInput &&
			otherInput.resource.toString() === this.resource.toString();
	}

	//#endregion AbstractEditorInput Overrides
}
