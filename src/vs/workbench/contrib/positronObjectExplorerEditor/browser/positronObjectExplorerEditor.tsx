/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronObjectExplorerEditor.css';

// Other dependencies.
import * as DOM from '../../../../base/browser/dom.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { PositronReactRenderer } from '../../../../base/browser/positronReactRenderer.js';
import { PositronObjectExplorer } from '../../../browser/positronObjectExplorer/positronObjectExplorer.js';
import { PositronObjectExplorerUri } from '../../../services/positronObjectExplorer/common/positronObjectExplorerUri.js';
import { IPositronObjectExplorerService } from '../../../services/positronObjectExplorer/browser/interfaces/positronObjectExplorerService.js';
import { IPositronObjectExplorerInstance } from '../../../services/positronObjectExplorer/browser/interfaces/positronObjectExplorerInstance.js';
import { PositronDataExplorerClosed, PositronDataExplorerClosedStatus } from '../../../browser/positronDataExplorer/components/dataExplorerClosed/positronDataExplorerClosed.js';
import { PositronObjectExplorerEditorInput } from './positronObjectExplorerEditorInput.js';
import { POSITRON_OBJECT_EXPLORER_IS_FILE_BACKED, POSITRON_OBJECT_EXPLORER_IS_FOCUSED } from './positronObjectExplorerContextKeys.js';

/**
 * How long to wait for the instance behind an editor to be registered.
 */
const INSTANCE_TIMEOUT_MS = 10_000;

/**
 * PositronObjectExplorerEditor class.
 */
export class PositronObjectExplorerEditor extends EditorPane {
	private readonly _container: HTMLElement;
	private _renderer?: PositronReactRenderer;

	// The instance this editor shows, and whether this editor counts toward its visibility.
	private _instance?: IPositronObjectExplorerInstance;
	private _countedVisible = false;

	private readonly _isFocusedContextKey: IContextKey<boolean>;
	private readonly _isFileBackedContextKey: IContextKey<boolean>;

	constructor(
		group: IEditorGroup,
		@IPositronObjectExplorerService private readonly _objectExplorerService: IPositronObjectExplorerService,
		@IStorageService storageService: IStorageService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
	) {
		super(PositronObjectExplorerEditorInput.EditorID, group, telemetryService, themeService, storageService);

		this._container = DOM.$('.positron-object-explorer-container');

		this._isFocusedContextKey = POSITRON_OBJECT_EXPLORER_IS_FOCUSED.bindTo(group.scopedContextKeyService);
		this._isFileBackedContextKey = POSITRON_OBJECT_EXPLORER_IS_FILE_BACKED.bindTo(group.scopedContextKeyService);

		const focusTracker = this._register(DOM.trackFocus(this._container));
		this._register(focusTracker.onDidFocus(() => this._isFocusedContextKey.set(true)));
		this._register(focusTracker.onDidBlur(() => this._isFocusedContextKey.set(false)));
	}

	override dispose(): void {
		this.disposeRenderer();
		super.dispose();
	}

	/**
	 * The instance this editor shows, if any.
	 */
	get instance(): IPositronObjectExplorerInstance | undefined {
		return this._instance;
	}

	protected override createEditor(parent: HTMLElement): void {
		parent.appendChild(this._container);
	}

	override async setInput(
		input: PositronObjectExplorerEditorInput,
		options: IEditorOptions | undefined,
		context: IEditorOpenContext,
		token: CancellationToken
	): Promise<void> {
		await super.setInput(input, options, context, token);

		const identifier = PositronObjectExplorerUri.parse(input.resource);
		const instance = identifier ?
			await this._objectExplorerService.getInstanceAsync(identifier, INSTANCE_TIMEOUT_MS) :
			undefined;
		if (token.isCancellationRequested || this._store.isDisposed || this.input !== input) {
			return;
		}

		this.releaseInstance();
		this.disposeRenderer();
		this._renderer = new PositronReactRenderer(this._container);
		const onClose = () => this.group.closeEditor(input);

		if (!instance) {
			this._isFileBackedContextKey.reset();
			this._renderer.render(
				<PositronDataExplorerClosed closedReason={PositronDataExplorerClosedStatus.UNAVAILABLE} onClose={onClose} />
			);
			return;
		}

		this._instance = instance;
		this._isFileBackedContextKey.set(instance.isFileBacked);
		input.setTitle(instance.title);
		this._renderer.register(instance.onDidChangeTitle(title => input.setTitle(title)));
		this._renderer.render(<PositronObjectExplorer instance={instance} onClose={onClose} />);

		if (this.isVisible()) {
			this._countedVisible = true;
			instance.setVisible(true);
		}
	}

	override clearInput(): void {
		this.releaseInstance();
		this.disposeRenderer();
		this._isFileBackedContextKey.reset();
		super.clearInput();
	}

	protected override setEditorVisible(visible: boolean): void {
		super.setEditorVisible(visible);
		if (this._instance && visible !== this._countedVisible) {
			this._countedVisible = visible;
			this._instance.setVisible(visible);
		}
	}

	override focus(): void {
		super.focus();
		this._instance?.activeTreeInstance.requestFocus();
	}

	/**
	 * Shows the context menu for the row at the cursor.
	 */
	async showContextMenuAtCursor(): Promise<void> {
		const treeInstance = this._instance?.activeTreeInstance;
		const waffle = this._container.querySelector<HTMLElement>('.data-grid-waffle');
		if (treeInstance && waffle) {
			await treeInstance.showCellContextMenu(0, treeInstance.cursorRowIndex, waffle);
		}
	}

	override layout(dimension: DOM.Dimension): void {
		DOM.size(this._container, dimension.width, dimension.height);
	}

	/**
	 * Stops counting this editor toward the visibility of its instance and forgets it.
	 */
	private releaseInstance(): void {
		if (this._instance && this._countedVisible) {
			this._instance.setVisible(false);
		}
		this._instance = undefined;
		this._countedVisible = false;
	}

	private disposeRenderer(): void {
		this._renderer?.dispose();
		this._renderer = undefined;
	}
}
