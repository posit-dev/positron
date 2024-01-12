/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { Event } from 'vs/base/common/event';
import { ISize } from 'vs/base/browser/positronReactRenderer';
export function PositronNotebookComponent({ message, onSizeChanged }: { message: string; onSizeChanged: Event<ISize> }) {

	const [width, setWidth] = React.useState(0);
	const [height, setHeight] = React.useState(0);

	React.useEffect(() => {
		const disposable = onSizeChanged((size) => {
			setWidth(size.width);
			setHeight(size.height);
		});
		return () => disposable.dispose();
	}, [onSizeChanged]);

	return (
		<div>
			<h2>Hi there!</h2>
			<div>{message}</div>
			<div>
				Size: {width} x {height}
			</div>
		</div>
	);
}
