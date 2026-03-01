# Development Guide

[← Back to README](../README.md)

Complete guide for setting up your development environment, running the app, testing, and daily development workflows.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Initial Setup](#initial-setup)
- [Running the App](#running-the-app)
- [Code Quality](#code-quality)
- [Environment Configuration](#environment-configuration)
- [Useful Commands](#useful-commands)
- [Troubleshooting](#troubleshooting)
- [Support](#support)

---

## Prerequisites

| Tool | Version | Purpose | Install Guide |
|------|---------|---------|---------------|
| **Node.js** | 18+ (LTS recommended) | JavaScript runtime | [nodejs.org](https://nodejs.org/) |
| **npm** | 9+ (comes with Node.js) | Package manager | Bundled with Node.js |
| **Git** | Any | Version control | [git-scm.com](https://git-scm.com/) |
| **Expo Go** | Latest | Run app on physical device | [App Store](https://apps.apple.com/app/expo-go/id982107779) / [Play Store](https://play.google.com/store/apps/details?id=host.exp.exponent) |

**For iOS development (macOS only):**

| Tool | Version | Purpose |
|------|---------|---------|
| **Xcode** | Latest | iOS Simulator |
| **Watchman** | Latest | File watching for hot reload |

**For Android development:**

| Tool | Version | Purpose |
|------|---------|---------|
| **Android Studio** | Latest | Android Emulator and SDK |
| **Java JDK** | 17+ | Required by Android toolchain |

> **Note**: For quick development and testing, Expo Go on a physical device is sufficient — no need for simulators or emulators.

---

## Initial Setup

### 1. Clone the Repository

```bash
git clone <repository-url>
cd poc-app
```

### 2. Install Dependencies

```bash
npm install
```

This installs all dependencies listed in `package.json`, including React Native, Expo, AWS Amplify, and all supporting libraries.

### 3. Environment Configuration

Create a `.env` file from the template:

```bash
cp .env.example .env
```

Update the `.env` file with your environment-specific values:

```
# Tour Data API
TOUR_DATA_API_BASE_URL=https://<api-id>.execute-api.<region>.amazonaws.com/v1

# AWS Cognito (for JWT authentication)
AWS_REGION=<region>
AWS_USER_POOL_ID=<user-pool-id>
AWS_USER_POOL_WEB_CLIENT_ID=<client-id>
AWS_IDENTITY_POOL_ID=<identity-pool-id>
```

These values come from the [tour-data-api](https://github.com/kvijay77-in/tour-data-api) deployment. See the tour-data-api [Deployment Guide](https://github.com/kvijay77-in/tour-data-api/blob/main/docs/deployment-guide.md#after-deployment-getting-your-api-url) for how to retrieve API URLs and Cognito configuration.

### 4. Verify Setup

```bash
# Start the app to verify everything works
npx expo start
```

You should see the Expo developer tools with a QR code. Scan it with Expo Go to run on your device, or press the appropriate key to open in a simulator/browser.

---

## Running the App

### Development Server

```bash
# Start Expo development server (interactive mode)
npx expo start

# Or use npm scripts
npm start
```

The Expo CLI will display options:
- Press `a` to open on Android emulator
- Press `i` to open on iOS simulator
- Press `w` to open in web browser
- Scan the QR code with Expo Go on a physical device

### Platform-Specific

```bash
# Android
npm run android
# or
npx expo start --android

# iOS (macOS only)
npm run ios
# or
npx expo start --ios

# Web
npm run web
# or
npx expo start --web
```

### Development with Mock Data

The app currently includes a mock data service (`src/services/api/mockData.ts`) for development without a live backend. This allows working on UI features independently of the tour-data-api deployment.

> **Note**: As backend integration progresses, mock data will be replaced with live API calls. The mock data service is retained for development and testing convenience.

---

## Code Quality

### Linting

The project uses ESLint with TypeScript support for code quality:

```bash
# Run linter
npm run lint

# Run linter with auto-fix
npm run lint:fix
```

### ESLint Configuration

ESLint is configured in `eslint.config.js` with:
- TypeScript ESLint plugin and parser
- React and React Hooks plugins
- Expo ESLint configuration

### Before Committing

Always run the linter before committing code:

```bash
npm run lint
```

Fix all errors and warnings before creating a pull request.

### Coding Standards

- **Functional components** with React Hooks (no class components)
- **TypeScript** for all files (`.ts` / `.tsx`)
- **StyleSheet** or styled-components for styling (no inline styles)
- **JSDoc comments** for complex functions and components
- **Modular code** — keep components small and reusable
- **Constants** for magic values — use `src/constants/` for colors, roles, stages
- **Environment variables** for all configuration — no hardcoded URLs or credentials

### Date and Time Standards

All date/time values should follow **ISO 8601** format, consistent with the backend:

| Format | Example | Usage |
|--------|---------|-------|
| Date | `YYYY-MM-DD` | `2026-03-01` |
| DateTime | `YYYY-MM-DDTHH:MM:SSZ` | `2026-03-01T17:00:00Z` |
| Time | `HH:MM` (24-hour) | `06:30` |

All timestamps should be in UTC with the `Z` suffix.

---

## Environment Configuration

### Required Environment Variables

| Variable | Description | Source |
|----------|-------------|--------|
| `TOUR_DATA_API_BASE_URL` | Base URL for the tour-data-api | tour-data-api deployment output |
| `AWS_REGION` | AWS region (e.g., `ap-south-1`) | Your AWS configuration |
| `AWS_USER_POOL_ID` | Cognito User Pool ID | tour-data-api deployment output |
| `AWS_USER_POOL_WEB_CLIENT_ID` | Cognito App Client ID | tour-data-api deployment output |
| `AWS_IDENTITY_POOL_ID` | Cognito Identity Pool ID | tour-data-api deployment output (if applicable) |

### Amplify Configuration

AWS Amplify is configured in `src/config/amplify.ts` (as per project structure). The configuration reads from environment variables — never hardcode values.

---

## Useful Commands

| Command | Description |
|---------|-------------|
| `npm install` | Install all dependencies |
| `npx expo start` | Start Expo development server |
| `npm run android` | Start on Android emulator/device |
| `npm run ios` | Start on iOS simulator/device |
| `npm run web` | Start in web browser |
| `npm run lint` | Run ESLint linter |
| `npm run lint:fix` | Run ESLint with auto-fix |

### Expo CLI Commands

| Command | Description |
|---------|-------------|
| `npx expo start --clear` | Start with cache cleared |
| `npx expo start --tunnel` | Start with tunnel (for network issues) |
| `npx expo install <package>` | Install Expo-compatible package version |
| `npx expo doctor` | Check for common issues |

> **Important**: Do not install Expo CLI globally (`npm install -g expo-cli` is deprecated). Always use `npx expo` to run Expo commands.

---

## Troubleshooting

### `npx expo start` Fails

```bash
# Clear cache and reinstall
rm -rf node_modules
npm install
npx expo start --clear
```

**Common causes:**
- **Node version mismatch**: Ensure Node.js 18+ is installed (`node --version`)
- **Corrupted node_modules**: Delete and reinstall (`rm -rf node_modules && npm install`)
- **Port conflict**: Default port 8081 may be in use. Use `npx expo start --port 8082`
- **Stale cache**: Use `--clear` flag to clear Expo cache

### Metro Bundler Errors

```bash
# Clear Metro cache
npx expo start --clear

# Reset watchman (macOS)
watchman watch-del-all
```

**Common causes:**
- **Import errors**: Verify all imports point to existing files
- **Type errors**: Check TypeScript errors with your IDE
- **Missing module**: Run `npm install` if a dependency is missing

### Android Emulator Not Detected

```bash
# Verify ADB is accessible
adb devices

# Start emulator manually from Android Studio
# Then run:
npx expo start --android
```

### iOS Simulator Not Opening (macOS)

```bash
# Verify Xcode is installed
xcode-select --install

# Open simulator manually
open -a Simulator

# Then run:
npx expo start --ios
```

### Expo Go Connection Issues

- Ensure your phone and computer are on the **same WiFi network**
- Try `npx expo start --tunnel` for network issues
- Update Expo Go to the latest version on your device
- Check firewall settings — Expo needs port 8081

### Build or Dependency Issues

```bash
# Check for known issues
npx expo doctor

# Re-install with clean slate
rm -rf node_modules package-lock.json
npm install

# Verify compatible package versions
npx expo install --check
```

### ESLint Errors

```bash
# Run lint to see all issues
npm run lint

# Auto-fix what can be fixed
npm run lint:fix
```

**Common causes:**
- **Unused imports**: Remove imports that are not referenced
- **Missing types**: Add TypeScript type annotations
- **Hook violations**: Follow React Hooks rules (no conditional hooks, hooks only in components/custom hooks)

---

## Support

1. **Check documentation** in the `docs/` folder
2. **Review [Data Integration Design](DataIntegrationDesign.md)** for backend-related questions
3. **Check tour-data-api docs** for backend API details
4. **GitHub Issues** — create an issue with:
   - Error messages and screenshots
   - Steps to reproduce
   - Environment details (OS, Node version, Expo version, device/simulator)

### Useful Resources

- [Expo Documentation](https://docs.expo.dev/)
- [React Native Documentation](https://reactnative.dev/docs/getting-started)
- [React Navigation Documentation](https://reactnavigation.org/docs/getting-started)
- [AWS Amplify Gen 2 Documentation](https://docs.amplify.aws/)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [expo-sqlite Documentation](https://docs.expo.dev/versions/latest/sdk/sqlite/)

---

[← Back to README](../README.md)
