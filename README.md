# Bill Organizer

A React Native (iOS + Android) app, built with Expo, that captures bills/receipts (camera, OS share-sheet, or WhatsApp forward), parses them with a vision LLM, categorizes them, and tracks warranty/insurance expiries with reminders — plus a spend analytics dashboard.

See `prompt.md` for the full product spec and `CLAUDE.md` for architecture, conventions, and setup notes. For a full breakdown of the current implementation (architecture, database, edge functions, every feature, testing, and security), see [`docs/README.md`](docs/README.md).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)

This project uses [file-based routing](https://docs.expo.dev/router/introduction) via `src/app`. Because it relies on native config plugins (Share Extension, Firebase, RevenueCat), it runs as a development build rather than in Expo Go.

## Scripts

- `npm run start` — start the Metro bundler
- `npm run ios` / `npm run android` — run on simulator/emulator
- `npm run lint` — ESLint
- `npm run typecheck` — TypeScript, no emit
