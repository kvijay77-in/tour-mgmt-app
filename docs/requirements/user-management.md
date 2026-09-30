# Users and rider profile definitions

_Last updated: 2026-09-29_

Administrators onboard users, assign roles, edit or disable users and manage their tour assignments. Assignments limit event, hotel and tour-specific access; a role alone is insufficient to grant access to an unassigned event. Administrators can manage rider profile definitions and permitted rider attributes; other users see only attributes they are allowed to view or edit. The UI must mask restricted attributes and validate entries before submission. See [rider profile design](../design/rider-profile.md) and the backend [RBAC reference](https://github.com/kvijay77-in/tour-data-api/blob/main/docs/design/rbac.md).

Onboarding requires an email address; after success, offer assignment to the current tour. A tour assignment chooses an eligible stage for pit-stop roles, a hotel for Hotel Staff and assigned events/dates, with optional activity narrowing. User identity and role-derived fields are not editable in the tour assignment form. Deleting a user requires an explicit irreversible-action confirmation.

Profile definitions cover sections, attributes and lists of values. Immutable system fields cannot be removed or retyped. A stale definition edit must reload before retrying. Rider cards show only enabled, server-authorized attributes in configured order; sensitive values are masked until intentionally revealed, and never stored in the offline cache. Administrator edits of eligible profile values require an online connection.
