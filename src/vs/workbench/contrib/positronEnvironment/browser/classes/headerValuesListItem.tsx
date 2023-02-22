/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { IListItem } from 'vs/base/common/positronStuff';
import { HeaderValues } from 'vs/workbench/contrib/positronEnvironment/browser/components/headerValues';

/**
 * HeaderValuesListItem class.
 */
export class HeaderValuesListItem implements IListItem {
	/**
	 * Gets the ID.
	 */
	readonly id = '9805e7dc-a379-4a04-ae0d-2542f5fdd003';

	/**
	 * Gets the height.
	 */
	readonly height = 24;

	/**
	 * Gets the element.
	 */
	readonly element = <HeaderValues />;
}
