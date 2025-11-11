/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useEffect, useRef, useState, MouseEvent, CSSProperties } from 'react';
import { useStateRef } from '../../../../../base/browser/ui/react/useStateRef.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import * as DOM from '../../../../../base/browser/dom.js';
import { ActionBar, ACTION_BAR_HEIGHT } from './schemaNavigationActionBar.js';
import { FixedSizeList as List } from 'react-window';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import './schemaNavigation.css';
import { ViewsProps } from '../positronConnections.js';
import Severity from '../../../../../base/common/severity.js';
import { localize } from '../../../../../nls.js';
import { IPositronConnectionEntry } from '../../../../services/positronConnections/common/interfaces/positronConnectionsInstance.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { usePositronConnectionsContext } from '../positronConnectionsContext.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';

const DETAILS_BAR_HEIGHT = 26;

export interface SchemaNavigationProps extends ViewsProps { }

export const SchemaNavigation = (props: React.PropsWithChildren<SchemaNavigationProps>) => {

	const services = usePositronReactServicesContext();
	const context = usePositronConnectionsContext();
	const { height, activeInstanceId, setActiveInstanceId } = props;

	// We're required to save the scroll state because browsers will automatically
	// scrollTop when an object becomes visible again.
	const [, setScrollState, scrollStateRef] = useStateRef<number[] | undefined>(undefined);
	const innerRef = useRef<HTMLElement>(undefined!);
	useEffect(() => {
		const disposableStore = new DisposableStore();
		disposableStore.add(context.reactComponentContainer.onSaveScrollPosition(() => {
			if (innerRef.current) {
				setScrollState(DOM.saveParentsScrollTop(innerRef.current));
			}
		}));
		disposableStore.add(context.reactComponentContainer.onRestoreScrollPosition(() => {
			if (scrollStateRef.current) {
				if (innerRef.current) {
					DOM.restoreParentsScrollTop(innerRef.current, scrollStateRef.current);
				}
				setScrollState(undefined);
			}
		}));
		return () => disposableStore.dispose();
	}, [context.reactComponentContainer, scrollStateRef, setScrollState]);

	const [selectedId, setSelectedId] = useState<string>();
	const activeInstance = services.positronConnectionsService.getConnections().find(item => item.id === activeInstanceId);

	const [entries, setEntries] = useState<IPositronConnectionEntry[] | undefined>(activeInstance?.getEntries() || undefined);

	useEffect(() => {
		if (!activeInstance) {
			return;
		}
		const disposableStore = new DisposableStore();

		disposableStore.add(activeInstance.onDidChangeEntries((entries) => {
			setEntries(entries);
		}));

		disposableStore.add(activeInstance.onDidChangeStatus((active) => {
			if (!active) {
				setActiveInstanceId(undefined);
			}
		}));

		activeInstance.refreshEntries().catch((e) => {
			services.notificationService.notify({
				message: localize('positron.schemaNavigation.failRefresh', 'Failed to refresh connection entries: {0}', e.message),
				severity: Severity.Error,
			});
		});

		return () => disposableStore.dispose();
	}, [activeInstance, setActiveInstanceId, services.notificationService]);

	if (!activeInstance) {
		// This should not be possible, the active instance must exist.
		return (
			<div className='positron-connections-schema-navigation'>
				<ActionBar
					{...context}
					onBack={() => props.setActiveInstanceId(undefined)}
					onDisconnect={() => { }}
					onRefresh={() => { }}
				>
				</ActionBar>
			</div>
		);
	}

	const toggleExpandHandler = (id: string) => {
		activeInstance.onToggleExpandEmitter.fire(id);
	};

	const ItemEntry = (props: ItemEntryProps) => {
		if (!entries) {
			return null;
		}

		const itemProps = entries[props.index];

		return (
			<PositronConnectionsItem
				item={itemProps}
				selected={itemProps.id === selectedId}
				style={props.style}
				onSelected={() => setSelectedId(itemProps.id)}
				onToggleExpand={toggleExpandHandler}>
			</PositronConnectionsItem>
		);
	};

	const { name, language_id, icon } = activeInstance.metadata;

	return (
		<div className='positron-connections-schema-navigation'>
			<ActionBar
				{...context}
				onBack={() => props.setActiveInstanceId(undefined)}
				onDisconnect={() => activeInstance.disconnect?.()}
				onRefresh={() => activeInstance.refresh?.()}
			>
			</ActionBar>
			<div className='connections-items-container'>
				<div className={'connections-instance-details'} style={{ height: DETAILS_BAR_HEIGHT }}>
					<div className='connection-name'>{name}</div>
					<div className='connection-language'>{languageIdToName(language_id)}</div>
					{
						icon ?
							<img className='connection-icon' src={icon}></img> :
							<div className='connection-icon'>
								<div className='codicon codicon-positron-database-connection'></div>
							</div>
					}
				</div>
				{
					entries !== undefined ?
						<List
							height={height - ACTION_BAR_HEIGHT - DETAILS_BAR_HEIGHT}
							innerRef={innerRef}
							itemCount={entries.length}
							itemKey={index => entries[index].id}
							itemSize={26}
							width={'calc(100% - 2px)'}
						/* size if the actionbar and the secondary side bar combined) */
						>
							{ItemEntry}
						</List> :
						<NoEntriesMessage
							height={height}
							onTryAgain={() => activeInstance.refresh?.()}
						/>

				}

			</div>
		</div >
	);
};

