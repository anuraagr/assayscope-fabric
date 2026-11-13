# Reporting a security issue

Do not include credentials, tenant identifiers, customer images, review text or exploit
details in a public issue.

If the repository's **Security > Report a vulnerability** option is enabled, use it.
Otherwise contact the repository maintainer through an established private channel
before sending sensitive material. This sample does not promise a response SLA or
operate a separate security-reporting service.

Provide the affected source revision, local/cloud boundary, expected authorization,
redacted reproduction steps and impact. Use synthetic data wherever possible.
Do not test another tenant or identity without its owner's authorization.

## Security scope

AssayScope is a research demonstration, not a production security certification.
The local service is loopback-only and has no enterprise authentication. Cloud hosting
is protected, Functions are authorized, and review revisions are caller-scoped.
Independent negative-identity and cloud review-write checks remain explicit gates.

Read [security and access boundaries](docs/security.md) and
[actual verification](docs/verification.md) before introducing real data or sharing access.
The notebook has a separate Lakehouse permission boundary; notebook output is data,
not safe-to-publish source.

Dependency changes must preserve exact Rayfin compatibility and pass scientific and
browser checks. Never disable TLS, ignore resolver failures, embed tokens, or use a
forced dependency upgrade to conceal a security finding.
