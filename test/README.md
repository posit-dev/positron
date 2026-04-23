<!-- Start Positron -->
<!-- Original VS Code README: https://github.com/microsoft/vscode/tree/main/test -->

# Positron Tests

See [`CLAUDE.md`](../CLAUDE.md#testing) for terminology and the "where should I put my test?" decision table. Quick map:

- **Unit tests**
	- **Vitest** -- next to source in `src/vs/`.
	- **Core Mocha** -- upstream VS Code's Mocha suite, in [`unit/`](unit/README.md).
- **Extension host tests** -- [`integration/`](integration/browser/README.md) (VS Code historically calls these "integration tests").
- **E2E tests** -- [`e2e/`](e2e/README.md) (Playwright).

<!-- End Positron -->
