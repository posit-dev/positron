# Positron Quarto Notebook

Provide `.qmd` (Quarto markdown) support for the Positron Notebook Editor.

- Unit tests: `./scripts/test.sh --runGlob '**/positronQuarto{,Notebook}/**/*.test.js' --reporter min`
- E2E tests: `npx playwright test --project e2e-electron test/e2e/tests/notebooks-positron/notebook-qmd.test.ts`
- Depends on `../positronQuarto` for core Quarto functionality
