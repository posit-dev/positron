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
import { DataFragment, DataModel } from './DataModel';
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

	// The number of rows away from the bottom (not including scrollOverscan) when we should
	// trigger a fetch for more data.
	const scrollThresholdRows = 10;

	// A reference to the scrollable table container element.
	const tableContainerRef = React.useRef<HTMLDivElement>(null);

	const {initialData, fetchSize, vscode} = props;

	// The data model updates, triggering a re-render, when new data is received from the backend.
	const [dataModel, updateDataModel] = React.useState(new DataModel(initialData));

	// The resolver functions and request queue need to persist between re-renders
	const requestResolvers = React.useRef<ResolverLookup>({});
	const requestQueue = React.useRef<number[]>([]);

	// Count total rows and pages, including those we have not yet fetched
	const totalRows = dataModel.rowCount;
	const maxPage = Math.floor(totalRows / fetchSize);

	// Makes an async request to the backend for data, and handles updating the request queue and
	// calling the appropriate resolve or reject function when the request completes.
	const fetcher = new DataFetcher(requestQueue.current, requestResolvers.current, totalRows, vscode);

	React.useEffect(() => {
		const handleMessage = ((event: any) => {
			// Update state for the data model and resolve/reject the outstanding request
			updateDataModel((prevDataModel) => {
				const fragment = prevDataModel.handleDataMessage(event, requestQueue.current, requestResolvers.current);
				if (!fragment || !fragment.columns.length) {
					console.log('No data for ' + event?.data?.start_row);
					return prevDataModel;
				}
				return prevDataModel.appendFragment(fragment);
			});
		});

		window.addEventListener('message', handleMessage);

		return () => {
			window.removeEventListener('message', handleMessage);
		};
	}, []);

	React.useEffect(() => {
		// Whenever the dataModel updates, filter out all fulfilled requests from the queue
		requestQueue.current = requestQueue.current.filter(
			rowRequest => !dataModel.renderedRows.includes(rowRequest)
		);
	}, [dataModel]);

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

	const initialDataFragment: DataFragment = {
		rowStart: 0,
		rowEnd: Math.min(fetchSize, totalRows) - 1,
		columns: initialData.columns
	};

	const emptyElement = {
		clientHeight: 0,
		clientWidth: 0,
		offsetHeight: 0,
		offsetWidth: 0,
		scrollTop: 0
	};

	const {clientWidth, clientHeight, offsetWidth, offsetHeight, scrollTop} = tableContainerRef.current || emptyElement;
	const headerRef = React.useRef<HTMLTableSectionElement>(null);
	const {clientHeight: headerHeight, clientWidth: headerWidth} = headerRef.current || emptyElement;
	const verticalScrollbarWidth = offsetWidth - clientWidth;
	const horizontalScrollbarHeight = offsetHeight - clientHeight;
	const scrollBottom = scrollTop + clientHeight;
	// Assume overscan rows are all of height rowHeightPx
	// We can probably do better using the size property of the virtual rows
	const triggerFetchHeight = (scrollThresholdRows + scrollOverscan) * rowHeightPx;
	const pageHeight = rowHeightPx * fetchSize;
	const scrollPage = Math.min(
		Math.floor((scrollBottom + triggerFetchHeight) / pageHeight),
		maxPage // scroll page cannot exceed the total number of pages of data
	);

	// Use a React Query infinite query to fetch data from the data model
	const {data, fetchNextPage, isFetchingNextPage} = ReactQuery.useInfiniteQuery(
	{
		queryKey: ['table-data'],
		queryFn: ({pageParam}) => fetcher.fetchNextDataFragment(pageParam, fetchSize, dataModel),
		initialPageParam: 0,
		initialData: {
			pages: [initialDataFragment],
			pageParams: [0]
		},
		getNextPageParam: (_page, _pages, _lastPageParam, allPageParams) => {
			console.log(`getNextPageParam: ${scrollPage}`);
			return allPageParams.includes(scrollPage)
				? undefined // don't refetch if we have already fetched data for this page
				: scrollPage; // otherwise, use current scroll position to determine next page
		},
		// we don't need to check for active network connection before retrying a query
		networkMode: 'always',
		staleTime: Infinity,
		refetchOnWindowFocus: false,
		placeholderData: (previousData) => previousData
	});

	// Transpose and flatten the data. The data model stores data in a column-major
	// format, but React Table expects data in a row-major format, so we need to
	// transpose the data.
	const flatData = React.useMemo(() => {
		// Loop over each page of data and transpose the data for that page.
		// Then flatten all the transposed data pages together

		// TODO: re-sort the data in case the pageParams are out of order
		//const allPageParams = data?.pageParams || [];

		// data and pages should never be null because we declared initialData
		// and placeholderData in the infinite query
		return data?.pages?.flatMap(page => {
			// Get the number of rows for the current page
			if (page.columns.length) {
				return page.columns[0].data.map(
					// Transpose the data for the current page
					(_, rowIdx) => page.columns.map(col => col.data[rowIdx])
				);
			} else {
				// No data available for current page
				return [[]];
			}

		});
	}, [data]);

	// Define the main ReactTable instance.
	const table = ReactTable.useReactTable(
	{
		data: flatData,
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
		// For now, we assume all rows are of constant height
		// TODO: account for variable height rows, here and below in the totalSize variable
		estimateSize: () => rowHeightPx,
		overscan: scrollOverscan
	});

	// Compute the padding for the table container.
	const virtualRows = rowVirtualizer.getVirtualItems();
	const fetchedRowHeight = rowVirtualizer.getTotalSize();
	// Assume unfetched rows are all of height rowHeightPx
	const unfetchedRowHeight = (totalRows - rows.length) * rowHeightPx;
	const totalSize = fetchedRowHeight + unfetchedRowHeight;

	// Re-run on new page fetch (changes data)
	const {hasNextPage, lastPageFetched, lastFetchedRow, totalPagesFetched, penultimatePageFetched} = React.useMemo(() => {
		const totalPagesFetched = data?.pageParams?.length || 0; // 3
		const lastPageFetched = (data?.pageParams?.[totalPagesFetched - 1] as number) ?? 0; // 13
		const penultimatePageFetched = (data?.pageParams?.[totalPagesFetched - 2] as number) ?? 0; // 1
		const lastFetchedRow = data?.pages?.[totalPagesFetched - 1]?.rowEnd; // 1399
		const hasNextPage = lastPageFetched < maxPage;
		return {hasNextPage, lastPageFetched, lastFetchedRow, totalPagesFetched, penultimatePageFetched};

	}, [data]);

	// Re-run on scroll (changes virtual rows)
	const {lastVirtualRow, paddingTop, paddingBottom} = React.useMemo(() => {
		// The virtual row index will not account for pages we skipped, so we need to recalculate
		// the actual row index of the last virtual row
		const lastVirtualIndexUncorrected = virtualRows?.[virtualRows.length - 1]?.index; // 299
		const lastVRowRemainder = lastVirtualIndexUncorrected % fetchSize; // 99
		const lastVRowPageIndex = Math.floor(lastVirtualIndexUncorrected / fetchSize); // 2
		const lastVRowPageActual = Math.floor(data.pages[lastVRowPageIndex]?.rowEnd / fetchSize); // 13
		const lastVirtualRow = lastVRowPageActual * fetchSize + lastVRowRemainder; // 1399

		const firstVirtualIndexUncorrected = virtualRows?.[0]?.index; // 269
		const firstVRowRemainder = firstVirtualIndexUncorrected % fetchSize; // 69
		const firstVRowPageIndex = Math.floor(firstVirtualIndexUncorrected / fetchSize); // 2
		const firstVRowPageActual = Math.floor(data.pages[firstVRowPageIndex]?.rowEnd / fetchSize); // 13
		const firstVirtualRow = firstVRowPageActual * fetchSize + firstVRowRemainder; // 1369

		// Recalculate padding based on the actual first and last virtual row
		// This also assumes constant row height, but we'll fix that later
		const paddingTop = firstVirtualRow * rowHeightPx;
		const paddingBottom = totalSize - (lastVirtualRow + 1) * rowHeightPx;

		return {lastVirtualRow, paddingTop, paddingBottom};
	}, [virtualRows, totalPagesFetched, penultimatePageFetched, lastPageFetched]);

	// @ts-ignore
	const unwrap = ({index, start, end}) => ({index, start, end});
	console.log(`
		first virtual row: ${JSON.stringify(unwrap(virtualRows?.[0]))}
		first virtual adjusted: ${paddingTop / rowHeightPx}
		last virtual row: ${JSON.stringify(unwrap(virtualRows?.[virtualRows.length - 1]))}
		last virtual adjusted: ${lastVirtualRow}
		pages: ${data?.pageParams}
		paddingTop: ${paddingTop}
		paddingBottom: ${paddingBottom}
	`);

	// Callback, invoked on scroll, that will fetch more data from the backend if we have reached
	// the end of the virtualized rows by sending a new MessageRequest.
	const fetchMoreOnBottomReached = React.useCallback(() => {
		if (!lastVirtualRow || !hasNextPage || isFetchingNextPage) {
			return;
		}
		// don't trigger fetchNextPage if the data has already been requested
		if (requestQueue.current.includes(lastFetchedRow + 1)) {
			return;
		}

		const virtualRowsRemaining = lastFetchedRow - lastVirtualRow;
		// Allow fetching more data even if a fetch is already in progress
		console.log(`scrollPage: ${scrollPage} lastVirtualRow: ${lastVirtualRow} lastFetchedRow: ${lastFetchedRow} lastPageFetched: ${lastPageFetched}`);
		console.log(`data.pageParams: ${JSON.stringify(data?.pageParams)}`);
		if (virtualRowsRemaining < scrollThresholdRows || scrollPage > lastPageFetched) {
			fetchNextPage();
		}
	}, [fetchNextPage, isFetchingNextPage, lastVirtualRow, hasNextPage, lastPageFetched, lastFetchedRow, scrollPage]);

	// a check on mount and after a fetch to see if the table is already scrolled to the bottom
	// and immediately needs to fetch more data
	React.useEffect(() => {
		fetchMoreOnBottomReached();
	}, [fetchMoreOnBottomReached]);

	return (
		<div
			className='container'
			onScroll={fetchMoreOnBottomReached}
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
					{paddingTop > 0 && (
						<tr>
							<td style={{ height: `${paddingTop}px` }} />
						</tr>
					)}
					{virtualRows.map(virtualRow => {
						const row = rows[virtualRow.index] as ReactTable.Row<any>;

						return (
							<tr key={row.id}>
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
					{paddingBottom > 0 && (
						<tr>
							<td style={{ height: `${paddingBottom}px` }} />
						</tr>
					)}
				</tbody>
			</table>
			{
				//hasNextPage && (fetchedRowHeight - triggerFetchHeight) <= scrollBottom  ?
				false ?
				<div className='overlay' style={{
					marginTop: (headerHeight + clientHeight) / 2,
					marginBottom: horizontalScrollbarHeight,
					marginRight: verticalScrollbarWidth,
					// horizontally center the loading text, using the table width rather than
					// container width when the table doesn't take up the full container
					marginLeft: Math.min(headerWidth, clientWidth) / 2,
				}}>
					<div className='loading'>
						Loading more rows...
					</div>
				</div> :
				null
			}
		</div>
	);
};
