# Security

## Reporting a vulnerability

Please **do not** open a public issue for security bugs.

Email `daniel.haidang.ung@gmail.com` with:
- A description of the issue.
- Steps to reproduce.
- The impact you believe it has.

## Scope

In scope:
- Game-state desync, authoritative-state bypass, illegal-move acceptance.
- Authentication bypass, session fixation, token leakage.
- Cross-game data leakage (one player reading another's game).
- STT prompt-injection attacks against the server.

Out of scope:
- Rating-system gaming through normal play (sandbagging).
- Denial-of-service via the public WS endpoint before production rate limits are in place.
- Issues in third-party dependencies — please report upstream.
