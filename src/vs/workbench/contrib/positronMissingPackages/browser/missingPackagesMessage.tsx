/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './missingPackagesMessage.css';

// Other dependencies.
import { localize } from '../../../../nls.js';

export interface MissingPackagesMessageProps {
	/** The name of the file/notebook that references the packages. */
	readonly fileName: string;

	/** The language name (e.g. "Python") when the document is single-language, else null. */
	readonly languageName: string | null;

	/** The names of the packages that are referenced but not installed. */
	readonly packageNames: string[];
}

/**
 * Shared body for the missing-packages dialogs: names the document, explains that
 * it references packages that are not installed, and lists them. Used by both the
 * preflight modal and the command-triggered install modal so the wording stays in
 * one place.
 */
export const MissingPackagesMessage = (props: MissingPackagesMessageProps) => {
	return (
		<div className='missing-packages-message'>
			<div className='missing-packages-message-text'>
				{/* The filename is a non-localizable identifier rendered as a monospace element, followed by a complete localized clause. */}
				<code className='missing-packages-message-filename'>{props.fileName}</code>
				{' '}
				{props.languageName
					? localize('positron.missingPackages.dependsOnLang', "depends on the following {0} packages, but they are not installed:", props.languageName)
					: localize('positron.missingPackages.dependsOn', "depends on the following packages, but they are not installed:")}
			</div>
			<ul className='missing-packages-message-list'>
				{props.packageNames.map(name => <li key={name}>{name}</li>)}
			</ul>
		</div>
	);
};
