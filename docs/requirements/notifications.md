# Notifications

_Last updated: 2026-09-29_

Users can read their notifications in the inbox and follow a notification to the relevant available screen. Authorized administrators can compose announcements, manage scheduled reminders and manage notification rules. The UI must honor audience, assignment and role restrictions and show delivery or validation errors without silently dropping a request. Push permission is optional; inbox access is not dependent on granting push permission. See [notification design](../design/notifications.md).

Show unread count on the bell, support marking items read and cache recent inbox items for mobile offline reading. Only known destinations may open from a notification; unknown or inaccessible destinations fall back to the inbox. The browser uses the inbox without registering a push device. Administrator announcements support appropriate audiences and an optional push toggle; reminders target an active ride or occurrence; rules support validation and enable/disable controls. Show the result of sending rather than assuming delivery.
