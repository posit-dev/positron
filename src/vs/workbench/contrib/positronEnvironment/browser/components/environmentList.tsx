/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./environmentList';
import * as React from 'react';
import { PropsWithChildren, useEffect } from 'react'; // eslint-disable-line no-duplicate-imports
import { generateUuid } from 'vs/base/common/uuid';
import { PositronList } from 'vs/base/browser/ui/positronList/positronList';
import { TestItem } from 'vs/workbench/contrib/positronEnvironment/browser/components/testItem';
import { usePositronEnvironmentContext } from 'vs/workbench/contrib/positronEnvironment/browser/positronEnvironmentContext';

// TODO@softwarenerd - TEST MODE
import { IListItem } from 'vs/base/common/positronStuff';
import { DisposableStore } from 'vs/base/common/lifecycle';

/**
 * TestListItem class.
 */
class TestListItem implements IListItem {
	//#region Private Properties

	private readonly _id = generateUuid();
	private readonly _height;

	//#endregion Private Properties

	//#region Public Properties

	get id() {
		return this._id;
	}

	get height() {
		return this._height;
	}

	get element() {
		return (
			<TestItem entry={this._entryNumber} />
		);
	}

	//#endregion Public Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param _entryNumber The entry number of the
	 */
	constructor(private readonly _entryNumber: number) {
		// As a test of variable height entries, even entries are 50px in height and odd entries are 25px in height.
		this._height = _entryNumber % 2 ? 50 : 25;
	}

	//#endregion Constructor
}

/**
 * EnvironmentListProps interface.
 */
export interface EnvironmentListProps {
	height: number;
}

/**
 * EnvironmentList component.
 * @param props A PositronEnvironmentProps that contains the component properties.
 * @returns The rendered component.
 */
export const EnvironmentList = (props: PropsWithChildren<EnvironmentListProps>) => {
	// Hooks.
	const positronEnvironmentContext = usePositronEnvironmentContext();

	// If there isn't a current language environment, render the list accordingly.
	if (!positronEnvironmentContext.currentLanguageEnvironment) {
		return (
			<div className='no-language-environment-message'>No Language Environment</div>
		);
	}

	// Render.
	return (
		<PositronList height={props.height} listItemsProvider={positronEnvironmentContext.currentLanguageEnvironment} />
	);
};
