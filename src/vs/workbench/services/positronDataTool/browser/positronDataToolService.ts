/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { PositronDataToolUri } from 'vs/workbench/services/positronDataTool/common/positronDataToolUri';
import { IPositronDataToolInstance, IPositronDataToolService, PositronDataToolLayout } from 'vs/workbench/services/positronDataTool/browser/interfaces/positronDataToolService';

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

/**
* PositronDataToolInstance class.
*/
class PositronDataToolInstance extends Disposable implements IPositronDataToolInstance {
	//#region Private Properties

	/**
	 * Gets or sets the layout.
	 */
	private _layout = PositronDataToolLayout.ColumnsLeft;

	/**
	 * Gets or sets the columns width percent.
	 */
	private _columnsWidthPercent = 0.25;

	/**
	 * Gets or sets the columns scroll offset.
	 */
	private _columnsScrollOffset = 200;

	/**
	 * Gets or sets the rows scroll offset.
	 */
	private _rowsScrollOffset = 0;

	/**
	 * The onDidChangeLayout event emitter.
	 */
	private readonly _onDidChangeLayoutEmitter = this._register(new Emitter<PositronDataToolLayout>);

	/**
	 * The onDidChangeColumnsWidthPercent event emitter.
	 */
	private readonly _onDidChangeColumnsWidthPercentEmitter = this._register(new Emitter<number>);

	/**
	 * The onDidChangeColumnsScrollOffset event emitter.
	 */
	private readonly _onDidChangeColumnsScrollOffsetEmitter = this._register(new Emitter<number>);

	/**
	 * The onDidChangeRowsScrollOffset event emitter.
	 */
	private readonly _onDidChangeRowsScrollOffsetEmitter = this._register(new Emitter<number>);

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param identifier The identifier.
	 */
	constructor(readonly identifier: string) {
		// Call the base class's constructor.
		super();
	}

	//#endregion Constructor & Dispose

	//#region IPositronDataToolInstance Implementation

	/**
	 * Gets the layout.
	 */
	get layout() {
		return this._layout;
	}

	/**
	 * Sets the layout.
	 */
	set layout(layout: PositronDataToolLayout) {
		if (layout !== this._layout) {
			this._layout = layout;
			this._onDidChangeLayoutEmitter.fire(this._layout);
		}
	}

	/**
	 * Gets the columns width percent.
	 */
	get columnsWidthPercent() {
		return this._columnsWidthPercent;
	}

	/**
	 * Sets the columns width percent.
	 */
	set columnsWidthPercent(columnsWidthPercent: number) {
		if (columnsWidthPercent !== this._columnsWidthPercent) {
			this._columnsWidthPercent = columnsWidthPercent;
			this._onDidChangeColumnsWidthPercentEmitter.fire(this._columnsWidthPercent);
		}
	}

	/**
	 * Gets the columns scroll offset.
	 */
	get columnsScrollOffset() {
		return this._columnsScrollOffset;
	}

	/**
	 * Sets the columns scroll offset.
	 */
	set columnsScrollOffset(columnsScrollOffset: number) {
		console.log(`************************* setting column scroll offset to ${columnsScrollOffset}`);
		if (columnsScrollOffset !== this._columnsScrollOffset) {
			this._columnsScrollOffset = columnsScrollOffset;
			this._onDidChangeColumnsScrollOffsetEmitter.fire(this._columnsScrollOffset);
		}
	}

	/**
	 * Gets the rows scroll offset.
	 */
	get rowsScrollOffset() {
		return this._rowsScrollOffset;
	}

	/**
	 * Sets the rows scroll offset.
	 */
	set rowsScrollOffset(rowsScrollOffset: number) {
		if (rowsScrollOffset !== this._rowsScrollOffset) {
			this._rowsScrollOffset = rowsScrollOffset;
			this._onDidChangeRowsScrollOffsetEmitter.fire(this._rowsScrollOffset);
		}
	}

	/**
	 * onDidChangeLayout event.
	 */
	readonly onDidChangeLayout = this._onDidChangeLayoutEmitter.event;

	/**
	 * onDidChangeColumnsWidthPercent event.
	 */
	readonly onDidChangeColumnsWidthPercent = this._onDidChangeColumnsWidthPercentEmitter.event;

	/**
	 * onDidChangeColumnsScrollOffset event.
	 */
	readonly onDidChangeColumnsScrollOffset = this._onDidChangeColumnsScrollOffsetEmitter.event;

	/**
	 * onDidChangeRowsScrollOffset event.
	 */
	readonly onDidChangeRowsScrollOffset = this._onDidChangeRowsScrollOffsetEmitter.event;

	//#endregion IPositronDataToolInstance Implementation
}

// Register the Positron data tool service.
registerSingleton(IPositronDataToolService, PositronDataToolService, InstantiationType.Delayed);
