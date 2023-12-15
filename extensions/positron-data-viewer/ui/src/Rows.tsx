/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import './DataPanel.css';

// External libraries.
import * as React from 'react';
import * as ReactVirtual from '@tanstack/react-virtual';
import * as ReactTable from '@tanstack/react-table';

export const DataRow = (
	{virtualRow, row}: {virtualRow: ReactVirtual.VirtualItem; row: ReactTable.Row<any>}) => {

	return (
		<tr
			data-index={virtualRow.index}
			style={{height: `${virtualRow.size}px`}}
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
};

export const PaddingRow = ({padding}: {padding: number}) => {
	if (padding <= 0) {
		return null;
	}

	return (
		<tr>
			<td style={{ height: `${padding}px` }} />
		</tr>
	);
};

export const HeaderRow = React.forwardRef(function HeaderRow(
	{table}: {table: ReactTable.Table<any>}, ref: React.Ref<HTMLTableSectionElement>) {

	return (
		<thead ref={ref}>
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
	);
});
