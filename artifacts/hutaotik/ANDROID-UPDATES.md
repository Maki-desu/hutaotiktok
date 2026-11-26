# Android release updates

Hutaotik checks the release API when it opens and downloads updates through
Android's package installer. Installation always requires Android's confirmation;
the app cannot install an APK silently.

## Configure the API server

Set these server environment variables:

- `ADMIN_PASSWORD`: a strong admin password.
- `ADMIN_SESSION_SECRET`: a random secret with at least 32 characters. Keep it
  private; admin sessions are signed with it and expire after 12 hours.
- `DATABASE_URL`: the existing PostgreSQL connection.
- `FIREBASE_SERVICE_ACCOUNT_JSON`: optional Firebase service-account JSON for
  push delivery. Store it as a server secret, not in the repository.

Apply the new database tables using the configured production database:

```powershell
pnpm --filter @workspace/db push
```

Use HTTPS for the API and for links you publish. Update links can be public
Google Drive or MediaFire share links, or direct APK links. Shared links open in
the user's browser; direct `.apk` links use Android's installer flow.

## Configure Android push alerts

In Firebase, create an Android app with package ID `com.hutaotik.app` and put its
`google-services.json` at `artifacts/hutaotik/android/app/google-services.json`.
Set `FIREBASE_SERVICE_ACCOUNT_JSON` on the API server, then build Hutaotik with
`VITE_FIREBASE_PUSH_ENABLED=true`. Users must grant notification permission.

Push alerts are sent to devices that have registered with the new Hutaotik client.
Users on older builds can receive update prompts after opening a build that
contains the update checker; users who have never installed such a build must
first update manually.

## Build and publish

Set `VITE_API_URL` to the deployed API base URL (for example,
`https://api.example.com`) before building. Keep the Hutaotik app's Android
`applicationId` and signing key unchanged for every release. Android rejects an
update if its package ID or signing certificate does not match the installed app.
Increase both `versionCode` and `versionName` in
`android/app/build.gradle` before each release. The first release must use a
version code greater than 16.

Set `ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
and `ANDROID_KEY_PASSWORD` to the existing Hutaotik signing key, then build the
signed user release with:

```powershell
pnpm --filter @workspace/hutaotik apk:release
```

The signed APK is at
`artifacts/hutaotik/android/app/build/outputs/apk/release/Hutaotik-release.apk`.
Never commit the keystore or its passwords. If the original signing key has been
lost or differs from the key used for current installs, Android cannot install
the new APK over those installs.

Build a debug Hutaotik Admin APK for testing:

```powershell
pnpm --filter @workspace/hutaotik apk:admin
```

This creates a separate Android app named **Hutaotik Admin**
(`com.hutaotik.admin`). Its debug APK is at
`artifacts/hutaotik/android/app/build/outputs/apk/debug/Hutaotik-Admin-debug.apk`.
The user app build produces a separate `Hutaotik-debug.apk` or
`Hutaotik-release.apk`.

For distribution, build a signed release APK. Configure
`ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and
`ANDROID_KEY_PASSWORD` in the build environment, then run:

```powershell
pnpm --filter @workspace/hutaotik apk:admin:release
```

The signed Admin APK is at
`artifacts/hutaotik/android/app/build/outputs/apk/release/Hutaotik-Admin-release.apk`.
Keep the Admin keystore and its passwords backed up securely; every subsequent
Hutaotik Admin update must be signed with that same key and use a higher version
code. The Admin icon is supplied separately from the regular Hutaotik icon.
Do not commit signing credentials or keystores to the repository.

Install Hutaotik Admin on the publisher's device, enter the HTTPS API server URL,
and sign in with `ADMIN_PASSWORD`. Choose **App update** to paste a public HTTPS
Google Drive, MediaFire, or direct APK link and write the message users should
see in the update prompt. The API assigns the next app version automatically.
Choose **Normal
announcement** to post a lobby message, optionally with a clickable HTTPS link.
Tap the corresponding publish button. App updates notify registered devices;
normal announcements appear in the lobby. Without Firebase service credentials,
app updates are still available to app-open checks, but no push alert is sent.

Users must allow Hutaotik to install unknown apps in Android settings and confirm
the package-installer prompt for each update. Google Play-distributed apps should
use Play's update flow instead of sideloaded APKs.
