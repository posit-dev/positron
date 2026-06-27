/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronTreeGallery.css';

// React.
import { useEffect, useRef, useState } from 'react';

// Other dependencies.
import { PositronTree } from '../../../../browser/positronTree/positronTree.js';
import { PositronTreeInstance } from '../../../../browser/positronTree/classes/positronTreeInstance.js';
import { TreeNode } from '../../../../browser/positronTree/classes/treeNode.js';
import { SelectionCursorOptions } from '../../../../browser/positronDataGrid/classes/dataGridInstance.js';
import { controlGalleryRegistry } from '../controlGalleryRegistry.js';

const ROW_HEIGHT = 22;

/**
 * Synthetic node payload for the harness. The id is encoded in TreeNode.id; the data field
 * just carries a display label.
 */
interface DemoNode {
	readonly label: string;
}

/**
 * Builds a synthetic id like 'n.0.2.1' from a path of indices. Used as TreeNode.id and as the
 * input to the (stable, deterministic) child generator.
 */
const idForPath = (path: readonly number[]): string => 'n' + path.map(i => '.' + i).join('');

/**
 * Generates the children for a given path under the harness's depth / fan-out knobs. Returns
 * an empty array past maxDepth, otherwise fanOut children whose hasChildren reflects whether
 * they still have a level beneath them.
 */
const buildChildrenForPath = (
	path: readonly number[],
	fanOut: number,
	maxDepth: number
): readonly TreeNode<DemoNode>[] => {
	if (path.length >= maxDepth) {
		return [];
	}
	const result: TreeNode<DemoNode>[] = [];
	for (let i = 0; i < fanOut; i++) {
		const childPath = [...path, i];
		result.push({
			id: idForPath(childPath),
			data: { label: `Node ${childPath.join('.')}` },
			hasChildren: childPath.length < maxDepth,
		});
	}
	return result;
};

const pathForId = (id: string): readonly number[] => {
	// 'n.0.2.1' -> [0, 2, 1]. The 'n' prefix sentinel keeps ids visually distinct.
	const parts = id.split('.');
	return parts.slice(1).map(p => parseInt(p, 10));
};

/**
 * PositronTreeHarness component. Exercises the async tree under configurable depth, fan-out,
 * and fetch delay. Knob changes recreate the instance so any state churn (e.g. a partially
 * loaded subtree from the previous knobs) is dropped cleanly.
 */
const PositronTreeHarness = () => {
	const [maxDepth, setMaxDepth] = useState(4);
	const [fanOut, setFanOut] = useState(5);
	const [fetchDelayMs, setFetchDelayMs] = useState(300);
	const [selectionFollowsCursor, setSelectionFollowsCursor] = useState(false);

	// Re-derive the instance from the knobs. The instance owns its own state across re-renders,
	// so we use useRef + an explicit teardown rather than useState so that a knob change really
	// does swap in a fresh tree (the previous one is disposed in the cleanup).
	const knobsRef = useRef({ maxDepth, fanOut, fetchDelayMs });
	knobsRef.current = { maxDepth, fanOut, fetchDelayMs };

	const [instance, setInstance] = useState<PositronTreeInstance<DemoNode> | undefined>(undefined);

	useEffect(() => {
		// selectionFollowsCursor is a construction-time option, so the instance is recreated when
		// it toggles. When the selection follows the cursor, Enter/Space-to-select are redundant
		// and disallowed; otherwise opt them in.
		const cursorOptions: SelectionCursorOptions = selectionFollowsCursor
			? { selectionFollowsCursor: true }
			: { selectionFollowsCursor: false, enterSelects: true, spaceSelects: true };

		const tree = new PositronTreeInstance<DemoNode>({
			rowHeight: ROW_HEIGHT,
			getRoots: async () => {
				await delay(knobsRef.current.fetchDelayMs);
				return buildChildrenForPath([], knobsRef.current.fanOut, knobsRef.current.maxDepth);
			},
			getChildren: async node => {
				await delay(knobsRef.current.fetchDelayMs);
				return buildChildrenForPath(pathForId(node.id), knobsRef.current.fanOut, knobsRef.current.maxDepth);
			},
			renderNode: (visible) => (
				<span className='positron-tree-harness-label'>{visible.node.data.label}</span>
			),
			...cursorOptions,
		});
		setInstance(tree);
		return () => tree.dispose();
	}, [maxDepth, fanOut, selectionFollowsCursor]);

	if (instance === undefined) {
		return null;
	}

	return (
		<div className='positron-tree-harness'>
			<div className='positron-tree-harness-toolbar'>
				<label className='positron-tree-harness-knob'>
					<span>Max depth</span>
					<input
						max={10}
						min={1}
						type='number'
						value={maxDepth}
						onChange={e => setMaxDepth(clamp(Number(e.target.value) || 1, 1, 10))}
					/>
				</label>
				<label className='positron-tree-harness-knob'>
					<span>Fan-out</span>
					<input
						max={1000}
						min={1}
						type='number'
						value={fanOut}
						onChange={e => setFanOut(clamp(Number(e.target.value) || 1, 1, 1000))}
					/>
				</label>
				<label className='positron-tree-harness-knob'>
					<span>Fetch delay (ms)</span>
					<input
						max={5000}
						min={0}
						step={50}
						type='number'
						value={fetchDelayMs}
						onChange={e => setFetchDelayMs(clamp(Number(e.target.value) || 0, 0, 5000))}
					/>
				</label>
				<label className='positron-tree-harness-knob positron-tree-harness-checkbox'>
					<input
						checked={selectionFollowsCursor}
						type='checkbox'
						onChange={e => setSelectionFollowsCursor(e.target.checked)}
					/>
					<span>Selection follows cursor</span>
				</label>
				<button
					className='positron-tree-harness-button'
					onClick={() => void instance.refresh()}
				>
					Refresh roots
				</button>
			</div>
			<div className='positron-tree-harness-preview'>
				<PositronTree
					emptyTreeRenderer={() => <div>No nodes</div>}
					instance={instance}
					loadingRendererForInitialLoad={() => <div>Loading...</div>}
				/>
			</div>
		</div>
	);
};

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

controlGalleryRegistry.register({
	id: 'positronTree',
	label: 'Positron Tree',
	description: 'Virtualized async tree with per-node lazy children loading.',
	render: () => <PositronTreeHarness />
});
