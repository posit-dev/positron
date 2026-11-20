/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CustomPositronLayoutDescription } from '../../common/positronCustomViews.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../../base/common/event.js';
import { ISerializableView, IViewSize } from '../../../../../base/browser/ui/grid/gridview.js';
import { PanelAlignment } from '../../../layout/browser/layoutService.js';

export const IPositronLayoutService = createDecorator<IPositronLayoutService>('positronLayoutService');

/**
 * IPositronLayoutService interface.
 */
export interface IPositronLayoutService {
	/**
	 * Needed for service branding in dependency injector.
	 */
	readonly _serviceBrand: undefined;

	/**
	 * Placeholder that gets called to "initialize" the PositronLayoutService.
	 */
	initialize(): void;

	/**
	 * The command id of the named layout the window is in, such as
	 * `workbench.action.positronSimplifiedLayout`. Set when a named layout is applied, and
	 * updated when the user moves views or shows or hides parts: it is then the named
	 * layout the window matches, or undefined when it matches none.
	 */
	readonly currentLayoutId: string | undefined;

	/**
	 * Fires when {@link currentLayoutId} changes.
	 */
	readonly onDidChangeCurrentLayout: Event<string | undefined>;

	/**
	 * Set the layout for the editor.
	 * @param layout Layout description to set.
	 * @param layoutId The command id of the named layout, remembered as
	 * {@link currentLayoutId}. Leave it out for a layout that has no name.
	 */
	setLayout(layout: CustomPositronLayoutDescription, layoutId?: string): void;

}

export type PartViewInfo = {
	partView: ISerializableView;
	currentSize: IViewSize;
	alignment?: PanelAlignment;
	hidden: boolean;
	hideFn: (hidden: boolean, skipLayout?: boolean | undefined) => void;
};
