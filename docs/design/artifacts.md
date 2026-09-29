# Artifact handling design

_Last updated: 2026-09-29_

`ArtifactsScreen.tsx` presents tour-scoped files, `artifactApi.ts` obtains artifact metadata and authorized transfer operations, and `artifactUploader.ts` handles client uploads. The backend owns storage, authorization and object keys; this app does not provision or directly manage AWS resources. Do not embed permanent storage credentials or expose another tour's files.

The app may cache downloaded content for later use, with a reset option in Advanced Settings. Loading and upload errors must be visible to the user. See [artifact requirements](../requirements/artifacts.md) and backend [API reference](https://github.com/kvijay77-in/tour-data-api/blob/main/docs/design/api-reference.md).
