---
paths:
  - test/e2e/tests/workbench/**
  - test/e2e/pages/workbench/**
  - test/e2e/infra/workbench*
  - extensions/authentication/src/managedCredentials*
  - extensions/authentication/src/credentials/**
  - extensions/positron-data-driver-*/src/workbenchCredentials*
  - scripts/lib/pr-tags-lib.sh
---

# Starting the Workbench e2e lane automatically

Only the Workbench lane (the `e2e-workbench` Playwright project) runs `test/e2e/tests/workbench/**`. A PR starts that lane when its description has `@:workbench`, or when it changes a file matching `WORKBENCH_LANE_PATHS` in [scripts/lib/pr-tags-lib.sh](../../scripts/lib/pr-tags-lib.sh).

Keep that list current:

- **New Workbench test covering Workbench-only code:** add a glob for that source to `WORKBENCH_LANE_PATHS`, so a PR changing it runs your test. "Workbench-only" means code that does something different on Workbench and that no other lane exercises (for example, managed credentials). Don't add broad feature folders: every PR touching them would pay for a Workbench build and the cloud sign-ins.
- **Renaming or moving a listed file:** update its glob. `scripts/test/pr-tags-lib-test.sh` fails if a glob stops matching any tracked file.
- **New files under `test/e2e/tests/workbench/` or `test/e2e/pages/workbench/`:** nothing to do, the globs already cover them.
