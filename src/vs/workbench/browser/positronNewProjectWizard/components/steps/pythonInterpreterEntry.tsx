/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./pythonInterpreterEntry';

// React.
import * as React from 'react';

// Other dependencies.
import { PythonInterpreterInfo } from 'vs/workbench/browser/positronNewProjectWizard/utilities/pythonInterpreterListUtils';

/**
 * PythonInterpreterEntryProps interface.
 */
interface PythonInterpreterEntryProps {
	pythonInterpreterInfo: PythonInterpreterInfo;
}

/**
 * PythonInterpreterEntry component.
 * @param pythonInterpreterInfo The Python interpreter info.
 * @returns The rendered component
 */
export const PythonInterpreterEntry = ({ pythonInterpreterInfo }: PythonInterpreterEntryProps) => {
	// Render.
	return (
		<div className='python-interpreter-entry'>
			<div className='interpreter-title'>
				{/* allow-any-unicode-next-line */}
				{`${pythonInterpreterInfo.preferred ? '★ ' : ''}${pythonInterpreterInfo.languageName} ${pythonInterpreterInfo.languageVersion} ${pythonInterpreterInfo.runtimePath}`}
			</div>
			<div className='interpreter-source'>
				{pythonInterpreterInfo.runtimeSource}
			</div>
		</div>
	);
};
