# Positron Quarto Notebook

Provide `.qmd` (Quarto markdown) support for the Positron Notebook Editor.

- Unit tests: `./scripts/test.sh --runGlob '**/positronQuarto{,Notebook}/**/*.test.js' --reporter min`
- E2E tests: `npx playwright test test/e2e/tests/notebooks-positron/notebook-qmd.test.ts --project e2e-electron --reporter list`
- Depends on `../positronQuarto` for core Quarto functionality
