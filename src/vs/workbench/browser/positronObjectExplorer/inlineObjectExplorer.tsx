/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './inlineObjectExplorer.css';

// React.
import { useEffect, useState } from 'react';

// Other dependencies.
import { localize } from '../../../nls.js';
import { combinedDisposable } from '../../../base/common/lifecycle.js';
import { onUnexpectedError } from '../../../base/common/errors.js';
import { positronClassNames } from '../../../base/common/positronUtilities.js';
import { usePositronReactServicesContext } from '../../../base/browser/positronReactRendererContext.js';
import { PositronObjectExplorer } from './positronObjectExplorer.js';
import { OBJECT_EXPLORER_ROW_HEIGHT } from './classes/objectExplorerTreeInstance.js';
import { IPositronObjectExplorerInstance } from '../../services/positronObjectExplorer/browser/interfaces/positronObjectExplorerInstance.js';

/**
 * The tallest an inline object explorer grows, in pixels.
 */
export const INLINE_OBJECT_EXPLORER_MAX_HEIGHT = 300;

/**
 * The height of everything but the tree's rows: the inline header, the column headers, the status
 * bar, and the borders.
 */
export const INLINE_OBJECT_EXPLORER_CHROME_HEIGHT = 24 + 24 + 24 + 2;

/**
 * Gets the height of an inline object explorer showing a number of rows.
 */
export function inlineObjectExplorerHeight(rows: number): number {
	return Math.min(INLINE_OBJECT_EXPLORER_MAX_HEIGHT, INLINE_OBJECT_EXPLORER_CHROME_HEIGHT + rows * OBJECT_EXPLORER_ROW_HEIGHT);
}

type InlineObjectExplorerState =
	| { status: 'loading' }
	| { status: 'connected'; instance: IPositronObjectExplorerInstance }
	| { status: 'disconnected' }
	| { status: 'error'; message: string };

/**
 * InlineObjectExplorerProps interface.
 */
interface InlineObjectExplorerProps {
	readonly commId: string;
	readonly title: string;
	/** Whether to leave room on the header's right for a notebook's floating output actions. */
	readonly clearsOutputActions?: boolean;
	/** Called instead of showing an error when the object explorer can't be found quickly. */
	readonly onFallback?: () => void;
	/** Called when the height the explorer wants changes. */
	readonly onDidChangeHeight?: (height: number) => void;
}

/**
 * InlineObjectExplorer component. A compact object explorer shown in a cell's output, with an
 * action that opens the object in a full Object Explorer editor.
 */
export function InlineObjectExplorer({ commId, title, clearsOutputActions, onFallback, onDidChangeHeight }: InlineObjectExplorerProps) {
	const services = usePositronReactServicesContext();
	const [state, setState] = useState<InlineObjectExplorerState>({ status: 'loading' });
	const [rows, setRows] = useState(1);

	// Find the instance the runtime registered for the comm. With a fallback available, give up
	// quickly: the comm registers within milliseconds of execution, so a missing one (e.g. after
	// the notebook was reopened) is not coming.
	useEffect(() => {
		let cancelled = false;
		services.positronObjectExplorerService.getInstanceAsync(commId, onFallback ? 500 : 10_000).then(instance => {
			if (cancelled) {
				return;
			}
			if (!instance) {
				if (onFallback) {
					onFallback();
				} else {
					setState({ status: 'error', message: localize('positron.objectExplorer.inlineNotFound', "Object explorer not found. Re-run the cell to view the object.") });
				}
			} else {
				setState(instance.client.status === 'disconnected' ? { status: 'disconnected' } : { status: 'connected', instance });
			}
		}, onUnexpectedError);
		return () => {
			cancelled = true;
		};
	}, [commId, onFallback, services.positronObjectExplorerService]);

	// While shown, keep the instance updating, and size to its rows.
	useEffect(() => {
		if (state.status !== 'connected') {
			return;
		}
		const { instance } = state;
		instance.setVisible(true);
		setRows(instance.treeInstance.rows);
		const disposable = combinedDisposable(
			instance.onDidClose(() => setState({ status: 'disconnected' })),
			instance.treeInstance.onDidUpdate(() => setRows(instance.treeInstance.rows))
		);
		return () => {
			disposable.dispose();
			instance.setVisible(false);
		};
	}, [state]);

	const height = state.status === 'connected' ? inlineObjectExplorerHeight(rows) : INLINE_OBJECT_EXPLORER_CHROME_HEIGHT;
	useEffect(() => onDidChangeHeight?.(height), [height, onDidChangeHeight]);

	const openLabel = localize('positron.objectExplorer.openInObjectExplorer', "Open in Object Explorer");

	return (
		<div
			className={positronClassNames('inline-object-explorer', { 'clears-output-actions': !!clearsOutputActions })}
			data-testid='inline-object-explorer'
			style={{ height }}
		>
			<div className='inline-object-explorer-header'>
				<span className='inline-object-explorer-title'>{title}</span>
				{state.status === 'connected' &&
					<button
						aria-label={openLabel}
						className='inline-object-explorer-open-button'
						title={openLabel}
						type='button'
						onClick={() => state.instance.client.openObjectExplorer().catch(onUnexpectedError)}
					>
						<span className='codicon codicon-list-tree' />
						<span className='inline-object-explorer-open-button-label'>{openLabel}</span>
					</button>
				}
			</div>
			<div className='inline-object-explorer-content'>
				{state.status === 'loading' &&
					<div className='inline-object-explorer-message'>
						<span className='codicon codicon-loading codicon-modifier-spin' />
						{localize('positron.objectExplorer.inlineLoading', "Loading...")}
					</div>
				}
				{state.status === 'connected' && <PositronObjectExplorer instance={state.instance} />}
				{state.status === 'disconnected' &&
					<div className='inline-object-explorer-message'>
						<span className='codicon codicon-warning' />
						{localize('positron.objectExplorer.inlineUnavailable', "Object unavailable. Re-run the cell to view it.")}
					</div>
				}
				{state.status === 'error' &&
					<div className='inline-object-explorer-message'>
						<span className='codicon codicon-error' />
						{state.message}
					</div>
				}
			</div>
		</div>
	);
}
