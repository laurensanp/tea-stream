// Runs before the test framework and before any module under test is imported.
// Several modules read NODE_ENV at import time (see IS_DEV_ENV in
// src/shared/utils/is-dev.util.ts), and `.env` sets it to `development`, so pin
// it here to keep tests independent of the developer's environment.
process.env.NODE_ENV = 'test'
