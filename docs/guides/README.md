# Developer guides

_Last updated: 2026-10-04_

- [Development](development.md) — local install and checks
- [Configuration](configuration.md) — environment templates and organizer setup tool
- [Release](release.md) — EAS app builds and distribution
- [EAS build and release](eas-build-and-release.md) — Test/Production profiles, credentials, store setup and release checklist
- [Project structure](project-structure.md) — current source layout
- [Web deployment](web-deployment.md) — SAM setup, automated build/publication, scoped identities, lock recovery and exact-artifact rollback

**Backend infrastructure is not deployed from this app.** Cognito, API, data and file-storage resources are owned by [tour-data-api](https://github.com/kvijay77-in/tour-data-api/blob/main/docs/guides/deployment.md). This app repository separately owns only its static web hosting and publisher role; the [web deployment guide](web-deployment.md) covers those resources. The EAS release guide remains about mobile builds.
