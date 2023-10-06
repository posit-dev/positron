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

	// The distance from the bottom of the table container at which we will
	// trigger a fetch of more data.
	const scrollThresholdPx = 300;

	// The height of a single row of data
	const rowHeightPx = 30;

	// The number of rows to render above and below the visible area of the table.
	const scrollOverscan = 50;

	// A reference to the table container element.
	const tableContainerRef = React.useRef<HTMLDivElement>(null);

	const {initialData, fetchSize, vscode} = props;

	const [dataModel, updateDataModel] = React.useState<DataModel>(
		new DataModel(initialData)
	);

	// Count total rows against those we have fetched.
	const totalRows = dataModel.rowCount;
	const maxPages = Math.ceil(totalRows / fetchSize);

	React.useEffect(() => {
		const handleMessage = ((event: any) => {
			updateDataModel((prevDataModel) => {
				return prevDataModel.handleDataMessage(event);
			});
		});

		window.addEventListener('message', handleMessage);

		return () => {
			window.removeEventListener('message', handleMessage);
		};
	}, []);

	// Create the columns for the table. These use the 'any' type since the data
	// model is generic.
	const columns = React.useMemo<ReactTable.ColumnDef<any>[]>(
		() => dataModel.columns.map((column, idx) => {
				return {
					id: '' + idx,
					accessorKey: idx,
					accessorFn: (_row: any, index: number) => {
						return column.data[index];
					},
					header: column.name
				};
			}),
		[dataModel]);

	async function fetchNextDataFragment(pageParam: number, fetchSize: number): Promise<DataFragment> {
		// Fetches a single page of data from the data model.
		const startRow = pageParam * fetchSize;

		// Let the server know we are requesting more rows
		if (startRow > 0) {
			vscode.postMessage({
				msg_type: 'request_rows',
				start_row: startRow,
				fetch_size: fetchSize
			});
		}

		const fragment = dataModel.loadDataFragment(startRow, fetchSize);
		return fragment;
	}

	// Use a React Query infinite query to fetch data from the data model,
	// with the dataModel id as cache key so we re-query when new data comes in.
	const {
		data,
		isLoading,
		isFetchingNextPage,
		fetchNextPage,
		hasNextPage
	} = ReactQuery.useInfiniteQuery<DataFragment>(
			['table-data', dataModel.id],
			({pageParam = 0}) => fetchNextDataFragment(pageParam, fetchSize),
			{
				// undefined if we are on the final page of data
				getNextPageParam: (_lastGroup, groups) => groups.length !== maxPages ? groups.length : undefined,
				keepPreviousData: true,
				refetchOnWindowFocus: false,
			}
		);


	// Flatten and transpose the data. The data model stores data in a column-major
	// format, but React Table expects data in a row-major format, so we need to
	// transpose the data.
	const flatData = React.useMemo(
		() => {
			const rows: any[] = [];
			// Loop over each page of data
			data?.pages?.forEach(page => {
				// Loop over each column in the page and add the values to the
				// corresponding row.
				page.columns.forEach((column, idx) => {
					column.data.forEach((value, rowIdx) => {
						// Create the index into the row; this is the row index
						// plus the rowStart value of the page.
						rowIdx += page.rowStart;
						// Create the row if it doesn't exist.
						const row = rows[rowIdx] || (rows[rowIdx] = {});
						row[idx] = value;
					});
				});
			});
			return rows;
		},
		[data]);

		// Define the main ReactTable instance.
	const table = ReactTable.useReactTable({
		data: flatData,
		columns,
		getCoreRowModel: ReactTable.getCoreRowModel(),
		debugTable: false,
		enableSorting: false,
	});

	const {rows} = table.getRowModel();

	// Use a virtualizer to render only the rows that are visible.
	const rowVirtualizer = ReactVirtual.useVirtualizer({
		count: rows.length,
		getScrollElement: () => tableContainerRef.current,
		estimateSize: () => rowHeightPx,
		overscan: scrollOverscan
	});

	// Compute the padding for the table container.
	const virtualRows = rowVirtualizer.getVirtualItems();
	const totalSize = rowVirtualizer.getTotalSize();
	const paddingTop = virtualRows.length > 0 ? virtualRows?.[0]?.start || 0 : 0;
	const paddingBottom =
		virtualRows.length > 0
			? totalSize - (virtualRows?.[virtualRows.length - 1]?.end || 0)
			: 0;

	// Callback, invoked on scroll, that will fetch more data from the backend if we have reached
	// the bottom of the table container by sending a new MessageRequest.
	const fetchMoreOnBottomReached = React.useCallback(
		(containerRefElement?: HTMLDivElement | null) => {
			if (containerRefElement) {
				const { scrollHeight, scrollTop, clientHeight } = containerRefElement;
				const distance = scrollHeight - scrollTop - clientHeight;
				if (distance < scrollThresholdPx &&
					!isFetchingNextPage &&
					hasNextPage
				) {
					fetchNextPage();
				}
			}
		},
		[fetchNextPage, isFetchingNextPage, hasNextPage]);

	// Use an effect to fetch more data when the table container is scrolled.
	React.useEffect(() => {
		const [lastItem] = [...virtualRows].reverse();

		if (!lastItem) {
			return;
		}

		// user has scrolled to the last row of the loaded virtual rows
		// so fetch more from the backend if there are more pages
		if (lastItem.index >= rows.length - 1 &&
			hasNextPage &&
			!isFetchingNextPage
		) {
			fetchMoreOnBottomReached(tableContainerRef.current);
		}

	}, [fetchNextPage, isFetchingNextPage, hasNextPage, rows.length, virtualRows]);

	if (isLoading) {
		return <>Loading...</>;
	}

	return (
		<div
			className='container'
			onScroll={e => fetchMoreOnBottomReached(e.target as HTMLDivElement)}
			ref={tableContainerRef}
		>
			<table>
				<thead>
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
			{ isFetchingNextPage ?
				<tfoot>
					<tr>
						<th className='processing' colSpan={columns.length}>
							Loading more rows...
						</th>
					</tr>
				</tfoot> :
				null
			}
			</table>
		</div>
	);
};
