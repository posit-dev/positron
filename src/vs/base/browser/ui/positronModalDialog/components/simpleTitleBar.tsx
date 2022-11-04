/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./simpleTitleBar';
import * as React from 'react';
import { MouseEvent } from 'react'; // eslint-disable-line no-duplicate-imports

/**
 * SimpleTitleBarProps interface.
 */
interface SimpleTitleBarProps {
	title: string;
	move?: (x: number, y: number) => void;
}

// interface Point {
// 	clientX: number;
// 	clientY: number;
// }

/**
 * Events.
 */
type DocumentMouseEvent = globalThis.MouseEvent;


/**
 * SimpleTitleBar component.
 * @param props A SimpleTitleBarProps that contains the properties for the component.
 */
export const SimpleTitleBar = (props: SimpleTitleBarProps) => {
	// Hooks.
	// const [moveStartPoint, setMoveStartPoint] = useState<Point | undefined>(undefined);

	// // Memoize the mouse event handler.
	// const xxxx = useCallback((e: globalThis.MouseEvent) => {
	// 	console.log(`XXXX!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! ${moveStartPoint?.clientX},${moveStartPoint?.clientY}`);
	// 	if (props.move && moveStartPoint) {
	// 		console.log('DOING IT');
	// 		e.preventDefault();
	// 		e.stopPropagation();
	// 		//e.preventDefault();
	// 		props.move(moveStartPoint.clientX - e.clientX, moveStartPoint.clientY - e.clientY);
	// 		setMoveStartPoint({
	// 			clientX: e.clientX,
	// 			clientY: e.clientY
	// 		});
	// 	}
	// }, []);

	// Mouse down handler.
	const mouseDownHandler = (e: MouseEvent) => {
		if (!props.move) {
			return;
		}

		e.preventDefault();

		let clientX = e.clientX;
		let clientY = e.clientY;

		const movie1 = (e: DocumentMouseEvent) => {
			if (!props.move) {
				return;
			}

			e.preventDefault();
			console.log(`MOUSE MOVE HANDLER ${e.clientX},${e.clientY}`);

			props.move(clientX - e.clientX, clientY - e.clientY);
			clientX = e.clientX;
			clientY = e.clientY;
		};

		const movie2 = (e: DocumentMouseEvent) => {
			console.log(`MOUSE UP HANDLER ${e.clientX},${e.clientY}`);
			document.removeEventListener('mousemove', movie1);
			document.removeEventListener('mouseup', movie2);
		};

		document.addEventListener('mousemove', movie1, false);
		document.addEventListener('mouseup', movie2, false);

		// if (props.move) {

		// 	document.addEventListener('mousemove', xxxx, false);

		// 	console.log(`Starting move operation from ${e.clientX},${e.clientX}`);
		// }
	};

	// // Mouse move handler.
	// const mouseMoveHandler = (e: MouseEvent) => {
	// 	console.log(`MOUSE MOVE!!!!!!!!!!!!!!!!!!!!!!!!!!!!`);
	// 	if (props.move && moveStartPoint) {
	// 		e.preventDefault();
	// 		e.stopPropagation();
	// 		//e.preventDefault();
	// 		props.move(moveStartPoint.clientX - e.clientX, moveStartPoint.clientY - e.clientY);
	// 		setMoveStartPoint({
	// 			clientX: e.clientX,
	// 			clientY: e.clientY
	// 		});
	// 	}
	// };

	// // Mouse up handler.
	// const mouseUpHandler = (e: MouseEvent) => {
	// 	if (props.move && moveStartPoint) {
	// 		e.preventDefault();
	// 		e.stopPropagation();
	// 		props.move(moveStartPoint.clientX - e.clientX, moveStartPoint.clientY - e.clientY);
	// 		setMoveStartPoint(undefined);
	// 	}
	// };

	// Render.
	return (
		<div className='simple-title-bar' onMouseDown={mouseDownHandler} /*onMouseMove={mouseMoveHandler} onMouseUp={mouseUpHandler}*/>
			<div className='simple-title-bar-title'>
				{props.title}
			</div>
		</div>
	);
};
