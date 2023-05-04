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

interface DataPanelProps {
	data: DataModel;
}

/**
 * React component that displays a tabular data panel.
 *
 * @param props The properties for the component.
 */
export const DataPanel = (props: DataPanelProps) => {

	// The number of rows that will be fetched from the data model at a time.
	const fetchSize = 10;

	// The distance from the bottom of the table container at which we will
	// trigger a fetch of more data.
	const scrollThresholdPx = 300;

	// The number of rows to render above and below the visible area of the
	// table.
	const scrollOverscan = 50;

	// A reference to the table container element.
	const tableContainerRef = React.useRef<HTMLDivElement>(null);

	// Create the columns for the table. These use the 'any' type since the data
	// model is generic.
	const columns = React.useMemo<ReactTable.ColumnDef<any>[]>(
		() => {
			return props.data.columns.map((column, idx) => {
				return {
					id: '' + idx,
					accessorFn: row => row[idx],
					header: column.name,
				};
			});
		},
		[]);

	// Use a React Query infinite query to fetch data from the data model.
	const { data, fetchNextPage, isFetching, isLoading } =
		ReactQuery.useInfiniteQuery<DataFragment>(
			['table-data'],
			async ({ pageParam = 0 }) => {
				// Fetches a single page of data from the data model.
				const start = pageParam * fetchSize;
				const fragment = props.data.loadDataFragment(start, fetchSize);
				return fragment;
			},
			{
				getNextPageParam: (_lastGroup, groups) => groups.length,
				keepPreviousData: true,
				refetchOnWindowFocus: false,
			}
		);


	// Flatten the data
	const flatData = React.useMemo(
		() => data?.pages?.flatMap(page => page.columns) ?? [],
		[data]);

	// Count total rows against those we have fetched.
	const totalRows = props.data.rowCount;
	const totalFetched = flatData.length;

	// Callback, invoked on scroll, that will fetch more data if we have reached
	// the bottom of the table container.
	const fetchMoreOnBottomReached = React.useCallback(
		(containerRefElement?: HTMLDivElement | null) => {
			if (containerRefElement) {
				const { scrollHeight, scrollTop, clientHeight } = containerRefElement;
				const distance = scrollHeight - scrollTop - clientHeight;
				if (distance < scrollThresholdPx &&
					!isFetching &&
					totalFetched < totalRows
				) {
					fetchNextPage();
				}
			}
		},
		[fetchNextPage, isFetching, totalFetched, totalRows]);

	// Use an effect to fetch more data when the table container is scrolled.
	React.useEffect(() => {
		fetchMoreOnBottomReached(tableContainerRef.current);
	}, [fetchMoreOnBottomReached]);

	// Define the main ReactTable instance.
	const table = ReactTable.useReactTable({
		data: flatData,
		columns,
		getCoreRowModel: ReactTable.getCoreRowModel(),
		getSortedRowModel: ReactTable.getSortedRowModel(),
		debugTable: true,
	});

	const { rows } = table.getRowModel();

	// Use a virtualizer to render only the rows that are visible.
	const rowVirtualizer = ReactVirtual.useVirtual({
		parentRef: tableContainerRef,
		size: rows.length,
		overscan: scrollOverscan,
	});

	// Compute the padding for the table container.
	const { virtualItems: virtualRows, totalSize } = rowVirtualizer;
	const paddingTop = virtualRows.length > 0 ? virtualRows?.[0]?.start || 0 : 0;
	const paddingBottom =
		virtualRows.length > 0
			? totalSize - (virtualRows?.[virtualRows.length - 1]?.end || 0)
			: 0;

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
													asc: '^',
													desc: 'V',
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
								{row.getVisibleCells().map(cell => {
									return (
										<td key={cell.id}>
											{ReactTable.flexRender(
												cell.column.columnDef.cell,
												cell.getContext()
											)}
										</td>
									);
								})}
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
		</div>
	);
};
