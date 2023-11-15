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

	// Count total rows and pages, including those we have not yet fetched
	const totalRows = initialData.rowCount;
	const maxPage = Math.ceil(totalRows / fetchSize) - 1;

	// Makes an async request to the backend for data, and handles updating the request queue and
	// calling the appropriate resolve or reject function when the request completes.
	const fetcher = new DataFetcher(requestQueue.current, requestResolvers.current, totalRows, vscode);

	// Dimensions to keep track of as the table container scrolls and resizes
	const dimensionsRef = React.useRef<any>({
		overlayTop: 0,
		overlayBottom: 0,
		overlayLeft: 0,
		overlayRight: 0,
		scrollPageBottom: 0,
		scrollPageTop: 0
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

	// Use a React Query infinite query to fetch data from the data model
	const {data, fetchNextPage, fetchPreviousPage, isFetching, hasNextPage, hasPreviousPage
	} = ReactQuery.useInfiniteQuery(
	{
		queryKey: ['table-data'],
		queryFn: ({pageParam}) => fetcher.fetchNextDataFragment(pageParam, fetchSize),
		initialPageParam: 0,
		initialData: {
			pages: [initialDataFragment],
			pageParams: [0]
		},
		getPreviousPageParam: (_page, _pages, _firstPageParam, allPageParams) => {
			return allPageParams.includes(dimensionsRef.current.scrollPageTop)
				? undefined // don't refetch if we have already fetched data for this page
				: dimensionsRef.current.scrollPageTop; // otherwise, use scroll position to determine previous page
		},
		getNextPageParam: (_page, _pages, _lastPageParam, allPageParams) => {
			return allPageParams.includes(dimensionsRef.current.scrollPageBottom)
				? undefined // don't refetch if we have already fetched data for this page
				: dimensionsRef.current.scrollPageBottom; // otherwise, use scroll position to determine next page
		},
		// we don't need to check for active network connection before retrying a query
		networkMode: 'always',
		staleTime: Infinity,
		refetchOnWindowFocus: false
	});

	// Transpose and flatten the data. The data model stores data in a column-major
	// format, but React Table expects data in a row-major format, so we need to
	// transpose the data. We also need to pad the array with placeholder rows for data we have
	// not yet fetched, keeping the dimensions correct.
	const flatData = React.useMemo(() => {
		if (!data.pages.length || !data.pageParams) {
			return [];
		}

		// Start with a sparse array, and then fill in the pages we do have data for
		const numColumns = data.pages[0].columns.length ?? 0;
		const emptyRow = Array(numColumns).fill(null);
		const flatData = Array(totalRows).fill(emptyRow);

		// We don't expect pages to be in order, but we do expect that there aren't duplicates
		// That shouldn't be possible based on our implementation of getNext/PrevPageParams,
		// but we check anyway to future-proof against changes to the query logic
		const allPages = new Set(data.pageParams);
		if (allPages.size !== data.pageParams.length) {
			console.error('Duplicate pages fetched in the data');
		}

		data.pages.forEach(page => {
			const {rowStart, rowEnd} = page;
			const pageSize = rowEnd - rowStart + 1;
			flatData.splice(rowStart, pageSize, ...page.transpose());
		});
		return flatData;
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
		// This is just an initial estimate of row height
		// The height of each row will be measured dynamically as it is rendered
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
		const verticalScrollbarWidth = offsetWidth - clientWidth;
		const horizontalScrollbarHeight = offsetHeight - clientHeight;
		dimensionsRef.current.overlayTop = (clientHeight - headerHeight) / 2;
		dimensionsRef.current.overlayBottom = horizontalScrollbarHeight;
		dimensionsRef.current.overlayRight = verticalScrollbarWidth;
		// Use the table header width rather than the full container width
		// when the table doesn't take up the full width of the container
		dimensionsRef.current.overlayLeft = Math.min(headerWidth, clientWidth) / 2;
	}, []);

	React.useLayoutEffect(() => {
		positionOverlay(tableContainerRef.current);
	}, [positionOverlay]);

	const fetchMorePages = React.useCallback(() => {
		if (hasPreviousPage) {
			fetchPreviousPage({cancelRefetch: false});
		}
		// We use else here to avoid fetching both pages simultaneously
		// The callback will be invoked again after the previous page is fetched
		else if (hasNextPage) {
			fetchNextPage({cancelRefetch: false});
		}
	}, [fetchNextPage, fetchPreviousPage, isFetching, hasPreviousPage, hasNextPage]);

	// Callback, invoked on scroll, that will fetch more data from the backend if we have reached
	// a previously unseen scroll position.
	const updateScroll = React.useCallback(() => {
		// The virtual rows exist before we've fetched them, they are just empty
		const firstVirtualRow = virtualRows?.[0]?.index ?? 0;
		dimensionsRef.current.scrollPageTop = Math.floor(firstVirtualRow / fetchSize);

		const lastVirtualRow = virtualRows?.[virtualRows.length - 1]?.index ?? 0;
		const scrollPageBottom = Math.floor(lastVirtualRow / fetchSize);
		dimensionsRef.current.scrollPageBottom = Math.min(scrollPageBottom, maxPage);

		// Fetch more pages only if necessary
		fetchMorePages();
	}, [virtualRows, fetchMorePages]);

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
					{paddingTop > 0 && (
						<tr>
							<td style={{ height: `${paddingTop}px` }} />
						</tr>
					)}
					{virtualRows.map(virtualRow => {
						const row = rows[virtualRow.index] as ReactTable.Row<any>;

						return (
							<tr
								key={virtualRow.key}
								data-index={virtualRow.index}
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
					{paddingBottom > 0 && (
						<tr>
							<td style={{ height: `${paddingBottom}px` }} />
						</tr>
					)}
				</tbody>
			</table>
			{
				(hasNextPage || hasPreviousPage) && isFetching ?
				<div className='overlay' style={{
					marginTop: dimensionsRef.current.overlayTop,
					marginBottom: dimensionsRef.current.overlayBottom,
					marginRight: dimensionsRef.current.overlayRight,
					// horizontally center the loading text, using the table width rather than
					// container width when the table doesn't take up the full container
					marginLeft: dimensionsRef.current.overlayLeft,
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
