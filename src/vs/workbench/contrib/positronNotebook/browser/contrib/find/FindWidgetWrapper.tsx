/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import React from 'react';

import { ISettableObservable } from '../../../../../../base/common/observable.js';
import { useObservedValue } from '../../useObservedValue.js';
import { FindWidget } from './FindWidget.js';

interface FindWidgetWrapperProps {
	findText: ISettableObservable<string>;
	focusInput?: boolean;
	matchCase: ISettableObservable<boolean>;
	matchWholeWord: ISettableObservable<boolean>;
	useRegex: ISettableObservable<boolean>;
	onClose: () => void;
}

export const FindWidgetWrapper = ({
	findText: findTextObs,
	focusInput,
	matchCase: matchCaseObs,
	matchWholeWord: matchWholeWordObs,
	useRegex: useRegexObs,
	onClose,
}: FindWidgetWrapperProps) => {
	const findText = useObservedValue(findTextObs);
	const matchCase = useObservedValue(matchCaseObs);
	const matchWholeWord = useObservedValue(matchWholeWordObs);
	const useRegex = useObservedValue(useRegexObs);
	return <FindWidget
		findText={findText}
		focusInput={focusInput}
		matchCase={matchCase}
		matchWholeWord={matchWholeWord}
		useRegex={useRegex}
		onClose={onClose}
		onFindInSelection={() => { }}
		onFindTextChange={(value) => findTextObs.set(value, undefined)}
		onMatchCaseChange={(value) => matchCaseObs.set(value, undefined)}
		onMatchWholeWordChange={(value) => matchWholeWordObs.set(value, undefined)}
		onNextMatch={() => { }}
		onPreviousMatch={() => { }}
		onUseRegexChange={(value) => useRegexObs.set(value, undefined)}
	/>;
}
