# Rider profile rendering design

_Last updated: 2026-09-29_

`RiderProfileDefinitionsScreen.tsx` maintains definitions, with editing helpers in `src/utils/riderProfileDefinitions.ts` and `riderProfileDefinitionEditor.ts`. `RiderProfileRenderer.tsx` displays permitted attributes on a rider card and `RiderProfileAdminEditModal.tsx` edits attributes where authorized. `riderProfileConfigService.ts` and `riderProfileConfigApi.ts` obtain definitions from the backend; `riderProfileMasking.ts` and `riderProfilePermissions.ts` control presentation of restricted values.

Definitions describe how data is displayed and validated, not permission to see all rider data. Check both tour/role access and attribute-level visibility before presenting or editing a field. See [user management requirements](../requirements/user-management.md) and backend [RBAC](https://github.com/kvijay77-in/tour-data-api/blob/main/docs/design/rbac.md).
