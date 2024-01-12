/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';

export function PositronNotebookComponent({ message }: { message: string }) {
	React.useEffect(() => {
		console.log('Rendering PositronNotebookComponent');
	});
	return (
		<div>
			<h2>Hi there!</h2> {message}
		</div>
	);
}
