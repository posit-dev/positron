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
import { LoadingOverlay } from './LoadingOverlay';
import { DataRow, HeaderRow, PaddingRow } from './Rows';
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
	const scrollPages = React.useRef<{top: number; bottom: number}>({top: 0, bottom: 0});

	const {initialData, fetchSize, vscode} = props;

	// The resolver functions and request queue need to persist between re-renders
	const requestResolvers = React.useRef<ResolverLookup>({});
	const requestQueue = React.useRef<number[]>([]);

	// Count total rows and pages, including those we have not yet fetched
	const totalRows = initialData.rowCount;
	const maxPage = Math.ceil(totalRows / fetchSize) - 1;

	// Makes an async request to the backend for data, and handles updating the request queue and
	// calling the appropriate resolve or reject function when the request completes.
	const fetcher = new DataFetcher(requestQueue.current, requestResolvers.current, totalRows, vscode);

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

	// Use a virtualizer to render only the rows that are visible.
	const rowVirtualizer = ReactVirtual.useVirtualizer(
	{
		count: totalRows,
		getScrollElement: () => tableContainerRef.current,
		// For now, we assume all rows are of constant height
		// TODO: account for variable height rows, here and below in the totalSize variable
		estimateSize: () => rowHeightPx,
		overscan: scrollOverscan
	});

	const virtualRows = rowVirtualizer.getVirtualItems();

	const {firstVirtualRow, lastVirtualRow, paddingTop, paddingBottom} = React.useMemo(() => {
		if (!virtualRows.length) {
			return {firstVirtualRow: 0, lastVirtualRow: 0, paddingTop: 0, paddingBottom: 0};
		}
		const firstVirtual = virtualRows[0];
		const lastVirtual = virtualRows[virtualRows.length - 1];

		if (!firstVirtual || !lastVirtual) {
			return {firstVirtualRow: 0, lastVirtualRow: 0, paddingTop: 0, paddingBottom: 0};
		}

		const firstVirtualRow = firstVirtual.index;
		const lastVirtualRow = lastVirtual.index;

		const totalSize = rowVirtualizer.getTotalSize();
		// Compute the padding for the table container.
		const paddingTop = firstVirtual.start;
		const paddingBottom = totalSize - lastVirtual.end;
		return {firstVirtualRow, lastVirtualRow, paddingTop, paddingBottom};
	}, [virtualRows]);

	// Use a React Query infinite query to fetch data from the data model
	const {data, fetchNextPage, fetchPreviousPage, hasNextPage, hasPreviousPage} = ReactQuery.useInfiniteQuery(
	{
		queryKey: ['table-data'],
		queryFn: ({pageParam}) => fetcher.fetchNextDataFragment(pageParam, fetchSize),
		initialPageParam: 0,
		initialData: {
			pages: [initialDataFragment],
			pageParams: [0]
		},
		getPreviousPageParam: (_page, _pages, _firstPageParam, allPageParams) => {
			return allPageParams.includes(scrollPages.current.top)
				? undefined // don't refetch if we have already fetched data for this page
				: scrollPages.current.top; // otherwise, use scroll position to determine previous page
		},
		getNextPageParam: (_page, _pages, _lastPageParam, allPageParams) => {
			return allPageParams.includes(scrollPages.current.bottom)
				? undefined // don't refetch if we have already fetched data for this page
				: scrollPages.current.bottom; // otherwise, use scroll position to determine next page
		},
		// we don't need to check for active network connection before retrying a query
		networkMode: 'always',
		staleTime: Infinity,
		refetchOnWindowFocus: false
	});

	// Callback that will fetch more data from the backend if we have scrolled outside the region of
	// previously fetched data
	const fetchMorePages = React.useCallback(() => {
		if (hasNextPage) {
			fetchNextPage({cancelRefetch: false});
		}
		if (hasPreviousPage) {
			fetchPreviousPage({cancelRefetch: false});
		}
	}, [fetchNextPage, hasNextPage, fetchPreviousPage, hasPreviousPage]);

	// Compute the current scroll page based on the virtualized rows
	const updateScroll = React.useCallback((firstVirtualRow: number, lastVirtualRow: number) => {
		// The virtual rows exist before we've fetched them, they are just empty
		const top = Math.floor(firstVirtualRow / fetchSize);
		const bottom = Math.min(Math.floor(lastVirtualRow / fetchSize), maxPage);
		scrollPages.current = {top, bottom};
	}, []);

	React.useEffect(() => {
		// Make sure we've caught up with the latest scroll position
		// Otherwise the data can get stuck out of sync with the scroll if the user has scrolled quickly
		// Also ensures that we fetch both the previous and next page if both are needed
		// (i.e. the viewport crosses a page boundary)
		updateScroll(firstVirtualRow, lastVirtualRow);
		fetchMorePages();
	}, [firstVirtualRow, lastVirtualRow, fetchMorePages, rowVirtualizer.isScrolling]);

	const transposePage = React.useCallback((page: DataFragment) => {
		const {rowStart, rowEnd} = page;
		const pageSize = rowEnd - rowStart + 1;
		return {rowStart, pageSize, data: page.transpose()};
	}, []);

	const createEmptyData = React.useCallback((highestFetchedRow: number) => {
		const numColumns = initialData.columns.length;
		const numRows = highestFetchedRow + 1;
		const emptyRow = Array(numColumns).fill(undefined);
		return Array(numRows).fill(emptyRow) as any[][];
	}, []);

	// Transpose and flatten the data. The data model stores data in a column-major
	// format, but React Table expects data in a row-major format, so we need to
	// transpose the data. We also need to pad the array with placeholder rows
	const flatData = React.useMemo(() => {
		// We don't expect pages to be in order, but we do expect that there aren't duplicates
		// That shouldn't be possible based on our implementation of getNext/PrevPageParams,
		// but we check anyway to future-proof against changes to the query logic
		const allPages = new Set(data.pageParams);
		if (allPages.size !== data.pageParams.length) {
			console.error('Duplicate pages fetched in the data');
		}

		const highestFetchedRow = Math.max(...data.pages.map(page => page.rowEnd));
		const flatData = createEmptyData(highestFetchedRow);

		data.pages.forEach(page => {
			const {rowStart, pageSize, data} = transposePage(page);
			flatData.splice(rowStart, pageSize, ...data);
		});

		return flatData;
	}, [data.pageParams.length]);

	// Define the main ReactTable instance.
	const table = ReactTable.useReactTable(
	{
		data: flatData,
		columns,
		getCoreRowModel: ReactTable.getCoreRowModel(),
		debugTable: false,
		debugColumns: false,
		debugHeaders: false,
		enableSorting: false,
	});

	const createRow = React.useCallback((row: any[], index: number) => {
		// table is technically a dependency here, but we use it only for its column defs
		// so passing in columns rather than table as a dependency gives us better memoization
		const rowId = '' + index;
		// 0 is the depth, we don't support nested rows yet
		// for nested rows, we'd need to update the subRows and/or parent row IDs
		return ReactTable.createRow(table, rowId, row, index, 0);
	}, [columns]);

	const isLoading = React.useMemo(() => {
		const columnId = columns[0].id;
		if (!columnId) {
			return true;
		}

		// Top of the screen is loading if the first virtual row is past the end of the data
		// or in the sparse area of the data padded with undefined values
		const topLoading = (
			flatData?.[firstVirtualRow] === undefined ||
			flatData[firstVirtualRow].every(value => value === undefined)
		);
		// Same for bottom of the screen, but with the last virtual row
		const bottomLoading = (
			flatData?.[lastVirtualRow] === undefined ||
			flatData[lastVirtualRow].every(value => value === undefined)
		);
		return topLoading || bottomLoading;
	}, [flatData, firstVirtualRow, lastVirtualRow, columns]);

	return (
		<div
			className='container'
			ref={tableContainerRef}
		>
			<table>
				<HeaderRow ref={headerRef} table={table} />
				<tbody>
					<PaddingRow padding={paddingTop} />
					{
						isLoading ?
							null :
							virtualRows.map(virtualRow => {
								// We could get the rows from table.getRowModel().rows, but that would create all rows,
								// not just the ones that we actually need to render, and is very expensive for large tables
								const row = createRow(flatData[virtualRow.index], virtualRow.index);

								return (
								<DataRow
									key={virtualRow.key}
									virtualRow={virtualRow}
									row={row}
								/>);
							})
					}
					<PaddingRow padding={paddingBottom} />
				</tbody>
			</table>
			<LoadingOverlay
				isLoading={isLoading}
				container={tableContainerRef.current}
				header={headerRef.current}
			/>
		</div>
	);
};
