/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronObjectExplorer.css';

// React.
import { useEffect, useState } from 'react';

// Other dependencies.
import { localize } from '../../../nls.js';
import { combinedDisposable } from '../../../base/common/lifecycle.js';
import { PositronTree } from '../positronTree/positronTree.js';
import { ObjectExplorerStatusBar } from './components/objectExplorerStatusBar.js';
import { ObjectExplorerColumnHeaders } from './components/objectExplorerColumnHeaders.js';
import { IPositronObjectExplorerInstance } from '../../services/positronObjectExplorer/browser/interfaces/positronObjectExplorerInstance.js';
import { PositronDataExplorerClosed, PositronDataExplorerClosedStatus } from '../positronDataExplorer/components/dataExplorerClosed/positronDataExplorerClosed.js';

/**
 * PositronObjectExplorerProps interface.
 */
interface PositronObjectExplorerProps {
	readonly instance: IPositronObjectExplorerInstance;
	/** Closes the view; when absent, there is no notice to close it once the object is gone. */
	readonly onClose?: () => void;
}

/**
 * PositronObjectExplorer component. The column headers, the tree, and the status bar of an
 * explored object, covered by a notice once the object is no longer available.
 */
export const PositronObjectExplorer = ({ instance, onClose }: PositronObjectExplorerProps) => {
	const [closed, setClosed] = useState(() => instance.client.status === 'disconnected');
	// The tree being shown, and a key that changes with it, since a data grid that is given another
	// instance doesn't lay it out.
	const [{ treeInstance, treeKey }, setTree] = useState(() => ({ treeInstance: instance.activeTreeInstance, treeKey: 0 }));

	useEffect(() => {
		const disposable = combinedDisposable(
			instance.onDidClose(() => setClosed(true)),
			instance.onDidChangeSearch(() => setTree(tree => ({ treeInstance: instance.activeTreeInstance, treeKey: tree.treeKey + 1 })))
		);
		return () => disposable.dispose();
	}, [instance]);

	return (
		<div className='positron-object-explorer'>
			<ObjectExplorerColumnHeaders columnWidths={instance.columnWidths} />
			<div className='object-explorer-tree'>
				<PositronTree key={treeKey} instance={treeInstance} />
			</div>
			<ObjectExplorerStatusBar
				client={instance.client}
				searchResults={treeInstance === instance.treeInstance ? undefined : instance.searchResults}
				treeInstance={treeInstance}
			/>
			{closed && onClose &&
				<PositronDataExplorerClosed
					closeButtonLabel={localize('positron.objectExplorer.close', "Close Object Explorer")}
					closedReason={PositronDataExplorerClosedStatus.UNAVAILABLE}
					onClose={onClose}
				/>
			}
		</div>
	);
};
