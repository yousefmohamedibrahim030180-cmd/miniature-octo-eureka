# ORBIT Environment

See .env.example for runtime, persistence, OAuth, storage, mail, payment, TURN and optional AI variables. External integrations are optional. When a dependency is missing, ORBIT must show a configuration state instead of pretending an action succeeded.

## Object storage

Set STORAGE_ENDPOINT, STORAGE_BUCKET, STORAGE_ACCESS_KEY and STORAGE_SECRET_KEY to enable S3-compatible presigned uploads. Optional STORAGE_REGION, STORAGE_FORCE_PATH_STYLE and UPLOAD_MAX_BYTES control the provider behavior. Without these values, ORBIT does not pretend cloud storage is active.

## Background jobs

Set REDIS_URL to enable the Socket.IO Redis adapter and the background worker queue. Run `npm run worker` as a separate worker process when you provision a worker service.
