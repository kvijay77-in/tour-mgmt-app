# Migration Cleanup — SPA → Multi-Screen Navigation

[← Back to README](../README.md)

This is the source-cleanup doc called for in the SPA→multi-screen migration's
approved decisions (see `/memories/repo/spa-to-multiscreen-migration-plan.md`,
repo memory, for the full phased implementation log).

**Nothing listed here has been deleted yet.** Per the approved plan, cleanup
is only executed **after user sign-off** — i.e. after manually validating the
new navigation flow across platforms/roles. Do not remove any of the items
below until every checkbox in the verification section is confirmed.

## Status

Migration phases P0–P4 (navigation shell, admin/check-in/change-password
routes, menu polish, docs) are all implemented. The items below are dead or
superseded code left in place intentionally, pending validation.

## Cleanup candidates

### 1. `RideStatusManagementScreen.onStatusChanged` — dead prop

- File: [src/screens/admin/RideStatusManagementScreen.tsx](../src/screens/admin/RideStatusManagementScreen.tsx)
- Pre-migration, `onStatusChanged?: () => void` was called by the screen to
  tell the Dashboard modal host to refresh after a ride status change. Since
  Phase 1, Dashboard refresh is handled by a single `useFocusEffect` in
  `DashboardScreen.tsx` that refetches whenever the screen regains focus.
  `RideStatusManagementRoute` in `src/navigation/AppNavigator.tsx` no longer
  passes this prop.
- Action (after sign-off): remove the `onStatusChanged` prop from
  `RideStatusManagementScreenProps`, its destructuring, and the internal
  call site.

### 2. `CheckInScreen.onCheckInComplete` / `onClose` / `ride` props — removed

- Files: [src/screens/checkin/CheckInScreen.tsx](../src/screens/checkin/CheckInScreen.tsx)
- **Done** as part of the Check-in/Dashboard tab redesign (see
  `/memories/repo/checkin-dashboard-redesign-plan.md` Phase 4). `CheckInScreen`
  is now rendered as a bare `Tab.Screen` component with no props — it reads
  `currentRide`/`isHistorical` from `RideSessionContext` directly and updates
  the shared `checkIns` list itself on a successful submit, so no route-level
  callback wiring is needed.

## Pending manual verification (block cleanup execution until all done)

- [ ] Android (device/emulator): login, dashboard, check-in (online + offline/
      airplane mode), every admin screen, change password, logout, hardware
      back button on every stack screen and on the AppMenu.
- [ ] iOS (simulator/device): same matrix.
- [ ] Web (react-native-web): same feature matrix, plus browser resize/
      orientation while the AppMenu slide-in panel or a modal is open.
- [ ] Per-role smoke test: `ADMINISTRATOR`, `SUPER_USER`, `PS_x_USER` (single
      and multiple pit-stop stage mappings), `HOTEL_STAFF`, `GUEST`.
- [ ] Offline check-in end-to-end: airplane mode → check-in → reconnect →
      confirm sync to DynamoDB.
- [ ] Historical ride read-only enforcement unaffected by the route migration.
- [ ] Pit-stop context picker still opens correctly from the new AppMenu and
      the selection still persists/validates across app restarts.

## Out of scope for this cleanup (pre-existing, unrelated to this migration)

These were already true before the migration started and are **not**
byproducts of it — flagging here only so they aren't confused with migration
cleanup items:

- `OfflineContext`/`useOffline` are defined but never mounted in the provider
  tree (offline support runs independently via SQLite + `syncService`).
- `docs/SolutionDesign.md` and `docs/project-structure.md` reference a
  `RoleContext.tsx` and a `src/hooks/` folder (`useAuth`, `useOffline`,
  `useSync`) that do not exist in the codebase. Not touched by this
  migration; needs a separate decision (implement, or correct the docs).

## Closing this out

Once every checkbox above is confirmed by the user: perform the two removals
under "Cleanup candidates", then delete this file (or mark it fully actioned)
and update the migration plan status to COMPLETE.
