# Documentation Index

[← Back to README](../README.md)

This page provides a guide to all project documentation.

## Documentation Files

| Document | Description |
|----------|-------------|
| [Development Guide](development-guide.md) | Environment setup, running the app, testing, code quality, troubleshooting |
| [Release Guide](release-guide.md) | Building and distributing the ToT Android APK via EAS Build |
| [Requirements](Requirements.md) | Detailed functional requirements, use cases, feature specifications, and business rules |
| [Solution Design](SolutionDesign.md) | Architecture, design principles, component structure, technical decisions |
| [Dashboard Feature](Dashboard-Feature.md) | Dashboard screen specification — grid display, stages, sorting, zoom levels, color coding |
| [Data Integration Design](DataIntegrationDesign.md) | Backend API integration architecture, offline sync design, conflict resolution |
| [Dashboard API Optimization Proposal](Dashboard-API-Optimization-Proposal.md) | Approved dashboard API split contract (progress payload + rider-details on demand + ETag behavior) |
| [Dashboard Call Trigger Baseline](dashboard-call-trigger-baseline.md) | Baseline trigger-to-call matrix used for API efficiency refactor verification |
| [Dashboard Call Audit Checklist](dashboard-call-audit-checklist.md) | Duplicate-call classification checklist (true duplicate vs retry behavior) |
| [Generic App Distribution Analysis](Generic-App-Distribution-Analysis.md) | Feasibility analysis for distributing a single generic app across multiple organizer AWS subscriptions |
| [Dashboard Backend API Change Request](dashboard-backend-api-change-request.md) | Change request to include `checkedInByName` or a minimal user mapping endpoint |
| [Project Structure](project-structure.md) | Project folder organization and code structure |
| [Migration Cleanup](migration-cleanup.md) | Obsolete/superseded code from the SPA→multi-screen navigation migration, pending user sign-off before removal |

## Quick Navigation

### Getting Started (New Developer)
1. Read the [README](../README.md) for a project overview
2. Review [Requirements](Requirements.md) to understand the application features
3. Check [Solution Design](SolutionDesign.md) for architecture and technical decisions
4. Follow [Development Guide](development-guide.md) to set up your environment and run the app

### For Developers
- **Environment setup**: [Development Guide → Prerequisites](development-guide.md#prerequisites)
- **Running the app**: [Development Guide → Running the App](development-guide.md#running-the-app)
- **Linting and formatting**: [Development Guide → Code Quality](development-guide.md#code-quality)
- **Useful commands**: [Development Guide → Useful Commands](development-guide.md#useful-commands)
- **Troubleshooting**: [Development Guide → Troubleshooting](development-guide.md#troubleshooting)

### For Understanding Features
- **Dashboard details**: [Dashboard Feature](Dashboard-Feature.md) — grid, stages, sorting, zoom, color coding
- **Check-in process**: [Requirements → Check-In](Requirements.md#check-in)
- **Role-based access**: [Requirements → Role Based App Access](Requirements.md#role-based-app-access)
- **Ride status transitions (Admin)**: [Requirements → Ride Status Management](Requirements.md#ride-status-management)
- **Offline capability**: [Requirements → Offline Capability](Requirements.md#offline-capability)

### For Backend Integration
- **API integration overview**: [Data Integration Design → API Approach Analysis](DataIntegrationDesign.md#1-api-approach-analysis)
- **Dashboard split-load flow (Phase 3)**: [Data Integration Design → Dashboard API Split](DataIntegrationDesign.md#325-dashboard-api-split-implemented-in-phase-3)
- **Dashboard trigger controls (Phase 4)**: [Data Integration Design → Dashboard Trigger Strategy and Duplicate-Call Controls](DataIntegrationDesign.md#326-dashboard-trigger-strategy-and-duplicate-call-controls-implemented-in-phase-4)
- **Service layer design**: [Data Integration Design → Service Layer Design](DataIntegrationDesign.md#22-service-layer-design)
- **Offline sync design**: [Data Integration Design → Offline Support Design](DataIntegrationDesign.md#4-offline-support-design)
- **Conflict resolution**: [Data Integration Design → Conflict Resolution](DataIntegrationDesign.md#45-conflict-resolution)
- **Data model alignment**: [Data Integration Design → Data Model Alignment](DataIntegrationDesign.md#3-data-model-alignment)

### For Architecture
- **Design principles**: [Solution Design → Design Principles](SolutionDesign.md#design-principles)
- **Component architecture**: [Solution Design → Component Architecture](SolutionDesign.md#component-architecture)
- **State management**: [Solution Design → State Management](SolutionDesign.md#state-management)
- **Authentication flow**: [Solution Design → Authentication](SolutionDesign.md#authentication)
- **Project structure**: [Project Structure](project-structure.md)
- **App distribution / generic app**: [Solution Design → App Distribution](SolutionDesign.md#app-distribution--runtime-configuration-single-app-multiple-organizers) | [Analysis](Generic-App-Distribution-Analysis.md)

## External Resources

- [React Native Documentation](https://reactnative.dev/docs/getting-started)
- [Expo Documentation](https://docs.expo.dev/)
- [AWS Amplify Gen 2 Documentation](https://docs.amplify.aws/)
- [AWS Cognito Documentation](https://docs.aws.amazon.com/cognito/)
- [tour-data-api Repository](https://github.com/kvijay77-in/tour-data-api) — Backend API

---

[← Back to README](../README.md)
