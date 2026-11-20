/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Strings } from '../../common/checkpointsStrings.js';

/** What the git details area shows. */
export interface IGitDetailsProps {
	commitId: string;
	branch?: string;
	/** The name of the shared copy of the branch, when the project has one. */
	upstream?: string;
	/** The message as git has it, when the row shows a plain-language description instead. */
	originalMessage?: string;
}

/** The "Show git details" area. It is the one component that names git objects. */
export const GitDetails = ({ commitId, branch, upstream, originalMessage }: IGitDetailsProps) => {
	return (
		<dl aria-label={Strings.gitDetails.heading()} className='checkpoints-git-details'>
			<dt>{Strings.gitDetails.commitId()}</dt>
			<dd>{commitId}</dd>
			{branch !== undefined && (
				<>
					<dt>{Strings.gitDetails.branch()}</dt>
					<dd>{branch}</dd>
				</>
			)}
			{upstream !== undefined && (
				<>
					<dt>{Strings.gitDetails.upstream()}</dt>
					<dd>{upstream}</dd>
				</>
			)}
			{originalMessage !== undefined && (
				<>
					<dt>{Strings.gitDetails.rawDescription()}</dt>
					<dd className='checkpoints-git-message'>{originalMessage}</dd>
				</>
			)}
		</dl>
	);
};
