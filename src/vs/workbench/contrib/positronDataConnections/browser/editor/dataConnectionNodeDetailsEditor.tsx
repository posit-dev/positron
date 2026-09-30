/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Other dependencies.
import * as DOM from '../../../../../base/browser/dom.js';
import { localize } from '../../../../../nls.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { PositronReactRenderer } from '../../../../../base/browser/positronReactRenderer.js';
import { EditorExtensions, IEditorOpenContext } from '../../../../common/editor.js';
import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../../browser/editor.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { IDataConnectionNodeDetailsDTO } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDTOs.js';
import { DataConnectionNodeDetailsPage } from './dataConnectionNodeDetailsPage.js';
import { DataConnectionNodeDetailsEditorInput, IDataConnectionNodeDetailsTarget } from './dataConnectionNodeDetailsEditorInput.js';

/**
 * DataConnectionNodeDetailsEditor class.
 * The editor pane for a data connection node's details, which mounts the
 * DataConnectionNodeDetailsPage React component into an editor tab.
 */
export class DataConnectionNodeDetailsEditor extends EditorPane {
	//#region Private Properties

	/**
	 * The container element the React component is rendered into.
	 */
	private readonly _container: HTMLElement;

	/**
	 * The React renderer for the current input, if an input is set.
	 */
	private _reactRenderer?: PositronReactRenderer;

	//#endregion Private Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param group The editor group this pane belongs to.
	 * @param storageService The storage service.
	 * @param telemetryService The telemetry service.
	 * @param themeService The theme service.
	 */
	constructor(
		group: IEditorGroup,
		@IStorageService storageService: IStorageService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
	) {
		// Call the base class's constructor.
		super(DataConnectionNodeDetailsEditorInput.EditorID, group, telemetryService, themeService, storageService);

		// Create the container. It is focusable, but out of the tab order, so that focusing the
		// editor lands on the page rather than nowhere.
		this._container = DOM.$('.data-connection-node-details-editor-container');
		this._container.tabIndex = -1;
	}

	//#endregion Constructor

	//#region EditorPane Overrides

	/**
	 * Creates the editor.
	 * @param parent The parent element.
	 */
	protected override createEditor(parent: HTMLElement): void {
		parent.appendChild(this._container);
	}

	/**
	 * Sets the input.
	 * @param input The input.
	 * @param options The editor options.
	 * @param context The editor open context.
	 * @param token The cancellation token.
	 */
	override async setInput(
		input: DataConnectionNodeDetailsEditorInput,
		options: IEditorOptions | undefined,
		context: IEditorOpenContext,
		token: CancellationToken,
	): Promise<void> {
		// Render the page for the new input.
		this.disposeReactRenderer();
		this._reactRenderer = new PositronReactRenderer(this._container);
		this._reactRenderer.render(<DataConnectionNodeDetailsPage input={input} />);

		// Call the base class's method.
		await super.setInput(input, options, context, token);
	}

	/**
	 * Clears the input.
	 */
	override clearInput(): void {
		this.disposeReactRenderer();
		super.clearInput();
	}

	/**
	 * Focuses the editor.
	 */
	override focus(): void {
		this._container.focus();
	}

	/**
	 * Lays out the editor.
	 * @param dimension The dimension.
	 */
	override layout(dimension: DOM.Dimension): void {
		DOM.size(this._container, dimension.width, dimension.height);
	}

	/**
	 * Disposes the editor.
	 */
	override dispose(): void {
		this.disposeReactRenderer();
		super.dispose();
	}

	//#endregion EditorPane Overrides

	//#region Private Methods

	/**
	 * Disposes the React renderer, unmounting the page.
	 */
	private disposeReactRenderer(): void {
		this._reactRenderer?.dispose();
		this._reactRenderer = undefined;
	}

	//#endregion Private Methods
}

/**
 * Opens the details editor for a node. When a tab for the node is already open, its details are
 * replaced with the fresh ones and that tab is shown, rather than opening a second tab for the same
 * node.
 *
 * Opens in preview mode unless `pinned` is set, so single-clicking down a list of nodes swaps one
 * italic tab's contents instead of piling up tabs, the way single-clicking files in the Explorer does.
 * Focus stays where it is (the tree), so the keyboard keeps working there.
 * @param editorService The editor service.
 * @param target The node the editor describes.
 * @param details The node's details.
 * @param pinned Whether to open the tab pinned rather than in preview mode.
 */
export async function openDataConnectionNodeDetails(
	editorService: IEditorService,
	target: IDataConnectionNodeDetailsTarget,
	details: IDataConnectionNodeDetailsDTO,
	pinned: boolean,
): Promise<void> {
	const existing = findDataConnectionNodeDetails(editorService, target.key);
	let input: DataConnectionNodeDetailsEditorInput;
	if (existing) {
		existing.setDetails(details);
		input = existing;
	} else {
		input = new DataConnectionNodeDetailsEditorInput(target, details);
	}
	// revealIfOpened: an existing tab may be in another editor group; show it there rather than
	// open the same input a second time in the active group.
	await editorService.openEditor(input, { pinned, preserveFocus: true, revealIfOpened: true });
}

/**
 * Keeps an open details tab for a node open, taking it out of preview mode, without fetching its
 * details again -- for a double-click that lands while its first click's preview-mode open is still
 * settling, when the tab's details are already the freshest there are.
 * @param editorService The editor service.
 * @param key The node's key (see IDataConnectionNodeDetailsTarget.key).
 * @returns Whether there was such a tab to pin.
 */
export async function pinDataConnectionNodeDetails(editorService: IEditorService, key: string): Promise<boolean> {
	const existing = findDataConnectionNodeDetails(editorService, key);
	if (!existing) {
		return false;
	}
	await editorService.openEditor(existing, { pinned: true, preserveFocus: true, revealIfOpened: true });
	return true;
}

/**
 * Finds the open details tab for a node, in any editor group.
 * @param editorService The editor service.
 * @param key The node's key (see IDataConnectionNodeDetailsTarget.key).
 */
function findDataConnectionNodeDetails(editorService: IEditorService, key: string): DataConnectionNodeDetailsEditorInput | undefined {
	return editorService.editors.find((editor): editor is DataConnectionNodeDetailsEditorInput =>
		editor instanceof DataConnectionNodeDetailsEditorInput && editor.target.key === key
	);
}

/**
 * Registers the data connection node details editor pane. There is no editor resolver entry or
 * serializer: the editor is only ever opened from the Data Connections tree, and a details tab is a
 * snapshot of a live connection's node, so it is not restored across a window reload.
 */
export function registerDataConnectionNodeDetailsEditor(): void {
	Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
		EditorPaneDescriptor.create(
			DataConnectionNodeDetailsEditor,
			DataConnectionNodeDetailsEditorInput.EditorID,
			localize('positron.dataConnections.nodeDetailsEditor', "Data Connection Details Editor")
		),
		[
			new SyncDescriptor(DataConnectionNodeDetailsEditorInput)
		]
	);
}
