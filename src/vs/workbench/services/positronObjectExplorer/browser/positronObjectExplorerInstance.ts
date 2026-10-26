/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { URI } from '../../../../base/common/uri.js';
import { Emitter } from '../../../../base/common/event.js';
import { disposableTimeout } from '../../../../base/common/async.js';
import { onUnexpectedError } from '../../../../base/common/errors.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IEditorService } from '../../editor/common/editorService.js';
import { IViewsService } from '../../views/common/viewsService.js';
import { IPositronConsoleService, POSITRON_CONSOLE_VIEW_ID } from '../../positronConsole/browser/interfaces/positronConsoleService.js';
import { IPositronDataExplorerService } from '../../positronDataExplorer/browser/interfaces/positronDataExplorerService.js';
import { PositronObjectExplorerUri } from '../common/positronObjectExplorerUri.js';
import { IPositronObjectExplorerInstance } from './interfaces/positronObjectExplorerInstance.js';
import { OBJECT_EXPLORER_MAX_DEPTH_KEY, objectExplorerMaxDepth } from './positronObjectExplorerConfiguration.js';
import { ObjectExplorerClientInstance } from '../../languageRuntime/common/languageRuntimeObjectExplorerClient.js';
import { ObjectExplorerColumnWidths, ObjectExplorerSearchResults, ObjectExplorerTreeInstance } from '../../../browser/positronObjectExplorer/classes/objectExplorerTreeInstance.js';

/**
 * The most matches a search returns.
 */
const SEARCH_MAX_RESULTS = 1000;

/**
 * How long to wait after the search text changes before searching. Short queries match so much
 * that they get a longer wait, in case the user is still typing.
 */
const SEARCH_DEBOUNCE_SHORT_MS = 400;
const SEARCH_DEBOUNCE_LONG_MS = 1000;
const SEARCH_SHORT_QUERY_LENGTH = 3;

/**
 * PositronObjectExplorerInstance class. One explored object, shown by any number of editors.
 */
export class PositronObjectExplorerInstance extends Disposable implements IPositronObjectExplorerInstance {
	private _title: string;

	// The number of editors showing this instance.
	private _visibleEditorCount = 0;

	// Whether a reload was requested while no editor was showing the instance.
	private _pendingReload = false;

	// The search text, and the search that is pending or in flight for it.
	private _searchText = '';
	private _searchSequence = 0;
	private readonly _searchTimer = this._register(new MutableDisposable());

	// The results of the current search, and the tree showing them.
	private _searchResults: ObjectExplorerSearchResults | undefined;
	private readonly _searchTree = this._register(new MutableDisposable<ObjectExplorerTreeInstance>());

	readonly treeInstance: ObjectExplorerTreeInstance;
	readonly columnWidths: ObjectExplorerColumnWidths;

	private readonly _onDidChangeTitleEmitter = this._register(new Emitter<string>());
	private readonly _onDidCloseEmitter = this._register(new Emitter<void>());
	private readonly _onDidChangeSearchEmitter = this._register(new Emitter<void>());
	private readonly _onDidRequestSearchFocusEmitter = this._register(new Emitter<void>());

	readonly onDidChangeTitle = this._onDidChangeTitleEmitter.event;
	readonly onDidClose = this._onDidCloseEmitter.event;
	readonly onDidChangeSearch = this._onDidChangeSearchEmitter.event;
	readonly onDidRequestSearchFocus = this._onDidRequestSearchFocusEmitter.event;

