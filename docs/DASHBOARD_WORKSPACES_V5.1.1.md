# v5.1.1 dashboard workspaces

The administration dashboard now uses a light business theme and separates service operations while retaining existing control IDs, API routes, authorization, CSRF protection and persistent state.

| Major menu | Group | Pages |
| --- | --- | --- |
| Naver | Account/search | OAuth connection, public Cafe search |
| Naver | Cafe automation | New article monitoring/Discord alerts, Cafe membership/article publishing |
| Naver | Participation | Memo-board participation reception |
| Discord | Server management | Connection/permission diagnostics, setup, permission audit |
| Unified operations | Broadcast preparation/live/output/archive | Unified Queue, participant calls, draw/team controls, CHZZK live status, OBS, schedules, presets, archive |
| Community | Recruitment/participants/communication | Cross-service recruitment and publishing, fairness, subscriptions, guide, tickets |
| System | Health/recovery/releases/security | Existing readiness, acceptance, cutover, monitoring, recovery and release tools |

Naver monitor and publication drafts retain their unsaved-change guards under the new page names. Existing `#settings` continues to open shared settings and backups; Naver operations use their own deep links (`#naver`, `#naversearch`, `#navermonitor`, `#naverqueue`, `#naverwrite`). OBS/broadcast output styles remain independent.

## HTTPS and access control

The generic network exposure warning previously depended only on `HOST`. It now checks Express `req.secure` and whether real administrator authentication is configured. An HTTPS public URL by itself does not suppress a warning for an insecure request. Forwarded HTTPS is trusted only when `TRUST_PROXY_HOPS` has explicitly configured the actual hosting proxy chain. Do not increase trust hops beyond the deployment's real proxy count. Railway uses an HTTPS edge; configure the service's trusted immediate proxy and keep its generated HTTPS URL as `PUBLIC_BASE_URL`.

The root dashboard remains protected by HTTP Basic authentication; this change does not remove authentication or alter privileges. External Naver/CHZZK credentials and actual integrations are still required. The patch also fixes two different preflight status badges sharing one ID, so environment readiness and broadcast preflight no longer overwrite each other's status.
