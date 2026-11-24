/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';
import { PaneCompositeDescriptor } from '../../../browser/panecomposite.js';
import { IProgressIndicator } from '../../../../platform/progress/common/progress.js';
import { IPaneComposite } from '../../../common/panecomposite.js';
import { ViewContainerLocation } from '../../../common/views.js';
import { SINGLE_WINDOW_PARTS } from '../../layout/browser/layoutService.js';

export const IPaneCompositePartService = createDecorator<IPaneCompositePartService>('paneCompositePartService');

export interface IPaneCompositePartService {

	readonly _serviceBrand: undefined;

	readonly onDidPaneCompositeOpen: Event<{ composite: IPaneComposite; viewContainerLocation: ViewContainerLocation }>;
	readonly onDidPaneCompositeClose: Event<{ composite: IPaneComposite; viewContainerLocation: ViewContainerLocation }>;

	getRegistryId(viewContainerLocation: ViewContainerLocation): string;

	getPartId(viewContainerLocation: ViewContainerLocation): SINGLE_WINDOW_PARTS;

	/**
	 * Opens a viewlet with the given identifier and pass keyboard focus to it if specified.
	 */
	openPaneComposite(id: string | undefined, viewContainerLocation: ViewContainerLocation, focus?: boolean): Promise<IPaneComposite | undefined>;

	/**
	 * Returns the current active viewlet if any.
	 */
	getActivePaneComposite(viewContainerLocation: ViewContainerLocation): IPaneComposite | undefined;

	/**
	 * Returns the viewlet by id.
	 */
	getPaneComposite(id: string, viewContainerLocation: ViewContainerLocation): PaneCompositeDescriptor | undefined;

	/**
	 * Returns all enabled viewlets
	 */
	getPaneComposites(viewContainerLocation: ViewContainerLocation): PaneCompositeDescriptor[];

	/**
	 * Returns id of pinned view containers following the visual order.
	 */
	getPinnedPaneCompositeIds(viewContainerLocation: ViewContainerLocation): string[];

	// --- Start Positron ---
	// The layout popover reorders tabs and activity bar items. Optional, so the other
	// implementations of this service need no change.
	/**
	 * Moves a view container's tab or activity bar item next to another one in the same
	 * place, as dragging it there would.
	 * @param id The view container to move.
	 * @param toId The view container to move it next to.
	 * @param before Whether to put it before that container, rather than after.
	 * @param viewContainerLocation Where both view containers are.
	 */
	movePaneComposite?(id: string, toId: string, before: boolean, viewContainerLocation: ViewContainerLocation): void;
	// --- End Positron ---

	/**
	 * Returns id of visible view containers following the visual order.
	 */
	getVisiblePaneCompositeIds(viewContainerLocation: ViewContainerLocation): string[];

	/**
	 * Returns id of all view containers following visual order.
	 */
	getPaneCompositeIds(viewContainerLocation: ViewContainerLocation): string[];

	/**
	 * Returns the progress indicator for the side bar.
	 */
	getProgressIndicator(id: string, viewContainerLocation: ViewContainerLocation): IProgressIndicator | undefined;

	/**
	 * Hide the active viewlet.
	 */
	hideActivePaneComposite(viewContainerLocation: ViewContainerLocation): void;

	/**
	 * Return the last active viewlet id.
	 */
	getLastActivePaneCompositeId(viewContainerLocation: ViewContainerLocation): string;
}
