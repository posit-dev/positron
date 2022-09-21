/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./testComponent';
// eslint-disable-next-line local/code-import-patterns
import * as React from 'react';

const doo = '';
console.log(doo);

// TestComponentProps interface.
interface TestComponentProps {
	message: string;
}

// TestComponent component.
const TestComponent = (props: TestComponentProps) => {
	// Render.
	return (
		<>
			<div className='test' >
				This is output from a React component. {props.message}
			</div>
		</>
	);
};

// Export the TestComponent component.
export default TestComponent;
