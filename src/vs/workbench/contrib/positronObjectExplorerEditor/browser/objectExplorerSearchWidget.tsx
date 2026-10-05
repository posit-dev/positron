/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { KeyboardEvent, useEffect, useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../nls.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ActionBarFilter, ActionBarFilterHandle } from '../../../../platform/positronActionBar/browser/components/actionBarFilter.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IPositronObjectExplorerInstance } from '../../../services/positronObjectExplorer/browser/interfaces/positronObjectExplorerInstance.js';
import { PositronObjectExplorerUri } from '../../../services/positronObjectExplorer/common/positronObjectExplorerUri.js';
import { IPositronObjectExplorerService } from '../../../services/positronObjectExplorer/browser/interfaces/positronObjectExplorerService.js';

/**
 * Gets the object explorer instance shown by the active editor, if any.
 */
function activeInstance(
	editorService: IEditorService,
	objectExplorerService: IPositronObjectExplorerService
): IPositronObjectExplorerInstance | undefined {
	const resource = editorService.activeEditor?.resource;
	const identifier = resource && PositronObjectExplorerUri.parse(resource);
	return identifier ? objectExplorerService.getInstance(identifier) : undefined;
}

/**
 * ObjectExplorerSearchWidget component. The search box in the action bar of the active object
 * explorer editor.
 */
export function ObjectExplorerSearchWidget({ accessor }: { readonly accessor: ServicesAccessor }) {
	const editorService = accessor.get(IEditorService);
	const objectExplorerService = accessor.get(IPositronObjectExplorerService);
	const [instance, setInstance] = useState(() => activeInstance(editorService, objectExplorerService));

	useEffect(() => {
		const disposable = editorService.onDidActiveEditorChange(() =>
			setInstance(activeInstance(editorService, objectExplorerService)));
		return () => disposable.dispose();
	}, [editorService, objectExplorerService]);

	// Each instance has its own search text, so the box is recreated when the instance changes.
	return instance ? <ObjectExplorerSearchBox key={instance.client.identifier} instance={instance} /> : null;
}

/**
 * ObjectExplorerSearchBox component. Searches one object explorer instance.
 */
export function ObjectExplorerSearchBox({ instance }: { readonly instance: IPositronObjectExplorerInstance }) {
	const filterRef = useRef<ActionBarFilterHandle>(null);

	useEffect(() => {
		const disposable = instance.onDidRequestSearchFocus(() => filterRef.current?.focus());
		return () => disposable.dispose();
	}, [instance]);

	// Escape clears the search and returns to the tree.
	const keyDownHandler = (e: KeyboardEvent<HTMLDivElement>) => {
		if (e.key !== 'Escape') {
			return;
		}
		e.preventDefault();
		e.stopPropagation();
		filterRef.current?.setFilterText('');

		// Clearing the search swaps the tree back in; focus it once it has rendered.
		setTimeout(() => instance.treeInstance.requestFocus());
	};

	return (
		<div className='object-explorer-search' onKeyDownCapture={keyDownHandler}>
			<ActionBarFilter
				ref={filterRef}
				initialFilterText={instance.searchText}
				placeholder={localize('positron.objectExplorer.searchPlaceholder', "Search names and values")}
				width={220}
				onFilterTextChanged={text => instance.setSearchText(text)}
			/>
		</div>
	);
}
