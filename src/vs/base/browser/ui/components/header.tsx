/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./header';
import * as React from 'react';

const doo = '';
console.log(doo);

// HeaderTitleProps interface.
interface HeaderProps {
	message: string;
}

// Header component.
const Header = (props: HeaderProps) => {
	// Render.
	return (
		<>
			<div className='header-thing' >
				This is output from a React component. {props.message}
			</div>
		</>
	);
};

// Export the Header component.
export default Header;
