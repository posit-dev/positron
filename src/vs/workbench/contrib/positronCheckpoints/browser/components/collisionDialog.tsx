/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './checkpointDialog.css';

// React.
import { useState } from 'react';

// Other dependencies.
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { ByteSize } from '../../../../../platform/files/common/files.js';
import { OKCancelModalDialog } from '../../../../browser/positronComponents/positronModalDialog/positronOKCancelModalDialog.js';
import { ICollisionChoice, IPathCollision } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { Strings } from '../../common/checkpointsStrings.js';

const COLLISION_DIALOG_WIDTH = 560;
const COLLISION_DIALOG_HEIGHT = 420;

/** The plain sentence that says which file an action would replace and why that matters. */
export function explainCollision(collision: IPathCollision): string {
	if (collision.reason === 'too-large') {
		return Strings.collisions.explainTooLarge(collision.path, ByteSize.formatSize(collision.sizeBytes));
	}
	return collision.incomingAuthor !== undefined
		? Strings.collisions.explainWithAuthor(collision.incomingAuthor, collision.path)
		: Strings.collisions.explainIgnored(collision.path);
}

/**
 * Asks what to do with each file an action would replace that is in no checkpoint (spec 6.2).
 * The only choice besides cancelling is "Use theirs and keep a copy of mine", so Continue is
 * enabled once every file has it.
 *
 * @returns The choices, or undefined when the person cancelled. Cancel changes nothing.
 */
export function showCollisionDialog(collisions: IPathCollision[]): Promise<ICollisionChoice[] | undefined> {
	return new Promise(resolve => {
		let settled = false;
		const settle = (choices: ICollisionChoice[] | undefined) => {
			if (!settled) {
				settled = true;
				resolve(choices);
			}
		};
		// A dialog closed any other way, such as with Escape, counts as Cancel.
		const renderer = new PositronModalReactRenderer({ onDisposed: () => settle(undefined) });
		const finish = (choices: ICollisionChoice[] | undefined) => {
			settle(choices);
			renderer.dispose();
		};
		renderer.render(<CollisionDialog collisions={collisions} renderer={renderer} onFinish={finish} />);
	});
}

interface ICollisionDialogProps {
	collisions: IPathCollision[];
	renderer: PositronModalReactRenderer;
	onFinish(choices: ICollisionChoice[] | undefined): void;
}

/** One row per file, with its explanation and the choice to keep a copy of it aside. */
const CollisionDialog = ({ collisions, renderer, onFinish }: ICollisionDialogProps) => {
	const [keepCopy, setKeepCopy] = useState<ReadonlySet<string>>(new Set());
	const allChosen = collisions.every(collision => keepCopy.has(collision.path));

	const toggle = (path: string, checked: boolean) => {
		const next = new Set(keepCopy);
		if (checked) {
			next.add(path);
		} else {
			next.delete(path);
		}
		setKeepCopy(next);
	};

	const accept = () => {
		if (allChosen) {
			onFinish(collisions.map(collision => ({ path: collision.path, choice: 'use-theirs-keep-copy' })));
		}
	};

	return (
		<OKCancelModalDialog
			cancelButtonTitle={Strings.actions.cancel()}
			height={COLLISION_DIALOG_HEIGHT}
			okButtonTitle={Strings.collisions.continue()}
			okDisabled={!allChosen}
			renderer={renderer}
			title={Strings.collisions.dialogTitle()}
			width={COLLISION_DIALOG_WIDTH}
			onAccept={accept}
			onCancel={() => onFinish(undefined)}
		>
			<div className='checkpoint-dialog'>
				<p>{Strings.results.pathCollisions()}</p>
				<ul className='checkpoint-dialog-files'>
					{collisions.map((collision, index) => {
						const explanationId = `checkpoints-collision-${index}`;
						return (
							<li key={collision.path} className='checkpoint-dialog-collision'>
								<p id={explanationId}>{explainCollision(collision)}</p>
								<label>
									<input
										aria-describedby={explanationId}
										checked={keepCopy.has(collision.path)}
										type='checkbox'
										onChange={e => toggle(collision.path, e.target.checked)}
									/>
									<span>{Strings.actions.useTheirsKeepCopy()}</span>
								</label>
								{keepCopy.has(collision.path) && (
									<p className='checkpoint-dialog-empty'>{Strings.collisions.keepCopyHelp(collision.path)}</p>
								)}
							</li>
						);
					})}
				</ul>
			</div>
		</OKCancelModalDialog>
	);
};
