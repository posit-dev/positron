/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IRuntimeStartupService } from '../../../../services/runtimeStartup/common/runtimeStartupService.js';
import { cellRuntimeLanguage, hostedCellLanguages, isExecutableLanguage, rcppWithSourceCpp } from '../../common/quartoLanguages.js';

/** A runtime startup service with runtime providers for the given languages. */
function runtimeStartupService(languageIds: string[]): IRuntimeStartupService {
	return stubInterface<IRuntimeStartupService>({
		hasLanguageRuntimeProvider: (languageId: string) => languageIds.includes(languageId),
	});
}

describe('quartoLanguages', () => {
	describe('hostedCellLanguages', () => {
		it('lists Rcpp, lower-cased, for the Quarto extension to probe', () => {
			expect(hostedCellLanguages()).toEqual(['rcpp']);
		});
	});

	describe('rcppWithSourceCpp', () => {
		it('compiles the code with Rcpp::sourceCpp() in R', () => {
			expect(rcppWithSourceCpp('// [[Rcpp::export]]\nint one() { return 1; }'))
				.toBe('Rcpp::sourceCpp(code = r"--(// [[Rcpp::export]]\nint one() { return 1; })--")');
		});

		it('uses a raw string delimiter that does not occur in the code', () => {
			// C++ raw strings with the same delimiters as R raw strings
			const code = 'std::string s = R"--(a)--";\nstd::string t = R"---(b)---";';
			expect(rcppWithSourceCpp(code)).toBe(`Rcpp::sourceCpp(code = r"----(${code})----")`);
		});
	});

	describe('cellRuntimeLanguage', () => {
		it('runs Rcpp cells in R, whatever the case of the fence language', () => {
			expect(cellRuntimeLanguage('Rcpp')).toBe('r');
			expect(cellRuntimeLanguage('rcpp')).toBe('r');
		});

		it('runs other cells in their own language', () => {
			expect(cellRuntimeLanguage('python')).toBe('python');
		});
	});

	describe('isExecutableLanguage', () => {
		it('runs Rcpp cells when an extension provides R runtimes', () => {
			expect(isExecutableLanguage('Rcpp', runtimeStartupService(['r']))).toBe(true);
		});

		it('does not run Rcpp cells without R runtimes', () => {
			expect(isExecutableLanguage('Rcpp', runtimeStartupService(['python']))).toBe(false);
		});
	});
});
