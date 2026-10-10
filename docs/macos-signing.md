# Signing and notarising the macOS installer

The `package` workflow builds the Midst installers. For macOS it signs the app and the `.pkg` with
a Developer ID, sends both to Apple for notarisation, staples the result to the `.pkg`, and checks
that Gatekeeper will accept it. A poet can then double-click the installer without any warning.

All of that is automatic once seven GitHub secrets exist. This document is how to create them from
**your own** Apple Developer account: the first time, when the credentials move from one person to
another, or when they expire.

You do this on a Mac, and it takes about half an hour. Nothing here needs Keychain Access, Xcode,
or an app-specific password.

## What you need first

- **Apple Developer Program membership, as Account Holder.** Only the Account Holder can create
  Developer ID certificates, and App Store Connect API team keys need an Admin.
- **Admin on the `midst-press` GitHub organisation**, to set repository secrets.
- **`gh`, the GitHub command line, signed in**: `brew install gh`, then `gh auth login`.
- **A clone of this repository**, for `tools/setup_signing_secrets.sh`.

## 1. Make a private key and a signing request for each certificate

In Terminal:

```bash
mkdir -p ~/midst-signing && chmod 700 ~/midst-signing && cd ~/midst-signing

for n in developer_id_application developer_id_installer; do
  openssl genrsa -out "$n.key" 2048
  openssl req -new -key "$n.key" -out "$n.certSigningRequest" \
    -subj "/emailAddress=YOUR_APPLE_ID_EMAIL/CN=YOUR NAME/C=NZ"
done
```

Replace the email address and name with your own, and change `C=NZ` if you are elsewhere. Apple
fills in the name on the certificate from your account, so these are labels only.

The two `.key` files are the signing keys. Keep them in this folder and never commit them anywhere.

## 2. Create the two Developer ID certificates

At [developer.apple.com/account](https://developer.apple.com/account), under **Certificates, IDs &
Profiles**, open **Certificates** and click **+**. Do this twice:

| Certificate                  | Section to choose                       | Upload                                        | Save the download as                           |
| ---------------------------- | --------------------------------------- | --------------------------------------------- | ---------------------------------------------- |
| Developer ID **Application** | Developer ID → Developer ID Application | `developer_id_application.certSigningRequest` | `~/midst-signing/developer_id_application.cer` |
| Developer ID **Installer**   | Developer ID → Developer ID Installer   | `developer_id_installer.certSigningRequest`   | `~/midst-signing/developer_id_installer.cer`   |

When asked for the profile type (the certificate intermediary), choose **G2 Sub-CA (Xcode 11.4.1
or later)**. The other option issues from an authority that expires on 1 February 2027, and the
setup script refuses certificates from it.

Apple names the downloads `developerID_application.cer` and `developerID_installer.cer`. Rename
them to the names in the table.

## 3. Create an App Store Connect API key for notarisation

On the same [developer.apple.com/account](https://developer.apple.com/account) page, under **App
Store Connect**, click **Users and Access**. Then:

1. Select the **Integrations** tab.
2. Select **App Store Connect API** in the left column.
3. Make sure **Team Keys** is selected. It must be a team key: Apple documents that individual keys
   cannot be used by `notarytool`.
4. Click **Generate API Key** (or **+**), and name it, for example `midst-editor notarisation`.
5. Under **Access**, choose **Developer**. It is the narrowest role. If a build later fails at
   notarisation with a permissions error, generate a new key with a broader role.
6. Click **Generate**, then **Download API Key**. **Apple allows this download once** and keeps no
   copy. Save it into `~/midst-signing` under the name Apple gives it, `AuthKey_<KeyID>.p8`.
7. Copy the **Issuer ID** shown on that page into `~/midst-signing/issuer_id.txt`.

## 4. Store everything as GitHub secrets

From your clone of this repository:

```bash
bash tools/setup_signing_secrets.sh ~/midst-signing
```

It asks you nothing, and stops with a plain message if anything is wrong. It:

- checks each certificate matches its key and comes from the G2 authority;
- builds a `.p12` for each certificate, with a random password that only ever exists in GitHub;
- checks the API key and Issuer ID look right;
- replaces these seven secrets on `midst-press/midst-editor`: `CSC_LINK`, `CSC_KEY_PASSWORD`,
  `CSC_INSTALLER_LINK`, `CSC_INSTALLER_KEY_PASSWORD`, `APPLE_API_KEY`, `APPLE_API_KEY_ID` and
  `APPLE_API_ISSUER`.

Running it again replaces them, so the same command is how credentials are rotated or handed over.

## 5. Build, and check it worked

This checks signing works. To make a release, with a version number and a tag, follow
[releasing.md](releasing.md).

On GitHub, go to **midst-press/midst-editor → Actions → package → Run workflow**, choose `macos`
(or `all`), and run it. It takes about ten minutes, most of it waiting for Apple's notary service.

When it finishes, the run's summary should say `signed: yes` and `notarised: yes`. The installer is
under **Artifacts**. The run fails, rather than producing an installer, if:

- either Developer ID identity is missing from the secrets;
- Apple rejects notarisation;
- Gatekeeper would refuse the result;
- the app is not arm64.

If packaging itself fails, the end of its output appears in the summary.

## 6. Retire the previous person's credentials

Once your own build passes, the previous key and certificates are no longer used by anything here.

- **The API key**: in **Users and Access → Integrations → App Store Connect API**, revoke the
  previous key. This only stops future notarisations with it.
- **The previous Developer ID certificates**: let them expire. Revoking a Developer ID certificate
  is a different matter, because it can affect software already signed with it, so do it only if a
  key has been exposed, and read Apple's guidance first.

## What to keep, and where

- **Keep, privately:** `~/midst-signing`, with the two `.key` files and the `.p8`. Without them you
  can't re-run step 4, and the `.p8` can't be downloaded again.
- **Disposable:** the `.p12` files the script creates. GitHub holds the copies the builds use.
- **Never commit any of these files.** The pre-commit `detect-private-key` hook catches the `.key`
  and `.p8` files, but not a `.p12`, which is binary.

## When to do this again

- **When responsibility moves to another person.** The installer shows the certificate holder's
  name, so it should belong to whoever is responsible for Midst.
- **When a certificate expires.** The current ones run to 17 September 2031; check the date in
  **Certificates**.
- **If any key may have been exposed.** Revoke it first, then go through this again.

## Things that look like problems but are not

- **Keychain Access:** current macOS keeps it in `/System/Library/CoreServices/Applications/` rather
  than Utilities. Nothing here needs it.
- **App-specific passwords:** those are on account.apple.com, a different site, and this process
  does not use one. The API key in step 3 replaces it.
- **Intel Macs:** Midst is built for Apple silicon (arm64) only.
