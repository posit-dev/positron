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

// External types.
import { DataSet } from './positron-data-viewer';


interface DataPanelProps {
	data: DataSet;
}

/**
 * React component that displays a tabular data panel.
 *
 * @param props The properties for the component.
 */
export const DataPanel = (props: DataPanelProps) => {

	const fetchSize = 20;
	const scrollThresholdPx = 300;

	const rerender = React.useReducer(() => ({}), {})[1];
	const tableContainerRef = React.useRef<HTMLDivElement>(null);
	const dataSet = props.data;
	const dataModel = new DataModel(props.data);

	const columns = React.useMemo<ReactTable.ColumnDef<any>[]>(
		() => {
			return dataSet.columns.map((column, idx) => {
				return {
					id: '' + idx,
					accessorFn: row => row[idx],
					header: column.name,
				};
			});
		},
		[]);

	const { data, fetchNextPage, isFetching, isLoading } =
		ReactQuery.useInfiniteQuery<DataFragment>(
			['table-data'],
			async ({ pageParam = 0 }) => {
				const start = pageParam * fetchSize;
				const fetchedData = dataModel.loadDataFragment(start, fetchSize);
				return fetchedData;
			},
			{
				getNextPageParam: (_lastGroup, groups) => groups.length,
				keepPreviousData: true,
				refetchOnWindowFocus: false,
			}
		);

	const flatData = React.useMemo(
		() => data?.pages?.flatMap(page => page.columns) ?? [],
		[data]);

	const totalDBRowCount = dataSet.rowCount;
	const totalFetched = flatData.length;

	const fetchMoreOnBottomReached = React.useCallback(
		(containerRefElement?: HTMLDivElement | null) => {
			if (containerRefElement) {
				const { scrollHeight, scrollTop, clientHeight } = containerRefElement;
				if (
					scrollHeight - scrollTop - clientHeight < scrollThresholdPx &&
					!isFetching &&
					totalFetched < totalDBRowCount
				) {
					fetchNextPage();
				}
			}
		},
		[fetchNextPage, isFetching, totalFetched, totalDBRowCount]);

	React.useEffect(() => {
		fetchMoreOnBottomReached(tableContainerRef.current);
	}, [fetchMoreOnBottomReached]);

	const table = ReactTable.useReactTable({
		data: flatData,
		columns,
		getCoreRowModel: ReactTable.getCoreRowModel(),
		getSortedRowModel: ReactTable.getSortedRowModel(),
		debugTable: true,
	});

	const { rows } = table.getRowModel();

	const rowVirtualizer = ReactVirtual.useVirtual({
		parentRef: tableContainerRef,
		size: rows.length,
		overscan: 10,
	});

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
		<div className='p-2'>
			<div className='h-2' />
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
			<div>
				Fetched {flatData.length} of {totalDBRowCount} Rows.
			</div>
			<div>
				<button onClick={() => rerender()}>Force Rerender</button>
			</div>
		</div>
	);
};
