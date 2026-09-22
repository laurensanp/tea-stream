# TeaStream Backend

The GraphQL API behind **TeaStream**, a streaming platform. It manages user accounts: registration, email verification, session-based login, two-factor authentication, password recovery, profiles with avatars and social links, and account deactivation with automatic deletion.

## Contents

- [Tech stack](#tech-stack)
- [Features](#features)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Scripts](#scripts)
- [Project structure](#project-structure)
- [Data model](#data-model)
- [GraphQL API](#graphql-api)
- [How authentication works](#how-authentication-works)
- [Background jobs](#background-jobs)
- [Code style](#code-style)

## Tech stack

| Area            | Technology                                                                                   |
| --------------- | -------------------------------------------------------------------------------------------- |
| Framework       | NestJS 12, Express 5                                                                         |
| API             | GraphQL (code-first) via `@nestjs/graphql` + Apollo Server 5, file uploads via `graphql-upload` |
| Database        | PostgreSQL 15+ with Prisma 7 (`@prisma/adapter-pg` driver adapter)                           |
| Sessions        | `express-session` stored in Redis (`connect-redis`)                                         |
| Passwords       | Argon2                                                                                       |
| 2FA             | TOTP (`otpauth`) with QR codes (`qrcode`)                                                    |
| Email           | `@nestjs-modules/mailer` (SMTP) with templates written in React Email                        |
| File storage    | Any S3-compatible object storage (`@aws-sdk/client-s3`), images processed with `sharp`      |
| Session info    | `geoip-lite` (location) and `device-detector-js` (browser, OS, device)                       |
| Scheduling      | `@nestjs/schedule`                                                                           |

## Features

**Accounts**
- Register with email, username and password; a verification link is emailed on signup.
- Change email and password (the old password is required).
- Unverified users get a fresh verification email when they try to log in.

**Sessions**
- Log in with username or email. Sessions live in Redis and are sent to the client as a signed cookie.
- Each session records IP, approximate location (country, city, coordinates) and device (browser, OS, device type).
- List all your active sessions, see the current one, and revoke any other session remotely.

**Two-factor authentication (TOTP)**
- Generate a secret and QR code for authenticator apps, confirm with a 6-digit code to enable, and disable again.
- When 2FA is on, login needs the code as a second step.

**Password recovery**
- Request a reset link by email (it includes the IP, location and device of the request), then set a new password with the token.

**Profile**
- Upload an avatar (jpg, jpeg, png, webp or gif, up to 10 MB). Images are resized to 512×512 and converted to WebP; animated GIFs stay animated.
- Edit username, display name and bio (up to 300 characters).
- Manage social links: create, edit, delete and reorder.

**Deactivation and deletion**
- Deactivating an account needs email + password and then a 6-digit code sent by email.
- Deactivated accounts are deleted permanently after 7 days by a nightly job, which also removes the avatar and emails the user.

## Getting started

### Prerequisites

- Node.js 20 or newer
- Docker and Docker Compose (for PostgreSQL and Redis), or your own PostgreSQL 15+ and Redis
- An SMTP account for sending mail
- An S3-compatible bucket (AWS S3, Cloudflare R2, MinIO, etc.) for avatars

### 1. Install dependencies

```bash
npm install
```

### 2. Configure the environment

Create a `.env` file in the project root. See [Environment variables](#environment-variables) for the full list; a working local example:

```env
NODE_ENV=development

APPLICATION_PORT=4000
GRAPHQL_PREFIX=/graphql
ALLOWED_ORIGIN=http://localhost:3000

POSTGRES_USER=root
POSTGRES_PASSWORD=123456
POSTGRES_HOST=localhost
POSTGRES_PORT=5433
POSTGRES_DATABASE=teastream
POSTGRES_URI=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DATABASE}

REDIS_USER=default
REDIS_PASSWORD=123456
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_URI=redis://${REDIS_USER}:${REDIS_PASSWORD}@${REDIS_HOST}:${REDIS_PORT}

COOKIE_SECRET=change-me
SESSION_SECRET=change-me-too
SESSION_NAME=session
SESSION_DOMAIN=localhost
SESSION_MAX_AGE_DAYS=30
SESSION_HTTP_ONLY=true
SESSION_SECURE=false
SESSION_FOLDER=sessions:

MAIL_HOST=smtp.example.com
MAIL_PORT=587
MAIL_LOGIN=noreply@example.com
MAIL_PASSWORD=your-smtp-password

S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
S3_REGION=auto
S3_ACCESS_KEY_ID=your-access-key
S3_SECRET_ACCESS_KEY=your-secret-key
S3_BUCKET_NAME=teastream
```

`${VAR}` references are expanded both by Nest (`expandVariables`) and by `prisma.config.ts` (`dotenv-expand`).

`.env.example` contains this same list, so `cp .env.example .env` and edit it is the quickest start. Note that the connection string variable is **`POSTGRES_URI`** (not `DATABASE_URL`) — that is the name the app and Prisma read.

### 3. Start PostgreSQL and Redis

```bash
docker compose up -d
```

This starts PostgreSQL 18 on host port **5433** and Redis 8 on **6379** (password-protected with `REDIS_PASSWORD`). Both use named volumes, so data survives restarts. The database is created as `POSTGRES_DATABASE` with `POSTGRES_USER` as the owner, so it matches `POSTGRES_URI` out of the box.

### 4. Set up the database

```bash
npm run db:deploy     # apply migrations in prisma/migrations
npm run db:generate   # generate the Prisma client into prisma/generated
```

### 5. Run the server

```bash
npm run start:dev
```

The API is served at `http://localhost:<APPLICATION_PORT><GRAPHQL_PREFIX>`, for example `http://localhost:4000/graphql`. In development (`NODE_ENV=development`) the GraphQL playground is available at the same URL.

## Environment variables

In development the app loads `.env`. In any other environment the file is **ignored**, so variables must come from the real environment (container, host, CI).

### Application

| Variable           | Description                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| `NODE_ENV`         | `development` enables the playground, `.env` loading and a fixed test IP for geolocation.      |
| `APPLICATION_PORT` | Port the HTTP server listens on.                                                               |
| `GRAPHQL_PREFIX`   | Path of the GraphQL endpoint, e.g. `/graphql`.                                                 |
| `ALLOWED_ORIGIN`   | Frontend origin allowed by CORS. Also used as the base URL for links in emails.               |

### Database and cache

| Variable       | Description                                                   |
| -------------- | ------------------------------------------------------------- |
| `POSTGRES_URI` | PostgreSQL connection string, used by the app and Prisma CLI. |
| `REDIS_URI`    | Redis connection string, used for session storage.            |

`docker-compose.yml` additionally reads `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DATABASE` and `REDIS_PASSWORD` to set up the containers.

### Sessions and cookies

| Variable               | Description                                                              |
| ---------------------- | ------------------------------------------------------------------------ |
| `COOKIE_SECRET`        | Secret for `cookie-parser` signed cookies.                               |
| `SESSION_SECRET`       | Secret used to sign the session ID cookie.                               |
| `SESSION_NAME`         | Name of the session cookie.                                              |
| `SESSION_DOMAIN`       | Cookie domain.                                                           |
| `SESSION_MAX_AGE_DAYS` | Session lifetime in days.                                                |
| `SESSION_HTTP_ONLY`    | `true`/`false`. Should be `true`.                                        |
| `SESSION_SECURE`       | `true`/`false`. Set to `true` in production (HTTPS only).                |
| `SESSION_FOLDER`       | Key prefix for sessions in Redis, e.g. `sessions:` (include the colon). |

### Mail

| Variable        | Description                                                            |
| --------------- | ---------------------------------------------------------------------- |
| `MAIL_HOST`     | SMTP host.                                                             |
| `MAIL_PORT`     | SMTP port. `465` uses implicit TLS, anything else (e.g. `587`) STARTTLS. |
| `MAIL_LOGIN`    | SMTP username. Also used as the sender address (`"TeaStream" <…>`).    |
| `MAIL_PASSWORD` | SMTP password.                                                         |

### Storage

| Variable               | Description                         |
| ---------------------- | ----------------------------------- |
| `S3_ENDPOINT`          | S3-compatible endpoint URL.         |
| `S3_REGION`            | Region (`auto` for Cloudflare R2).  |
| `S3_ACCESS_KEY_ID`     | Access key.                         |
| `S3_SECRET_ACCESS_KEY` | Secret key.                         |
| `S3_BUCKET_NAME`       | Bucket for avatars.                 |

All of these except the Docker-only ones are read with `getOrThrow`, so the app refuses to start if one is missing.

## Scripts

| Command                | What it does                                                   |
| ---------------------- | -------------------------------------------------------------- |
| `npm run start:dev`    | Start in watch mode.                                           |
| `npm run start:debug`  | Start in watch mode with the Node debugger attached.           |
| `npm run start`        | Start once, without watching.                                  |
| `npm run build`        | Compile to `dist/` (the entry point lands at `dist/src/main.js`, because the `@/…` alias makes the project root the compilation root). |
| `npm run start:prod`   | Run the compiled build (`node dist/src/main`).                 |
| `npm run lint`         | Run ESLint and fix what it can.                                |
| `npm run format`       | Format with Prettier.                                          |
| `npm run test`         | Run unit tests (`*.spec.ts` under `src/`).                     |
| `npm run test:e2e`     | Run end-to-end tests (`*.e2e-spec.ts` under `test/`).          |
| `npm run test:cov`     | Run unit tests with coverage.                                  |
| `npm run db:push`      | Create and apply a new migration from schema changes (`prisma migrate dev`). |
| `npm run db:deploy`    | Apply pending migrations (`prisma migrate deploy`), use this in production. |
| `npm run db:generate`  | Regenerate the Prisma client.                                  |
| `npm run db:reset`     | Drop the database and re-apply all migrations. Destroys data.  |
| `npm run db:studio`    | Open Prisma Studio to browse the data.                         |
| `npm run db:format`    | Format `schema.prisma`.                                        |

## Project structure

```text
.
├── prisma/
│   ├── schema.prisma          # Database schema
│   ├── migrations/            # SQL migrations
│   └── generated/             # Generated Prisma client (imported as @prisma/generated)
├── prisma.config.ts           # Prisma CLI config (reads POSTGRES_URI)
├── docker-compose.yml         # Local PostgreSQL + Redis
├── test/
│   ├── jest-setup.ts          # Pins NODE_ENV for tests
│   └── jest-e2e.json          # Jest config for *.e2e-spec.ts
└── src/
    ├── main.ts                # Bootstrap: cookies, uploads, validation, sessions, CORS
    ├── core.module.ts         # Root module wiring everything together
    ├── core/
    │   ├── config/            # GraphQL and mailer config factories
    │   ├── graphql/schema.gql # Auto-generated GraphQL schema (do not edit)
    │   ├── prisma/            # PrismaService (global)
    │   └── redis/             # RedisService (global)
    ├── modules/
    │   ├── auth/
    │   │   ├── account/           # Register, profile query, change email/password
    │   │   ├── session/           # Login, logout, list/revoke sessions
    │   │   ├── verification/      # Email verification
    │   │   ├── password-recovery/ # Reset + set new password
    │   │   ├── totp/              # Two-factor authentication
    │   │   ├── profile/           # Avatar, profile info, social links
    │   │   └── deactivate/        # Account deactivation
    │   ├── cron/                  # Scheduled jobs
    │   └── libs/
    │       ├── mail/              # MailService + React Email templates
    │       └── storage/           # S3 StorageService
    └── shared/
        ├── decorators/        # @Authorization(), @Authorized(), @UserAgent(), validators
        ├── guards/            # GqlAuthGuard
        ├── pipes/             # FileValidationPipe
        ├── types/             # Type augmentations (session, request, context)
        └── utils/             # Tokens, sessions, session metadata, file checks
```

Each feature module follows the same layout: `*.module.ts`, `*.resolver.ts`, `*.service.ts`, plus `inputs/` (validated GraphQL inputs) and `models/` (GraphQL output types).

**Path aliases** (from `tsconfig.json`):
- `@/…` resolves from the project root, e.g. `@/src/core/prisma/prisma.service`. There is no `baseUrl`; the `paths` targets are relative to `tsconfig.json` itself.
- `@prisma/generated` resolves to `prisma/generated/client`

## Data model

```text
User ──< Token        (tokens are deleted with the user)
User ──< SocialLink
```

- **User**: email, Argon2 password hash, unique username, display name, avatar path, bio, verification flags, TOTP settings, and deactivation state.
- **Token**: one-time tokens of type `EMAIL_VERIFY`, `PASSWORD_RESET` or `DEACTIVATE_ACCOUNT`. They expire after 5 minutes, and each user has at most one token per type (creating a new one replaces the old one). Verification and reset tokens are UUIDs; deactivation tokens are 6-digit codes.
- **SocialLink**: title, URL and a `position` used for ordering.

IDs are UUIDs generated by PostgreSQL (`gen_random_uuid()`). Tables and columns use snake_case in the database.

## GraphQL API

The schema is generated from the TypeScript code at startup and written to [src/core/graphql/schema.gql](src/core/graphql/schema.gql). That file is the full reference; the tables below are a summary. 🔒 means a valid session is required.

### Queries

| Query                  | Auth | Description                                  |
| ---------------------- | :--: | -------------------------------------------- |
| `findProfile`          |  🔒  | The logged-in user, including social links.  |
| `findSessionsByUser`   |  🔒  | All sessions of the user, newest first.      |
| `findCurrentSession`   |  🔒  | The session making the request.              |
| `generateTotpSecret`   |  🔒  | A new TOTP secret and a QR code data URL.    |
| `findSocialLinks`      |  🔒  | The user's social links, ordered by position.|

### Mutations

| Mutation              | Auth | Description                                                                                 |
| --------------------- | :--: | ------------------------------------------------------------------------------------------- |
| `createUser`          |      | Register. Sends a verification email.                                                        |
| `verifyAccount`       |      | Confirm the email with the token from the email; logs the user in.                          |
| `loginUser`           |      | Log in with username or email. Returns a `message` if a TOTP code is still needed.          |
| `logoutUser`          |  🔒  | End the current session.                                                                    |
| `clearSessionCookie`  |      | Clear the session cookie on the client.                                                     |
| `removeSession`       |  🔒  | Revoke another session by ID (not the current one).                                         |
| `resetPassword`       |      | Email a password reset link.                                                                |
| `newPassword`         |      | Set a new password using the reset token.                                                   |
| `changeEmail`         |  🔒  | Change the email address.                                                                   |
| `changePassword`      |  🔒  | Change the password (old password required).                                                |
| `enableTotp`          |  🔒  | Enable 2FA with the generated secret and a current code.                                    |
| `disableTotp`         |  🔒  | Disable 2FA.                                                                                |
| `changeProfileAvatar` |  🔒  | Upload a new avatar (`Upload` scalar, multipart request).                                  |
| `removeAvatar`        |  🔒  | Delete the avatar.                                                                          |
| `changeProfileInfo`   |  🔒  | Update username, display name and bio.                                                      |
| `createSocialLink`    |  🔒  | Add a social link at the end of the list.                                                   |
| `updateSocialLink`    |  🔒  | Edit a social link.                                                                         |
| `reorderSocialLinks`  |  🔒  | Set new positions for several links at once.                                                |
| `removeSocialLink`    |  🔒  | Delete a social link.                                                                       |
| `deactivateAccount`   |  🔒  | Two-step: first call emails a code, second call (with `pin`) deactivates and logs out.      |

### Example requests

Register:

```graphql
mutation {
  createUser(data: { email: "jane@example.com", username: "jane", password: "supersecret" })
}
```

Log in (add `pin` when 2FA is enabled):

```graphql
mutation {
  loginUser(data: { login: "jane", password: "supersecret" }) {
    message
    user { id username displayName }
  }
}
```

Upload an avatar with curl (multipart request spec):

```bash
curl http://localhost:4000/graphql \
  -H "apollo-require-preflight: true" \
  -b "session=<cookie>" \
  -F operations='{"query":"mutation($avatar: Upload!) { changeProfileAvatar(avatar: $avatar) }","variables":{"avatar":null}}' \
  -F map='{"0":["variables.avatar"]}' \
  -F 0=@avatar.png
```

Clients must send cookies with every request (`credentials: 'include'` in `fetch`, `withCredentials` in Apollo Client), since authentication is cookie-based.

## How authentication works

1. **Signup.** `createUser` hashes the password with Argon2, creates the user, and emails a link to `<ALLOWED_ORIGIN>/account/verify?token=…`.
2. **Verification.** The frontend passes the token to `verifyAccount`. The email is marked verified and a session is created immediately.
3. **Login.** `loginUser` checks the password. If the email isn't verified, a new verification email goes out and login fails. If TOTP is enabled and no `pin` was sent, the response contains a `message` and no user; the client asks for the code and calls `loginUser` again with `pin`.
4. **Session.** On success, the user ID, creation time and metadata (IP, location, device) are stored in the Redis session, and the client gets a signed session cookie.
5. **Protected resolvers.** `@Authorization()` applies `GqlAuthGuard`, which rejects requests without a session and loads the user onto the request. Resolvers read it with `@Authorized()` or `@Authorized('id')`.

Email links point to these frontend routes, which the frontend has to implement:

| Email          | Link                                         |
| -------------- | -------------------------------------------- |
| Verification   | `<ALLOWED_ORIGIN>/account/verify?token=…`    |
| Password reset | `<ALLOWED_ORIGIN>/account/reset/<token>`     |
| Deletion       | `<ALLOWED_ORIGIN>/account/create`            |

For geolocation, the client IP is taken from `CF-Connecting-IP` (Cloudflare), then `X-Forwarded-For`, then the socket address. In development a fixed public IP is used so that lookups return real data.

## Background jobs

| Job                        | Schedule             | What it does                                                                                     |
| -------------------------- | -------------------- | ------------------------------------------------------------------------------------------------ |
| `deleteDeactivatedAccounts`| Daily at 00:00       | Finds accounts deactivated for 7+ days, emails each user, deletes their avatar from S3, and deletes the accounts. |

## Code style

- **Prettier** (`.prettierrc`) with `@trivago/prettier-plugin-sort-imports` for consistent import order. Run `npm run format`.
- **ESLint** with `typescript-eslint` (`eslint.config.mjs`). Run `npm run lint`.
- Don't edit `src/core/graphql/schema.gql` or `prisma/generated/` by hand; both are generated.
- After changing `prisma/schema.prisma`, run `npm run db:push` to create a migration, then `npm run db:generate`.

## License

UNLICENSED. This is a private project, all rights reserved.
