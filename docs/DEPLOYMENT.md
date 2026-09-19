# ORBIT Deployment

Railway is the primary deployment target. Health endpoint: GET /health. Readiness endpoint: GET /readyz. The Dockerfile is production-ready for environments that deploy from containers.

Production should configure NODE_ENV=production, a strong JWT_SECRET, APP_URL and TURN settings. Configure DATABASE_URL before enabling relational persistence. Storage, mail and payments are optional integrations and must not be represented as working until their credentials are configured.
