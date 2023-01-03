/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { IListItem } from 'vs/base/common/positronStuff';
import { HeaderData } from 'vs/workbench/contrib/positronEnvironment/browser/components/headerData';

/**
 * HeaderDataListItem class.
 */
export class HeaderDataListItem implements IListItem {
	/**
	 * Gets the ID.
	 */
	readonly id = 'ad85d4a2-a131-463e-96ee-e980a86990f8';

	/**
	 * Gets the height.
	 */
	readonly height = 24;

	/**
	 * Gets the element.
	 */
	readonly element = <HeaderData />;
}
