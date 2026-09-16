# P34 — Unit Test Suite Release Baseline QA

- Date: 2026-09-16
- Base/main SHA: `37468933f3463825528ea6a2236db13f025e058b` (PR #33 merge commit = `origin/main`)
- Branch: `qa/test-suite-release-baseline`
- Supersedes: `FULL_UNIT_SUITE_PREEXISTING_UI_FAILURE` from [P33](./P33_ANDROID_BLUETOOTH_PRINTER_QA.md)
- Environment: Node `v22.18.0`, npm `10.9.3`, Vitest `4.1.11`, Vue `3.5.41`, `@vue/test-utils` `2.4.11`, Windows

## Objective

Establish a fully green unit-test baseline on `main` so later phases can distinguish a real regression from inherited baseline noise. At the base SHA the suite carried exactly one failure, recorded by P33 as pre-existing and deliberately unfixed.

## Regression fixed

`src/__tests__/business-template.spec.js` — test-only change, no production file touched.

| Item | Detail |
|---|---|
| Failing test | `business template onboarding > fresh Laundry setup menerapkan template tanpa katalog Cafe` |
| Error at base SHA | `Error: Cannot call setValue on an empty DOMWrapper` — `business-template.spec.js:125`, `wrapper.find('input[aria-label="Nama Toko"]')` |

**Root cause (verified empirically, not assumed).** The spec stubbed `BaseInput` with an inline template that injected `aria-label` from the `label` prop, so the selector depended entirely on that stub. The name-keyed stub is never applied in this mount: a debug mount that gave `BaseInput`, `BaseButton`, and `BaseCard` distinctive marker classes rendered none of them (`BASEBUTTON_STUB_APPLIED=false`, `BASECARD_STUB_APPLIED=false`, `INPUT_COUNT=4`), while `BaseInput.__name === 'BaseInput'` resolved correctly, and the result was unchanged with the `vite-plugin-vue-devtools` instrumentation removed from the test config. The view therefore rendered the production `BaseInput`, whose `<input>` carries no `aria-label`, and the attribute selector matched nothing.

**Fix.** The spec mounts the production base components and reaches the field through the real component: `findAllComponents(BaseInput)` matched by `props('label')`, then `setValue` on its inner `input`. The inert `stubs` block was deleted — safe because the debug mount proves none of its three entries ever applied, so removal cannot change behavior. All 9 tests in the file are retained.

## Automated results

| Check | Result | Detail |
|---|---|---|
| `npm run test:unit -- --run` | PASS | 37/37 files, 1078/1078 tests |
| `business-template.spec.js` (targeted, post-fix) | PASS | 9/9 |
| `business-template.spec.js` (targeted, base SHA) | FAIL | 1 failed / 8 passed — regression evidence confirmed at the base commit |
| `npm run build` | PASS | Vite production build completed |
| `git diff --check` | PASS | No whitespace errors |
| Changed-file ESLint | PASS | `business-template.spec.js` reports no lint errors |

## Baseline comparison

| Revision | `business-template.spec.js` | Full unit suite |
|---|---|---|
| `3746893` (`main`) | 1 FAIL / 8 PASS | 36/37 files, 1077/1078 tests |
| `qa/test-suite-release-baseline` (this fix) | 9 PASS | 37/37 files, 1078/1078 tests |

## Known debt (pre-existing at base SHA, not fixed)

- `npx eslint .` — 275 errors / 2 warnings, dominated by generated artifacts under `android/app/build/intermediates/**` and `android/app/src/main/assets/public/**` that are not excluded from linting, plus unused-variable and `no-useless-assignment` findings in `src/services/sync/*` and several views.
- `npx oxlint .` — 62 errors, same pre-existing classes (unused imports/variables, duplicate key in `src/__tests__/helpers/syncScenarioServer.js`).
- Both are byte-identical to the base SHA and outside this phase's scope. Lint is therefore **not** claimed as a green release gate here; only the unit suite and the production build are claimed.

## Verdict

**Final status: SELESAI** — the unit suite is green at 37/37 files and 1078/1078 tests with zero inherited failures, so the release baseline is established. Lint debt is reported, not fixed.
