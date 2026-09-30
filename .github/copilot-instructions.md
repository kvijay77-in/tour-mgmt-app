# Contributor instructions

_Last updated: 2026-09-29_

Read [app requirements](../docs/requirements/README.md) before development, consult [architecture](../docs/design/architecture.md) and follow the [project structure](../docs/guides/project-structure.md). Ask for clarification when a request conflicts with documented requirements. Keep work scoped to the task, protect user data, use the centralized logger and validate changes with the existing checks described in [development](../docs/guides/development.md).

This is an Expo/React Native mobile and web client. Authentication uses Amplify Auth; all application data uses the tour-data-api HTTP API through `src/services/api/apiClient.ts`. The backend owns permissions, API contracts, authentication and storage infrastructure: [API reference](https://github.com/kvijay77-in/tour-data-api/blob/main/docs/design/api-reference.md), [RBAC](https://github.com/kvijay77-in/tour-data-api/blob/main/docs/design/rbac.md), [deployment](https://github.com/kvijay77-in/tour-data-api/blob/main/docs/guides/deployment.md). Mobile offline behavior is described in [data integration](../docs/design/data-integration-and-offline.md); the web experience is narrower.

Do not install Expo CLI globally; use `npx` or the package scripts. Avoid adding dependencies without a need, do not commit secrets or organizer-specific setup links, and use StyleSheet for component styling. Requirements belong only under `docs/requirements/`, design only under `docs/design/`, and the [platform glossary](https://github.com/kvijay77-in/cycling-tour-platform/blob/main/docs/glossary.md) is maintained externally.
