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
			console.log(`scrollPage: ${scrollPage}`);

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
		// Loop over each page of data in sequence and transpose the data for that page.
		// Then flatten all the transposed data pages together

		const transposePage = (page: DataFragment) => {
			return page.columns[0].data.map(
				// Transpose the data for the current page
				(_, rowIdx) => page.columns.map(col => col.data[rowIdx])
			);
		};

		// If we have skipped over pages while scrolling, those pages will not exist
		// So we need to iterate over all indices from 0 to the max page in pageParams
		// and insert empty placeholder rows for the missing pages
		const highestPage = Math.max(...data?.pageParams as number[]) ?? 0;
		const allPages = Array.from({ length: highestPage + 1 }, (_, pageParam) => pageParam);
		const numColumns = data?.pages?.[0]?.columns.length ?? 0;

		return allPages.flatMap(pageParam => {
			const index = data?.pageParams?.indexOf(pageParam) ?? -1;
			const page = data?.pages?.[index];

			if (!page || !page.columns.length ) {
				// No data for this page, fill to correct dimensions with empty data
				const emptyRow = Array(numColumns);
				return Array(fetchSize).fill(emptyRow);
			} else {
				return transposePage(page);
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
	console.log(`rows.length: ${JSON.stringify(rows.length)}`);

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
	const paddingTop = virtualRows?.[0]?.start || 0;
	const paddingBottom = totalSize - (virtualRows?.[virtualRows.length - 1]?.end || 0);
	console.log(`
		paddingTop: ${paddingTop}
		paddingBottom: ${paddingBottom}
		totalSize: ${totalSize}
		fetchedRowHeight: ${fetchedRowHeight}
		unfetchedRowHeight: ${unfetchedRowHeight}
	`);

	const {hasNextPage, lastPageFetched, penultimatePageFetched, lastFetchedRow} = React.useMemo(() => {
		const totalPagesFetched = data?.pageParams?.length || 0;
		const lastPageFetched = data?.pageParams?.[totalPagesFetched - 1] as number;
		const penultimatePageFetched = data?.pageParams?.[totalPagesFetched - 2] as number;
		const lastFetchedRow = data?.pages?.[totalPagesFetched - 1]?.rowEnd;
		const hasNextPage = lastPageFetched < maxPage;

		/*console.log(`lastPageFetched: ${lastPageFetched}`);
		console.log(`lastFetchedRow: ${lastFetchedRow}`);*/
		return {hasNextPage, lastPageFetched, penultimatePageFetched, lastFetchedRow};
	}, [data]);

	// Callback, invoked on scroll, that will fetch more data from the backend if we have reached
	// the end of the virtualized rows by sending a new MessageRequest.
	const fetchMoreOnBottomReached = React.useCallback(() => {
		// The virtual row index will not account for pages we skipped, so we need to recalculate
		// the actual row index of the last virtual row
		const lastVirtualIndex = virtualRows?.[virtualRows.length - 1]?.index;
		const virtualRowsOnCurrentPage = lastVirtualIndex % fetchSize;
		const priorPageRows = lastVirtualIndex < lastPageFetched * fetchSize
			? (penultimatePageFetched) * fetchSize
			: lastPageFetched * fetchSize;
		const lastVirtualRow = priorPageRows + virtualRowsOnCurrentPage;

		if (!lastVirtualRow || !hasNextPage || isFetchingNextPage) {
			return;
		}

		// don't trigger fetchNextPage if the data has already been requested
		if (requestQueue.current.includes(lastFetchedRow + 1)) {
			return;
		}

		const virtualRowsRemaining = lastFetchedRow - lastVirtualRow;
		// Allow fetching more data even if a fetch is already in progress
		console.log(`
			scrollPage: ${scrollPage}
			virtualRowsRemaining: ${virtualRowsRemaining}
			lastVirtualRow: ${lastVirtualRow}
			lastFetchedRow: ${lastFetchedRow}
		`);
		if (virtualRowsRemaining < scrollThresholdRows || scrollPage > lastPageFetched) {
			fetchNextPage();
		}
	}, [fetchNextPage, hasNextPage, lastPageFetched, penultimatePageFetched, lastFetchedRow, scrollPage, virtualRows]);

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
							<tr key={row.id} style={{ minHeight: `${rowHeightPx}px` }}>
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
