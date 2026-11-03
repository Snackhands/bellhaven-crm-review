# Tool Rack runtime subset

Local-only integration of package `@tool-shed/tool-rack` 0.5.0. QueueDatePicker item 0.3.1 is `canonical-candidate`; Select in ui-primitives 0.5.0 and dialog-motion 0.5.0 remain `candidate` items, used under Jordan's explicit bounded evaluation requests. Select and date-picker host browser acceptance completed on November 3, 2026; the upstream candidate status is unchanged. Dialog host browser acceptance remains pending the combined parent pass.

Inspected registry revision is the SHA-256 below. Registry source snapshot identifiers: `source-2026-09-17-29973fe-working-tree` and `source-2026-10-06-29973fe-working-tree`. Historical source commit `29973fee97061fe924ed12cd2926b48ef5d16fc1` describes provenance, not a runtime dependency.

Select, QueueDatePicker, DialogSurface, useDialogMotion, their required neutral types and relevant styles are included in `vendor/tool-rack`. The host imports the public package entry and styles entry via a relative package dependency. No registry archive, instructions, source application files, customer data or private paths are packaged. No license claim or publishing step is introduced.

Scoped changes: ui.tsx and contracts.ts are reduced to the required exports; styles.css is reduced to the runtime selectors and reduced-motion closure; picker month/year controls reuse Select; the picker focus lookup uses a checked HTMLButtonElement. Host CSS aligns calendar month/year Select layout with the existing picker grid and uses equal 12px text/chevron insets. Metadata exposes only this subset and React 18/19 peers.

| Inspected upstream file | SHA-256 |
| --- | --- |
| `registry.json` | `3a859140c2585b9f0289b51424210da9a950a18a4b496b63542ff28c74e33764` |
| `package.json` | `a3d287a5a5184c620e8e6d5e2d893f1150018d9c30a0909e8729a33ba776f367` |
| `src/ui.tsx` | `715141b0cd23470bc80ff92e1e9f8ec426d4a0d8400393a6a62b4396666990f2` |
| `src/queue-date-picker.tsx` | `492fbb3bc1b74dcb9eed729ea6bd5c4dc09c281da8f4db8f4ccf51970771a0c1` |
| `src/contracts.ts` | `d3dc89f1bd5b528a2bd433ac059c5ec34c6dee049b868daa5afbd113cc7f73dc` |
| `src/styles.css` | `61385fca0c0563482d05f2b1a49a47cc721717435a231848ff7bf033afe52bc3` |

Guide dialog evaluation on 2026-11-03 adds only the neutral `dialog-surface.tsx` and the `useDialogMotion` closure from `dialog-motion.ts`. The unused `useDialogState` and its state import are omitted. Origin resolution replaces an unnecessary cast with narrowing. Required dialog contracts, public exports and dialog CSS/motion rules are retained; host-owned `guide.css` supplies the 80% remaining-workspace, 82dvh desktop and 85dvh phone geometry. `.sidebar` supplies the measured offset. A stable ref receives the clicked stage tile, and the mounted dialog remains present after `open` becomes false for the 220ms exit. No source application modules or private content were copied.

Dialog provenance is registry item `dialog-motion` 0.5.0, status `candidate`, source commit `29973fee97061fe924ed12cd2926b48ef5d16fc1`, snapshot `dialog-source-2026-10-07-29973fe-working-tree`. This remains an unaccepted upstream candidate; passing host checks do not promote it. No license claim or publication is introduced.

| Additional inspected upstream file | SHA-256 |
| --- | --- |
| `src/dialog-surface.tsx` | `03a8e4ba8d20add1ca3ca492996b0a819c3bb3b9098406af7edef2aa66f2e4b9` |
| `src/dialog-motion.ts` | `8e30df6b21c17429d79d5cb1e0bbade58ead0afa7732d8535ba7a79eb04e52dd` |
| `registry/dialog-source-hashes-2026-10-07.json` | `3dd2e0425f49fb933f3765f3a94cc9649563cd5383601ee41f485640f003d792` |

Current guide validation: root `npm run typecheck`, `npm run build` and the full `npm --prefix web test` pass. Guide tests exercise stage navigation, one explanation at a time, all ten registry rules, both ownership branches, unknown-finance blocking, absence restrictions, duplicate restrictions, unchanged handling, approval/rejection explanations, close/Escape/outside dismissal, ignored inside drags, trigger focus restoration, retained 220ms exit, sidebar placement, scroll cleanup and reduced motion. The combined frontend suite has 93 passing checks; the Guide/Evidence focused subset has 29. Browser APIs are mocked in jsdom. Parent Chrome acceptance confirmed desktop and 390px diagram legibility, modal scrolling, reset-on-open, clear failure-route labels, Escape/outside dismissal and trigger focus return. OS-level reduced-motion toggling was not separately exercised. Upstream `python3 tests/check_registry.py` passes for package 0.5.0.

Historical validation follows.

Validation on 2026-11-03: `npm ci --prefix web`, `npm run build --prefix web` and `npm test --prefix web` pass, including 38 frontend checks. The upstream package's declared `python3 tests/check_registry.py` check passes at package 0.5.0. Host tests cover run-specific decisions and history, read-only saved versions, local-only reset, actual-result truth, backend comparison values, rule flags, all five cadences, six-week range grids, explicit end-date clearing and parent/picker Escape and focus behavior. React review checked hook ordering, primitive effect dependencies, stale-request cleanup, native labels and popup focus scope.

No live calls, CRM writes, source application changes or publication were performed. Parent browser checks verified desktop and 390-pixel calendar layout, persisted cadence selection, standardized dropdown spacing, Escape dismissal and focus return. Reduced-motion styles are present, but OS-level reduced-motion toggling was not separately browser-tested. The combined host suite at that earlier checkpoint totaled 45. Select remains an evaluation candidate.

Vendored runtime SHA-256 values follow. Paths are relative to this repository.

| Runtime file | SHA-256 |
| --- | --- |
| `vendor/tool-rack/package.json` | `9fe4d1fe5a8733f99b9afd6c5632e32663f2111a08883f6e3c7a4940ff14a755` |
| `vendor/tool-rack/src/contracts.ts` | `bdad80e763e10aae4a17769e391c72fc8f34ccacc364223d33a5fc664852ed6e` |
| `vendor/tool-rack/src/dialog-motion.ts` | `179cee2263c4549efd14ff247383251820dec3b688c44926d7ca711eb04d4476` |
| `vendor/tool-rack/src/dialog-surface.tsx` | `03a8e4ba8d20add1ca3ca492996b0a819c3bb3b9098406af7edef2aa66f2e4b9` |
| `vendor/tool-rack/src/index.ts` | `c49e578d04f3a373663611f962539adb6240a7f285c7247218e88d18fc84ecaa` |
| `vendor/tool-rack/src/queue-date-picker.tsx` | `4347273915b643807ae2ded38db9789d86f1a0c1b4891ce49169c9ccb5df714d` |
| `vendor/tool-rack/src/styles.css` | `a4e77b79ec7f9d24be167d40bc16d15f6763774e04a53ec4310a04696f7389f0` |
| `vendor/tool-rack/src/ui.tsx` | `7ba6ebc29680b467b2b631692f916b3669b85eebd20499b74ec0097ce3fa707d` |
