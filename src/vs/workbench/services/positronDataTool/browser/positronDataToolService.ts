/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { PositronDataToolUri } from 'vs/workbench/services/positronDataTool/common/positronDataToolUri';
import { PositronDataToolInstance } from 'vs/workbench/services/positronDataTool/browser/positronDataToolInstance';
import { IPositronDataToolService } from 'vs/workbench/services/positronDataTool/browser/interfaces/positronDataToolService';
import { IPositronDataToolInstance } from 'vs/workbench/services/positronDataTool/browser/interfaces/positronDataToolInstance';

/**
 * PositronDataToolService class.
 */
class PositronDataToolService extends Disposable implements IPositronDataToolService {
	//#region Private Properties

	/**
	 * The Positron data tool instance map.
	 */
	private _positronDataToolInstanceMap = new Map<string, PositronDataToolInstance>();

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param _editorService The editor service.
	 */
	constructor(
		@IEditorService private readonly _editorService: IEditorService
	) {
		// Call the disposable constrcutor.
		super();
	}

	//#endregion Constructor & Dispose

	//#region IPositronDataToolService Implementation

	/**
	 * Needed for service branding in dependency injector.
	 */
	declare readonly _serviceBrand: undefined;

	/**
	 * Test open function.
	 */
	async testOpen(identifier: string): Promise<void> {
		// Add the instance, if necessary.
		if (!this._positronDataToolInstanceMap.has(identifier)) {
			const positronDataToolInstance = new PositronDataToolInstance(identifier);
			this._positronDataToolInstanceMap.set(identifier, positronDataToolInstance);
		}

		// Open the editor.
		await this._editorService.openEditor({
			resource: PositronDataToolUri.generate(identifier)
		});
	}

	/**
	 * Gets a Positron data tool instance.
	 * @param identifier The identifier of the Positron data tool instance.
	 */
	getInstance(identifier: string): IPositronDataToolInstance | undefined {
		return this._positronDataToolInstanceMap.get(identifier);
	}

	//#endregion IPositronDataToolService Implementation
}

// Register the Positron data tool service.
registerSingleton(IPositronDataToolService, PositronDataToolService, InstantiationType.Delayed);
