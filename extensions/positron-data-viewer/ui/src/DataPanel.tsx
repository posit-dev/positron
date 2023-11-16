/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import './DataPanel.css';

// External libraries.
import * as React from 'react';
import * as ReactVirtual from '@tanstack/react-virtual';
import * as ReactQuery from '@tanstack/react-query';
import * as ReactTable from '@tanstack/react-table';

// Local modules.
import { DataFragment } from './DataFragment';
import { DataFetcher, ResolverLookup } from './fetchData';
import { DataSet } from './positron-data-viewer';

interface DataPanelProps {
	/**
	 * The initial batch of data to display, before additional data requests have been made
	 */
	initialData: DataSet;
	/**
	 * The number of rows to fetch at a time from the backend
	 */
	fetchSize: number;
	/**
	 * Global injected by VS Code when the extension is loaded, used to post messages
	 */
	vscode: any;
}

/**
 * React component that displays a tabular data panel.
 *
 * @param props The properties for the component.
 */
export const DataPanel = (props: DataPanelProps) => {

	// The height of a single row of data
	const rowHeightPx = 30;

	// The number of rows to render above and below the visible area of the table.
	const scrollOverscan = 30;

	// A reference to the scrollable table container element.
	const tableContainerRef = React.useRef<HTMLDivElement>(null);
	const headerRef = React.useRef<HTMLTableSectionElement>(null);

	const {initialData, fetchSize, vscode} = props;

	// The resolver functions and request queue need to persist between re-renders
	const requestResolvers = React.useRef<ResolverLookup>({});
	const requestQueue = React.useRef<number[]>([]);

	const scrollPageRef = React.useRef<number[]>([0]);

	// Count total rows and pages, including those we have not yet fetched
	const totalRows = initialData.rowCount;
	const numPages = Math.ceil(totalRows / fetchSize);
	const maxPage = numPages - 1;
	const allPages = Array.from({length:numPages}, (_, i) => i);

	// Makes an async request to the backend for data, and handles updating the request queue and
	// calling the appropriate resolve or reject function when the request completes.
	const fetcher = new DataFetcher(requestQueue.current, requestResolvers.current, totalRows, vscode);

	// Dimensions to keep track of as the table container scrolls and resizes
	const dimensionsRef = React.useRef<any>({
		marginTop: 0,
		marginBottom: 0,
		marginLeft: 0,
		marginRight: 0
	});

	React.useEffect(() => {
		const handleMessage = ((event: any) => {
			// Update the data model in place and resolve/reject the outstanding request
			DataFragment.handleDataMessage(event, requestQueue.current, requestResolvers.current);
		});

		window.addEventListener('message', handleMessage);

		return () => {
			window.removeEventListener('message', handleMessage);
		};
	}, []);

	// Create the column definitions (metadata) for the table.
	// These use the 'any' type since the data model is generic.
	// They do not contain data and therefore do not need to change when the data model changes.
	const columns = React.useMemo<ReactTable.ColumnDef<any>[]>(() => {
		return initialData.columns.map((column, colIdx) => {
			return {
				id: '' + colIdx,
				accessorKey: colIdx,
				accessorFn: (row: any[]) => row[colIdx],
				header: column.name
			};
		});
	}, []);

	const initialDataFragment: DataFragment = new DataFragment(initialData.columns, 0, Math.min(fetchSize, totalRows));

	const flattenResult = React.useCallback((result: ReactQuery.UseQueryResult<DataFragment>) => {
		if (result.isSuccess && result.data) {
			const {rowStart, rowEnd} = result.data;
			const pageSize = rowEnd - rowStart + 1;
			return {rowStart, pageSize, data: result.data.transpose()};
		}
		return {};
	}, []);

	const combineResultData = (results: ReactQuery.UseQueryResult<DataFragment>[]) => {
		// Start with a sparse array, and then fill in the pages we do have data for
		const numColumns = initialDataFragment.columns.length;
		const emptyRow = Array(numColumns).fill(null);
		const flattenedData = Array(totalRows).fill(emptyRow) as any[][];

		results.forEach(result => {
			const {rowStart, pageSize, data} = flattenResult(result);
			if (data) {
				flattenedData.splice(rowStart, pageSize, ...data);
			}
		});

		const isFetching = results.some(result => result.isFetching);
		const isSuccess = results.map(result => result.isSuccess);
		return {data: flattenedData, isFetching, isSuccess};
	};

	// All queries are disabled, and will not be automatically fetched/refetched
	// We manually trigger the queries with the refetch function from each result
	const results = ReactQuery.useQueries({
		queries: allPages.map(pageParam => {
			const options = ReactQuery.queryOptions({
				queryKey: ['table-data', pageParam],
				queryFn: () => fetcher.fetchNextDataFragment(pageParam, fetchSize),
				enabled: scrollPageRef.current.includes(pageParam),
				networkMode: 'always',
				staleTime: Infinity
			});
			if (pageParam === 0) {
				return {
					...options,
					initialData: initialDataFragment
				};
			}
			return options;
		}),
		combine: combineResultData
	});

	// Define the main ReactTable instance.
	const table = ReactTable.useReactTable(
	{
		data: results.data,
		columns,
		getCoreRowModel: ReactTable.getCoreRowModel(),
		debugTable: false,
		enableSorting: false,
	});

	const {rows} = table.getRowModel();

	// Use a virtualizer to render only the rows that are visible.
	const rowVirtualizer = ReactVirtual.useVirtualizer(
	{
		count: rows.length,
		getScrollElement: () => tableContainerRef.current,
		// This is just an initial estimate of row height
		estimateSize: () => rowHeightPx,
		overscan: scrollOverscan
	});

	const virtualRows = rowVirtualizer.getVirtualItems();

	const {paddingTop, paddingBottom} = React.useMemo(() => {
		// Compute the padding for the table container.
		const paddingTop = virtualRows?.[0]?.start || 0;
		const totalSize = rowVirtualizer.getTotalSize();
		const paddingBottom = totalSize - (virtualRows?.[virtualRows.length - 1]?.end || 0);
		return {paddingTop, paddingBottom};
	}, [virtualRows]);

	const positionOverlay = React.useCallback((container: HTMLDivElement | null) => {
		const emptyElement = {
			clientHeight: 0,
			clientWidth: 0,
			offsetHeight: 0,
			offsetWidth: 0
		};

		const {clientWidth, clientHeight, offsetWidth, offsetHeight} = container || emptyElement;
		const {clientHeight: headerHeight, clientWidth: headerWidth} = headerRef.current || emptyElement;

		// Vertically and horizontally center the loading overlay
		// accounting for scrollbars, header, and container size
		const marginTop = (clientHeight - headerHeight) / 2;
		const marginBottom = offsetHeight - clientHeight; // horizontal scrollbar height
		const marginRight = offsetWidth - clientWidth; // vertical scrollbar width
		// Use the table header width rather than the full container width
		// when the table doesn't take up the full width of the container
		const marginLeft = Math.min(headerWidth, clientWidth) / 2;
		dimensionsRef.current = {marginTop, marginBottom, marginRight, marginLeft};
	}, []);

	React.useLayoutEffect(() => {
		positionOverlay(tableContainerRef.current);
	}, []);

	// Callback, invoked on scroll, that will fetch more data from the backend if we have reached
	// a previously unseen scroll position.
	const updateScroll = React.useCallback(() => {
		// The virtual rows exist before we've fetched them, they are just empty
		const firstVirtualRow = virtualRows?.[0]?.index ?? 0;
		const top = Math.floor(firstVirtualRow / fetchSize);
		const lastVirtualRow = virtualRows?.[virtualRows.length - 1]?.index ?? 0;
		const bottom = Math.min(Math.floor(lastVirtualRow / fetchSize), maxPage);
		scrollPageRef.current = allPages.slice(top, bottom + 1);
	}, [virtualRows]);

	React.useEffect(() => {
		// Make sure we've caught up with the latest scroll position
		// Otherwise the data can get stuck out of sync with the scroll if the user has scrolled quickly
		// Also ensures that we fetch both the previous and next page if both are needed
		// (i.e. the viewport crosses a page boundary)
		updateScroll();
	}, [updateScroll]);

	return (
		<div
			className='container'
			onScroll={updateScroll}
			onResize={e => positionOverlay(e.target as HTMLDivElement)}
			ref={tableContainerRef}
		>
			<table>
				<thead ref={headerRef}>
					{table.getHeaderGroups().map(headerGroup => (
						<tr key={headerGroup.id}>
							{headerGroup.headers.map(header => {
								return (
									<th
										key={header.id}
										colSpan={header.colSpan}
										style={{ width: header.getSize() }}
									>
										{header.isPlaceholder ? null : (
											<div
												{...{
													className: header.column.getCanSort()
														? 'cursor-pointer select-none'
														: '',
													onClick: header.column.getToggleSortingHandler(),
												}}
											>
												{ReactTable.flexRender(
													header.column.columnDef.header,
													header.getContext()
												)}
												{{
													asc: '🔼', // allow-any-unicode-next-line
													desc: '🔽', // allow-any-unicode-next-line
												}[header.column.getIsSorted() as string] ?? null}
											</div>
										)}
									</th>
								);
							})}
						</tr>
					))}
				</thead>
				<tbody>
					{
						<tr>
							<td style={{ height: `${paddingTop}px` }} />
						</tr>
					}
					{virtualRows.map(virtualRow => {
						const row = rows[virtualRow.index] as ReactTable.Row<any>;

						return (
							<tr
								key={virtualRow.key}
								data-index={virtualRow.index}
								style={{height: `${virtualRow.size}px`}}
								//ref={rowVirtualizer.measureElement}
							>
							{
								row.getVisibleCells().map(cell => {
									return (
										<td key={cell.id}>
											{ReactTable.flexRender(
												cell.column.columnDef.cell,
												cell.getContext()
											)}
										</td>
									);
								})
							}
							</tr>
						);
					})}
					{
						<tr>
							<td style={{ height: `${paddingBottom}px` }} />
						</tr>
					}
				</tbody>
			</table>
			{
				results.isFetching ?
				<div className='overlay' style={dimensionsRef.current}>
					<div className='loading'>
						Loading more rows...
					</div>
				</div> :
				null
			}
		</div>
	);
};
