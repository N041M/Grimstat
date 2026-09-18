# Grimstat for Android

The phone app is the web app's store build inside a Capacitor WebView. React, Dexie, the workers
and the battle table run in it as they do on the site. The app has storage of its own on the
phone, its database starts empty, and sync is how a player's lists arrive. The design is in
`docs/SYNC.md` under Phase 4.

## What the store build changes

The web app is built with three variables set (the `build:web` script below):

| Variable | Value | Effect |
|---|---|---|
| `VITE_STORE_BUILD` | `1` | No Ko-fi link on the About page or in the tour. No service worker and no web manifest. The recogniser's model is read uncompressed. The Capacitor glue in `apps/web/src/lib/native.ts` is loaded. |
| `VITE_SITE_URL` | `https://grimstat.com` | API calls and the Wahapedia copy are fetched from the site. See `apps/web/src/lib/site.ts`. |
| `VITE_BASE` | `/` | The build is served from the root of the WebView's origin. |

The WebView's origin is `https://localhost`. The API accepts it (`APP_ORIGINS` in
`apps/web/wrangler.jsonc`) and names it in its CORS answer, and the site's `_headers` file names
it for the Wahapedia copy. The recogniser's files (about 26 MB) are bundled into the app, so the
picture import works offline and needs no cross-origin setup.

## Building

Requirements: Java 21, the Android SDK with platform 36, and the workspace installed with
`pnpm install`. Android Studio installs the first two. Tell Gradle where the SDK is, once, in
`android/local.properties` (ignored by git):

```
sdk.dir=/Users/<you>/Library/Android/sdk
```

Then, from the repository root:

```bash
pnpm --filter @grimstat/mobile build:web
```

builds the web app with the store settings into `apps/web/dist`, fetching the recogniser's files
first if they are missing.

```bash
pnpm --filter @grimstat/mobile sync
```

copies the build into the Android project and updates the native plugins.

```bash
pnpm --filter @grimstat/mobile apk
```

makes `android/app/build/outputs/apk/debug/app-debug.apk`, for a phone or emulator connected
over adb (`adb install -r` that file).

```bash
pnpm --filter @grimstat/mobile bundle
```

makes `android/app/build/outputs/bundle/release/app-release.aab`, which is what Google Play
takes. It is signed with the upload key when `android/keystore.properties` exists, and unsigned
otherwise. `pnpm --filter @grimstat/mobile open` opens the project in Android Studio.

Before every upload raise `versionCode` in `android/app/build.gradle` by one and set
`versionName` to the release. Play refuses a bundle whose `versionCode` it has seen.

## The upload key, once

Play App Signing holds the key the installed app is signed with. What you make here is the
upload key, which signs what you send to Play.

```bash
keytool -genkeypair -v -keystore apps/mobile/android/upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
```

Then write `apps/mobile/android/keystore.properties`:

```
storeFile=upload.jks
storePassword=<the store password>
keyAlias=upload
keyPassword=<the key password>
```

Both files are ignored by git. Keep a copy of the keystore and the two passwords in a password
manager. A lost upload key can be reset through Play Console support. A lost keystore with no
copy means that reset.

## Google Play, once

1. A Play Console developer account at play.google.com/console, 25 USD once. Google verifies
   identity, which takes a few days. A personal account made after November 2023 has to run a
   closed test with the number of testers Play states (twelve at the time of writing) for
   fourteen days before it may publish to production.
2. Create the app: name Grimstat, default language English (United Kingdom), an app rather than a
   game, free. Free cannot be changed to paid later, and the app stays free.
3. Under Setup, App signing, keep Play App Signing. Copy the SHA-256 certificate fingerprint of
   the app signing key (the top one, not the upload key) into
   `apps/web/public/.well-known/assetlinks.json` in place of the placeholder, commit, and push.
   The deploy puts it live, and Android then opens the site's links in the app. Until then a
   tap on a link opens the browser.
4. Store listing: the text is in `store/listing.md`. The icon is `apps/web/public/icon-512.png`.
   Play also needs a 1024 by 500 feature graphic and at least two phone screenshots; take the
   screenshots from the app on a phone or emulator.
5. Content rating questionnaire: a utility with no violence, no user chat, no gambling and no
   purchases. The public page shows lists other players marked as shared, so answer yes to
   "users can share content". Play may then ask for a way to report a page. The app has none
   today, and the answer is the account owner's email on the About page.
6. Data safety: the app collects an email address (account) and the lists a player makes
   (app activity), both sent encrypted, both deletable by the player, none shared with third
   parties, no ads, no analytics. Resend sends the sign-in email on the server's behalf. The
   account deletion address Play asks for is `https://grimstat.com/#/profile`, where "Delete
   account" is. The privacy policy address is `https://grimstat.com/#/about`, whose Data policy
   section is the policy.
7. Upload the bundle to an internal testing track first, install it from the Play link on a
   phone, sign in and check that a list from another device arrives. Then the closed test, then
   production.

## Testing the links without Play

Android verifies the site's `assetlinks.json` before it opens links in the app. Until the
fingerprint is live, or on a debug build whose fingerprint is not listed, force the app:

```bash
adb shell am start -W -a android.intent.action.VIEW -d "https://grimstat.com/l/<id>" com.grimstat.app
```

The same command with a `/u/<handle>` address or a sign-in link tests the other two. To test the
verification itself, list the debug key's fingerprint alongside the real one in `assetlinks.json`
(`keytool -list -v -keystore ~/.android/debug.keystore -storepass android -alias androiddebugkey`),
deploy, and run:

```bash
adb shell pm verify-app-links --re-verify com.grimstat.app
adb shell pm get-app-links com.grimstat.app
```

## iOS

Not built. `pnpm --filter @grimstat/mobile exec cap add ios` makes the Xcode project from the same
web build when the Apple fee is paid. The iOS WebView's origin is `capacitor://localhost`, which
would go into `APP_ORIGINS` in `apps/web/wrangler.jsonc` and into `apps/web/public/_headers`.
