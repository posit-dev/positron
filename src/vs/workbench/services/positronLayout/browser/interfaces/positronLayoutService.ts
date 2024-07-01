/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CustomPositronLayoutDescription } from 'vs/workbench/services/positronLayout/common/positronCustomViews';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ISerializableView, IViewSize } from 'vs/base/browser/ui/grid/gridview';
import { PanelAlignment } from 'vs/workbench/services/layout/browser/layoutService';

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
