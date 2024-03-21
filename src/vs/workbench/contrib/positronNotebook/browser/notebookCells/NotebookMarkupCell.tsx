/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { IPositronNotebookMarkupCell } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookCell';

export function NotebookMarkupCell({ cell }: { cell: IPositronNotebookMarkupCell }) {
	return <div>{cell.getContent()}</div>;
}
