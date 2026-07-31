# Bump vulnerable transitive dependencies in positron-ipywidgets renderer

Addresses https://github.com/posit-dev/positron-builds/issues/814.

### Summary

`npm audit` in `extensions/positron-ipywidgets/renderer` reported 7 advisories (6 high, 1 moderate), all in transitive dependencies of the `@jupyter-widgets/*` / `@jupyterlab/*` stack. All of them are now fixable within the existing semver ranges, so this PR only updates `package-lock.json` - no direct dependency changes and no major bumps of the sensitive `@jupyter-widgets` packages.

Note: the previous blocker (jupyter-widgets pinning an old lodash, see issue comments) is resolved - lodash 4.18.1 has since been published and satisfies `@jupyter-widgets/base`'s declared range of `^4.17.4`, so the lockfile can pick it up without waiting for jupyter-widgets/ipywidgets#4019.

| Package | Severity | Advisory | Old | New |
|---|---|---|---|---|
| lodash | High | [GHSA-r5fr-rjxr-66jc](https://github.com/advisories/GHSA-r5fr-rjxr-66jc), [GHSA-f23m-r3pf-42rh](https://github.com/advisories/GHSA-f23m-r3pf-42rh), [GHSA-xxjr-mmjv-4gpg](https://github.com/advisories/GHSA-xxjr-mmjv-4gpg) | 4.17.21 | 4.18.1 |
| lodash-es | High | same advisories as lodash | 4.17.21 | 4.18.1 |
| ws | High | [GHSA-58qx-3vcg-4xpx](https://github.com/advisories/GHSA-58qx-3vcg-4xpx), [GHSA-96hv-2xvq-fx4p](https://github.com/advisories/GHSA-96hv-2xvq-fx4p) | 8.18.0 | 8.21.1 |
| postcss | High | [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93), [GHSA-6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q), [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849) | 8.4.49 | 8.5.25 |
| underscore | High | [GHSA-qpx9-hpmf-5gmw](https://github.com/advisories/GHSA-qpx9-hpmf-5gmw) | 1.13.7 | 1.13.8 |
| fast-uri | High | [GHSA-q3j6-qgpj-74h6](https://github.com/advisories/GHSA-q3j6-qgpj-74h6), [GHSA-v39h-62p7-jpjc](https://github.com/advisories/GHSA-v39h-62p7-jpjc), [GHSA-v2hh-gcrm-f6hx](https://github.com/advisories/GHSA-v2hh-gcrm-f6hx), [GHSA-4c8g-83qw-93j6](https://github.com/advisories/GHSA-4c8g-83qw-93j6) | 3.0.3 | 3.1.5 |
| ajv | Moderate | [GHSA-2g4f-4pwh-qvx6](https://github.com/advisories/GHSA-2g4f-4pwh-qvx6) | 8.17.1 | 8.20.0 |
| nanoid | - (pulled along by postcss) | - | 3.3.8 | 3.3.16 |

### Verification

- `npm audit` before: 7 vulnerabilities (6 high, 1 moderate). After: `found 0 vulnerabilities`.
- Renderer build: `node extensions/positron-ipywidgets/renderer/esbuild.js` (the script the extension build invokes via `build/lib/extensions.ts`) exits 0 and produces `renderer/media/index.js`. Only pre-existing esbuild warnings from the vendored `src/reactable/reactable-py.esm.js` remain.

### Release Notes

#### New Features

- N/A

#### Bug Fixes

- N/A

### Validation Steps

@:notebooks

Suggest running the ipywidgets e2e test: `test/e2e/tests/notebooks-positron/notebook-ipywidgets-slider.test.ts`.
