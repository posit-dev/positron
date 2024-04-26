/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./media/positronGettingStarted';

// React.
import * as React from 'react';
import { PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports
import { PositronReactRenderer } from 'vs/base/browser/positronReactRenderer';
import { PositronWelcomePageStart } from 'vs/workbench/contrib/welcomeGettingStarted/browser/positronWelcomePageStart';
import { PositronWelcomePageHelp } from 'vs/workbench/contrib/welcomeGettingStarted/browser/positronWelcomePageHelp';

export interface PositronWelcomePageLeftProps {

}

export const PositronWelcomePageLeft = (props: PropsWithChildren<PositronWelcomePageLeftProps>) => {
	// Render.
	return (
		<>
			<PositronWelcomePageStart />
			<PositronWelcomePageHelp />
		</>
	);
};

export const createWelcomePageLeft = (container: HTMLElement): PositronReactRenderer => {
	const renderer = new PositronReactRenderer(container);
	renderer.render(<PositronWelcomePageLeft />);
	return renderer;
};
