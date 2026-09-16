# P34 — Unit Test Suite Release Baseline QA

- Date: 2026-09-16
- Base/main SHA: `37468933f3463825528ea6a2236db13f025e058b` (PR #33 merge commit = `origin/main`)
- Branch: `qa/test-suite-release-baseline` — PR [#34](https://github.com/sawal123/pos-mobile/pull/34) (same branch, same PR)
- Code fix revision: `52cdcc3` (business-template spec repair)
- Report revision: this commit, on the same branch
- **Production code changed: NO** — the diff against the base SHA touches only `src/__tests__/business-template.spec.js` and `docs/qa/P34_TEST_SUITE_RELEASE_BASELINE_QA.md`
- Environment: Node `v22.18.0`, npm `10.9.3`, Vitest `4.1.11`, Vue `3.5.41`, `@vue/test-utils` `2.4.11`, Windows

## Objective

Establish a fully green unit-test baseline on `main` so later phases can distinguish a real regression from inherited baseline noise. At the base SHA the suite carried exactly one failure, which P33 recorded as pre-existing and deliberately left unfixed.

## Regression fixed

`src/__tests__/business-template.spec.js` — test-only change, no production file touched.

| Item | Detail |
|---|---|
| Failing test | `business template onboarding > fresh Laundry setup menerapkan template tanpa katalog Cafe` |
| Error at base SHA | `Error: Cannot call setValue on an empty DOMWrapper` — `business-template.spec.js:125`, `wrapper.find('input[aria-label="Nama Toko"]')` |

**Root cause (verified empirically, not assumed).** The spec stubbed `BaseInput` with an inline template that injected `aria-label` from the `label` prop, so the selector depended entirely on that stub. The name-keyed stub is never applied in this mount: a debug mount that gave `BaseInput`, `BaseButton`, and `BaseCard` distinctive marker classes rendered none of them (`BASEBUTTON_STUB_APPLIED=false`, `BASECARD_STUB_APPLIED=false`, `INPUT_COUNT=4`), while `BaseInput.__name === 'BaseInput'` resolved correctly, and the result was unchanged with the `vite-plugin-vue-devtools` instrumentation removed from the test config. The view therefore rendered the production `BaseInput`, whose `<input>` carries no `aria-label`, and the attribute selector matched nothing.

**Fix (retained unchanged).** The spec mounts the production base components and reaches the field through the real component: `findAllComponents(BaseInput)` matched by `props('label')`, then `setValue` on its inner `input`. The inert `stubs` block was deleted — safe because the debug mount proves none of its three entries ever applied, so removal cannot change behavior. All 9 tests in the file are retained, and the file was not modified again during the baseline-gate work.

## Historical reports are immutable

The code-fix revision initially appended a "superseded" note inside P33's QA report. That edit has been reverted: `docs/qa/P33_ANDROID_BLUETOOTH_PRINTER_QA.md` is byte-identical to the base SHA and is no longer part of this branch's diff. The P33 blocker `FULL_UNIT_SUITE_PREEXISTING_UI_FAILURE` is therefore recorded as **superseded** here rather than amended in place.

## Release baseline gates

| # | Gate | Result | Evidence |
|---|---|---|---|
| 1 | Targeted run **#1** — `npm run test:unit -- --run src/__tests__/business-template.spec.js` | PASS | 1 file, 9/9 tests |
| 2 | Targeted run **#2** — same command, separate execution | PASS | 1 file, 9/9 tests |
| 3 | Full unit run **#1** — `npm run test:unit -- --run` | PASS | 37/37 files, 1078/1078 tests, **0 failed** |
| 4 | Full unit run **#2** — same command, separate execution | PASS | 37/37 files, 1078/1078 tests, **0 failed** |
| 5 | Test hygiene audit — `it/test/describe.skip`, `it/test/describe.only`, `it/test.todo`, and any `.skip(` / `.only(` / `.todo(` variant under `src/__tests__` | PASS | rg/grep over `src/__tests__`: **no matches** |
| 6 | Changed-file ESLint — `npx eslint src/__tests__/business-template.spec.js` | PASS | 0 problems |
| 7 | Changed-file oxlint — `npx oxlint src/__tests__/business-template.spec.js` | PASS | 0 warnings, 0 errors (132 rules) |
| 8 | `npm run build` | PASS | Vite production build completed |
| 9 | `npx cap sync android` | PASS | Web assets copied to `android/app/src/main/assets/public`; 4 npm plugins detected (`@aparajita/capacitor-secure-storage@8.0.0`, `@capacitor-community/sqlite@8.1.1`, `@capacitor/app@8.1.1`, `@capacitor/network@8.0.1`). The in-repo `BluetoothPrinter` plugin is registered in `MainActivity`, not an npm plugin |
| 10 | `gradlew.bat assembleDebug` | PASS | Executed as `gradlew.bat clean assembleDebug` → `BUILD SUCCESSFUL in 33s`, with `:app:compileDebugJavaWithJavac` and `:app:packageDebug` actually executed; APK at `android/app/build/outputs/apk/debug/app-debug.apk` (13,370,184 bytes) |
| 11 | `git diff --check` | PASS | No whitespace errors |
| 12 | `DB_VERSION` | PASS | `src/services/database/schema.js` → `export const DB_VERSION = 4`; asserted by `database-migration-v2.spec.js` ("DB_VERSION sekarang 4"). No schema, migration, or version change in this phase |

No `skip` / `only` / `todo` marker was introduced to force any gate green. Runs #1 and #2 for both the targeted spec and the full suite are reported separately; both passed on their own.

**Note on the Gradle gate.** A plain `assembleDebug` reported every task `UP-TO-DATE`, which is expected: P34 changes no production code and the web build output is byte-identical to the P33 revision. The gate was therefore run as a clean build so the PASS rests on an actual compile rather than a cache hit.

## Baseline comparison

| Revision | `business-template.spec.js` | Full unit suite |
|---|---|---|
| `3746893` (`main`) | 1 FAIL / 8 PASS | 36/37 files, 1077/1078 tests |
| `qa/test-suite-release-baseline` | 9 PASS | 37/37 files, 1078/1078 tests |

The base-SHA failure was reproduced directly by stashing the fix and re-running the targeted spec, so the regression evidence is measured, not inferred.

## Known debt (pre-existing at base SHA — NOT a P34 gate)

- Global `npx eslint .`: 275 errors / 2 warnings, dominated by generated artifacts under `android/app/build/intermediates/**` and `android/app/src/main/assets/public/**` that are not excluded from linting, plus unused-variable and `no-useless-assignment` findings in `src/services/sync/*` and several views.
- Global `npx oxlint .`: 62 errors of the same classes (unused imports/variables, duplicate key in `src/__tests__/helpers/syncScenarioServer.js`).

Both are identical to the base SHA and outside this phase's scope. Global lint is explicitly **not** a release-baseline gate for P34; only the changed test file was linted.

## Bluetooth hardware

**MANUAL REQUIRED** — no paired Bluetooth thermal printer is available on the connected device. Carried over from P33; it does not block P34, which covers compile/build baseline only (no `adb`, no APK install, no printer hardware).

## Verdict

**READY** — the targeted spec passes twice, the full unit suite passes twice at 37/37 files and 1078/1078 tests with zero failures, the hygiene audit is clean, the changed file passes both linters, the web build, Capacitor sync and a clean Gradle `assembleDebug` all succeed, `DB_VERSION` remains 4, and no production code was changed.
