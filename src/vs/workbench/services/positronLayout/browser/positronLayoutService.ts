/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IPositronLayoutService } from './interfaces/positronLayoutService.js';
import { CustomPositronLayoutDescription, KnownPositronLayoutParts } from '../common/positronCustomViews.js';
import { findMatchingLayout, getMatchableLayouts, LayoutState } from './layouts/layoutMatch.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IViewDescriptorService, ViewContainerLocation } from '../../../common/views.js';
import { IWorkbenchLayoutService, Parts, SINGLE_WINDOW_PARTS } from '../../layout/browser/layoutService.js';

/**
 * Where the current layout's id is saved. Profile scope, because that is where the
 * workbench saves which location each view is in.
 */
const CURRENT_LAYOUT_STORAGE_KEY = 'positron.layout.currentLayoutId';

const PART_FOR_LOCATION = new Map<ViewContainerLocation, KnownPositronLayoutParts>([
	[ViewContainerLocation.Sidebar, Parts.SIDEBAR_PART],
	[ViewContainerLocation.Panel, Parts.PANEL_PART],
	[ViewContainerLocation.AuxiliaryBar, Parts.AUXILIARYBAR_PART],
]);

class PositronLayoutService extends Disposable implements IPositronLayoutService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeCurrentLayout = this._register(new Emitter<string | undefined>());
	readonly onDidChangeCurrentLayout = this._onDidChangeCurrentLayout.event;

	private _currentLayoutId: string | undefined;

	/**
	 * True while setLayout runs. Applying a layout moves views and shows and hides
	 * parts one at a time, and the window only matches the layout once all of them
	 * are done.
	 */
	private _applyingLayout = false;

	initialize() {
		// no-op
	}

	constructor(
		@IWorkbenchLayoutService private readonly _workbenchLayoutService: IWorkbenchLayoutService,
		@IViewDescriptorService private readonly _viewDescriptorService: IViewDescriptorService,
		@IStorageService private readonly _storageService: IStorageService,
	) {
		super();

		this._currentLayoutId = this._storageService.get(CURRENT_LAYOUT_STORAGE_KEY, StorageScope.PROFILE);

		// When the user moves a view or shows or hides a part, the window may now match
		// another named layout, or none.
		this._register(this._viewDescriptorService.onDidChangeContainerLocation(() => this._matchCurrentLayout()));
		this._register(this._viewDescriptorService.onDidChangeLocation(() => this._matchCurrentLayout()));
		this._register(this._viewDescriptorService.onDidChangeContainer(() => this._matchCurrentLayout()));
		this._register(this._workbenchLayoutService.onDidChangePartVisibility(() => this._matchCurrentLayout()));
	}

	get currentLayoutId(): string | undefined {
		return this._currentLayoutId;
	}

	setLayout(layout: CustomPositronLayoutDescription, layoutId?: string) {
		this._applyingLayout = true;
		try {
			this._viewDescriptorService.loadCustomViewDescriptor(layout);
			// Run the layout service action after the view descriptor has been loaded.
			// This is needed so that the changing of the contents of the parts doesn't
			// break the currently open view container that is set by the layoutService.
			this._workbenchLayoutService.enterCustomLayout(layout);
		} finally {
			this._applyingLayout = false;
		}
		this._setCurrentLayoutId(layoutId);
	}

	private _matchCurrentLayout() {
		if (this._applyingLayout) {
			return;
		}
		this._setCurrentLayoutId(findMatchingLayout(getMatchableLayouts(), this._layoutState, this._currentLayoutId));
	}

	/**
	 * Reads the window's current shape for layoutMatch.
	 */
	private readonly _layoutState: LayoutState = {
		isPartVisible: part => this._workbenchLayoutService.isVisible(part as SINGLE_WINDOW_PARTS),
		partOfContainer: containerId => {
			const container = this._viewDescriptorService.getViewContainerById(containerId);
			const location = container ? this._viewDescriptorService.getViewContainerLocation(container) : null;
			return location === null ? undefined : PART_FOR_LOCATION.get(location);
		},
		containerOfView: viewId => this._viewDescriptorService.getViewContainerByViewId(viewId)?.id,
	};

	private _setCurrentLayoutId(layoutId: string | undefined) {
		if (layoutId === this._currentLayoutId) {
			return;
		}
		this._currentLayoutId = layoutId;
		if (layoutId === undefined) {
			this._storageService.remove(CURRENT_LAYOUT_STORAGE_KEY, StorageScope.PROFILE);
		} else {
			this._storageService.store(CURRENT_LAYOUT_STORAGE_KEY, layoutId, StorageScope.PROFILE, StorageTarget.MACHINE);
		}
		this._onDidChangeCurrentLayout.fire(layoutId);
	}
}

// Register the Positron layout service.
registerSingleton(IPositronLayoutService, PositronLayoutService, InstantiationType.Delayed);