const NoEntriesMessage = ({ height, onTryAgain, timeout = 5000 }: { height: number, onTryAgain: () => void, timeout?: number }) => {
	const [failed, setFailed] = useState<boolean>(false);

	useEffect(() => {
		let t = null;
		if (!failed) {
			t = setTimeout(() => {
				setFailed(true);
			}, timeout);
		}
		return () => t ? clearTimeout(t) : undefined;
	}, [timeout, failed]);

	const onPressedTryAgain = () => {
		setFailed(false);
		onTryAgain();
	};

	return <div className='no-entries-message' style={{ height: height - ACTION_BAR_HEIGHT - DETAILS_BAR_HEIGHT }}>
		<div className={failed ? 'codicon codicon-error' : 'codicon codicon-loading animate-spin'}></div>
		<p>{
			failed ?
				localize('positron.schemaNavigation.noEntriesFailed', 'Failed to load entries') :
				localize('positron.schemaNavigation.noEntriesLoading', 'Loading entries ...')
		}
		</p>
		{
			failed ?
				<Button className='retry-button' onPressed={() => onPressedTryAgain()}>
					<div className='codicon codicon-refresh'></div>
					{localize('positron.schemaNavigation.tryAgain', 'Try again')}
				</Button> :
				null
		}
	</div >
};

interface ItemEntryProps {
	index: number;
	style: CSSProperties;
}

interface PositronConnectionsItemProps {
	item: IPositronConnectionEntry;
	style?: any;
	selected: boolean;

	/**
	 * What happens when a row is selected?
	 */
	onSelected: () => void;

	/**
	 * On toggle expand handler
	 */
	onToggleExpand(id: string): void;
}

const PositronConnectionsItem = (props: React.PropsWithChildren<PositronConnectionsItemProps>) => {

	// If the connection is not expandable, we add some more padding.
	const padding = props.item.level * 10 + (props.item.expanded === undefined ? 26 : 0);
	const [expanding, setExpanding] = useState<boolean>(false);

	const handleExpand = () => {
		setExpanding(true);
		props.onToggleExpand(props.item.id);
	};

	const iconClass = (kind?: string) => {
		if (kind) {
			switch (kind.toLowerCase()) {
				case 'table':
					return 'positron-table-connection';
				case 'view':
					return 'positron-view-connection';
				case 'database':
					return 'positron-database-connection';
				case 'schema':
					return 'positron-schema-connection';
				case 'catalog':
					return 'positron-catalog-connection';
				case 'volume':
					return 'file-symlink-directory';
				case 'field':
					switch (props.item.dtype?.toLowerCase()) {
						case 'character':
						case 'string':
						case 'varchar':
						case 'text':
							return 'positron-data-type-string';
						case 'integer':
						case 'numeric':
						case 'float':
						case 'double':
						case 'fixed':
						case 'real':
						case 'bigint':
						case 'int':
							return 'positron-data-type-number';
						case 'boolean':
						case 'bool':
							return 'positron-data-type-boolean';
						case 'date':
							return 'positron-data-type-date';
						case 'timestamp':
						case 'timestamp_ltz':
							return 'positron-data-type-date-time';
						case 'array':
							return 'positron-data-type-array';
						default:
							return 'positron-data-type-unknown';
					}
			}
		}

		return '';
	}

	const icon = (() => {
		// icon is a base64 encoded png
		if (props.item.icon) {
			return <img
				src={props.item.icon}
			>
			</img>;
		}

		return <div
			className={positronClassNames(
				'codicon',
				`codicon-${iconClass(props.item.kind)}`,
			)}
		>
		</div>
	})();

	const rowMouseDownHandler = (e: MouseEvent<HTMLElement>) => {
		// Consume the event.
		e.preventDefault();
		e.stopPropagation();

		// Handle the event.
		switch (e.button) {
			// Main button.
			case 0:
				// TODO: handle ctrl+ click, etc.
				props.onSelected();
				break;

			// Secondary button.
			case 2:
				// TODO: more options here
				props.onSelected();
				break;
		}
	};

	// props.item.expanded
	const DelayedExpandIcon = (({ expanded, expanding, delay = 200 }: { expanded: boolean | undefined; expanding: boolean; delay?: number }) => {
		const [showSpinner, setShowSpinner] = useState<boolean>(false);

		useEffect(() => {
			if (!expanding) {
				setShowSpinner(false)
				return;
			}
			const id = setTimeout(() => setShowSpinner(true), delay);
			return () => clearTimeout(id)
		}, [expanding, delay])


		if (expanded === undefined) {
			return <></>;
		}

		const className = showSpinner ?
			`codicon codicon-loading animate-spin` :
			`codicon codicon-chevron-${expanded ? 'down' : 'right'}`;

		return (
			<div
				className='expand-collapse-area'
				onClick={handleExpand}
			>
				<div className={className} />
			</div>
		)
	});

	return (
		<div
			className={positronClassNames(
				'connections-item',
				{ 'selected': props.selected }
			)}
			style={props.style}
		>
			<div className='nesting' style={{ width: `${padding}px` }}></div>
			<DelayedExpandIcon
				expanded={props.item.expanded}
				expanding={expanding}
			/>
			<div
				className='connections-details'
				onMouseDown={rowMouseDownHandler}
			>
				<span className='connections-name'>{props.item.name}</span>
				{props.item.dtype && <span className='connections-dtype'>{props.item.dtype}</span>}
				{props.item.error && <span className='connections-error codicon codicon-error' title={props.item.error}></span>}
			</div>
			<div
				className={positronClassNames(
					'connections-icon',
					{ 'disabled': props.item.preview === undefined }
				)}
				onClick={() => props.item.preview?.()}
			>
				{icon}
			</div>
		</div>
	);
};

export function languageIdToName(id?: string) {

	if (!id) {
		return '';
	}

	switch (id) {
		case 'python':
			return 'Python';
		case 'r':
			return 'R';
		default:
			return id;
	}
}