	/**
	 * Constructor.
	 * @param languageName The name of the language of the runtime serving the object.
	 * @param client The client. The instance takes ownership of it.
	 * @param isInline Whether the instance backs an inline view whose comm the runtime owns.
	 * @param fileUri The file the object was read from, for file-backed instances.
	 * @param sessionId The runtime session serving the object, for runtime-backed instances.
	 */
	constructor(
		readonly languageName: string,
		readonly client: ObjectExplorerClientInstance,
		readonly isInline: boolean,
		readonly fileUri: URI | undefined,
		private readonly _sessionId: string | undefined,
		@IClipboardService private readonly _clipboardService: IClipboardService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IEditorService private readonly _editorService: IEditorService,
		@IHoverService private readonly _hoverService: IHoverService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IPositronDataExplorerService private readonly _dataExplorerService: IPositronDataExplorerService,
		@IPositronConsoleService private readonly _consoleService: IPositronConsoleService,
		@IViewsService private readonly _viewsService: IViewsService,
	) {
		super();

		this._register(this.client);
		this._title = this.client.cachedState?.title ?? localize('positron.objectExplorer.defaultTitle', "Object");

		this.columnWidths = this._register(new ObjectExplorerColumnWidths());
		this.treeInstance = this._register(this.createTree(undefined));

		this._register(this.client.onDidClose(() => this._onDidCloseEmitter.fire()));
		this._register(this.client.onDidUpdate(() => this.reloadWhenVisible()));
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			// Whether a node can be expanded, and how deep a search goes, depend on the maximum depth.
			if (e.affectsConfiguration(OBJECT_EXPLORER_MAX_DEPTH_KEY)) {
				this.reloadWhenVisible();
			}
		}));

		if (!this.client.cachedState) {
			this.client.getState().then(state => this.setTitle(state.title), onUnexpectedError);
		}
	}

	get isFileBacked(): boolean {
		return this.fileUri !== undefined;
	}

	get title(): string {
		return this._title;
	}

	get activeTreeInstance(): ObjectExplorerTreeInstance {
		return this._searchTree.value ?? this.treeInstance;
	}

	get searchText(): string {
		return this._searchText;
	}

	get searchResults(): ObjectExplorerSearchResults | undefined {
		return this._searchResults;
	}

	async refresh(): Promise<void> {
		this._pendingReload = false;
		await Promise.all([
			this.treeInstance.reloadAll(),
			this._searchText ? this.search() : undefined
		]);
	}

	requestFocus(): void {
		this._editorService.openEditor({ resource: PositronObjectExplorerUri.generate(this.client.identifier) });
	}

	setVisible(visible: boolean): void {
		if (visible) {
			this._visibleEditorCount++;
			if (this._visibleEditorCount === 1 && this._pendingReload) {
				this.refresh().catch(onUnexpectedError);
			}
		} else {
			this._visibleEditorCount = Math.max(0, this._visibleEditorCount - 1);
		}
	}

	async copyValueAtCursor(): Promise<void> {
		const tree = this.activeTreeInstance;
		await tree.copyValue(tree.cursorRowIndex);
	}

	async copyAccessorAtCursor(): Promise<void> {
		const tree = this.activeTreeInstance;
		await tree.copyAccessor(tree.cursorRowIndex);
	}

	setSearchText(text: string): void {
		if (text === this._searchText) {
			return;
		}
		this._searchText = text;

		// Supersede any search that is pending or in flight.
		this._searchSequence++;
		this._searchTimer.clear();

		if (!text) {
			// Listeners stop showing the search tree before it is disposed.
			this._searchResults = undefined;
			const searchTree = this._searchTree.clearAndLeak();
			this._onDidChangeSearchEmitter.fire();
			searchTree?.dispose();
			return;
		}

		const delay = text.length < SEARCH_SHORT_QUERY_LENGTH ? SEARCH_DEBOUNCE_LONG_MS : SEARCH_DEBOUNCE_SHORT_MS;
		this._searchTimer.value = disposableTimeout(() => this.search().catch(onUnexpectedError), delay);
	}

	clearSearch(): void {
		this.setSearchText('');

		// Clearing the search swaps the tree back in; focus it once it has rendered.
		setTimeout(() => this.treeInstance.requestFocus());
	}

	focusSearch(): void {
		this._onDidRequestSearchFocusEmitter.fire();
	}

	/**
	 * Searches for the search text and shows the results, unless the text changes meanwhile.
	 */
	private async search(): Promise<void> {
		const sequence = ++this._searchSequence;
		const query = this._searchText;
		try {
			const [root, result] = await Promise.all([
				this.client.getRoot(),
				this.client.search(query, objectExplorerMaxDepth(this._configurationService), SEARCH_MAX_RESULTS)
			]);
			if (sequence !== this._searchSequence) {
				return;
			}
			this._searchResults = { query, root, result };
			const previousTree = this._searchTree.clearAndLeak();
			this._searchTree.value = this.createTree(this._searchResults);
			this._onDidChangeSearchEmitter.fire();
			previousTree?.dispose();
		} catch (err) {
			if (sequence === this._searchSequence) {
				this._notificationService.error(localize(
					'positron.objectExplorer.searchFailed',
					"Could not search: {0}",
					err instanceof Error ? err.message : String(err?.message ?? err)
				));
			}
		}
	}

	/**
	 * Creates a tree showing the explored object, or the results of a search.
	 */
	private createTree(search: ObjectExplorerSearchResults | undefined): ObjectExplorerTreeInstance {
		return new ObjectExplorerTreeInstance(
			this.client,
			this.columnWidths,
			() => objectExplorerMaxDepth(this._configurationService),
			search,
			() => this.clearSearch(),
			this._sessionId ? text => this.sendToConsole(text).catch(onUnexpectedError) : undefined,
			this._clipboardService,
			this._notificationService,
			this._editorService,
			this._dataExplorerService,
			this._hoverService,
			this._configurationService
		);
	}

	/**
	 * Shows the console of the session serving the object and pastes text into its input.
	 */
	private async sendToConsole(text: string): Promise<void> {
		const consoleInstance = this._consoleService.positronConsoleInstances.find(c => c.sessionId === this._sessionId);
		if (!consoleInstance) {
			return;
		}
		this._consoleService.setActivePositronConsoleSession(consoleInstance.sessionId);
		await this._viewsService.openView(POSITRON_CONSOLE_VIEW_ID, false);
		consoleInstance.pasteText(text);
	}

	/**
	 * Reloads the tree now if an editor shows it; otherwise, the next time one does.
	 */
	private reloadWhenVisible(): void {
		if (this._visibleEditorCount > 0) {
			this.refresh().catch(onUnexpectedError);
		} else {
			this._pendingReload = true;
		}
	}

	private setTitle(title: string): void {
		if (title !== this._title) {
			this._title = title;
			this._onDidChangeTitleEmitter.fire(title);
		}
	}
}
