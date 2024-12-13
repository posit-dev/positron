/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CustomPositronLayoutDescription } from '../../common/positronCustomViews.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
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
	 * Set the layout for the editor.
	 * @param layout Layout description to set.
	 */
	setLayout(layout: CustomPositronLayoutDescription): void;

}

export type PartViewInfo = {
	partView: ISerializableView;
	currentSize: IViewSize;
	alignment?: PanelAlignment;
	hidden: boolean;
	hideFn: (hidden: boolean, skipLayout?: boolean | undefined) => void;
};
