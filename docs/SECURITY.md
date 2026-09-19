# ORBIT Security

Security middleware adds Helmet headers, request IDs and API rate limiting. Client-side permissions remain UX only; authorization must always be enforced on the server.

Owner/admin actions remain separately authorized and audited. Uploads should use opaque storage keys, strict MIME/size validation and private-by-default access. Authentication expansion can use the new sessions, devices, 2FA and recovery-code tables without replacing the current login path in one release.
