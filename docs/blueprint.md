# SNI Scanner — Bot specification

**Archetype:** custom

**Voice:** professional and concise — write every user-facing message, button label, error, and empty state in this voice.

A Telegram bot for approved researchers to scan public hosts and discover reachable SNI values and network configurations. Results include filtered lists of active hosts and working SNI values, with manual admin approval for user access.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- registered researchers
- network engineers
- students

## Success criteria

- Successful execution of scans with results delivered to user's Telegram chat
- Manual admin approval workflow implemented
- Rate-limited scan requests per user

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Display initial instructions and registration request link
- **/scan** (command, actor: user, command: /scan) — Initiate scan with optional parameters
  - inputs: host list, max scan depth
  - outputs: scan job status, progress updates, final results
- **Upload host list** (button, actor: user, callback: upload:host_list) — Submit newline-separated host list for scanning

## Flows

### Scan initiation
_Trigger:_ /scan or upload:host_list

1. Request scan parameters
2. Validate public host targets
3. Queue scan job
4. Send progress updates
5. Deliver final results

_Data touched:_ Scan job, Host result

### Registration workflow
_Trigger:_ User clicks registration link

1. Request manual admin approval
2. Admin approves via out-of-band process
3. Activate user account

_Data touched:_ User

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

- **User** _(retention: persistent)_ — Approved researcher account with Telegram ID
  - fields: telegram_id, approval_status
- **Scan job** _(retention: session)_ — Active scan request with configuration
  - fields: target_list, max_depth, status
- **Host result** _(retention: persistent)_ — Scan output for individual host
  - fields: ip_host, port, reachable, sni_values, tls_details, timestamp
- **Scan history** _(retention: persistent)_ — User's past scan jobs and results
  - fields: user_id, job_history, result_history

## Integrations

- **Telegram** (required) — Bot API messaging
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- Manual user approval workflow
- Max scan depth default (3)
- Private range blocking (RFC1918)
- Result retention period (90 days)

## Notifications

- Scan progress updates in user's private chat
- Final results delivered exclusively to initiating user

## Permissions & privacy

- Manual admin approval required for all users
- Results retained 90 days then deleted
- No third-party result sharing

## Edge cases

- Invalid host list formatting
- Private IP range targets
- Concurrent scan requests exceeding rate limits
- Scan results with no reachable hosts

## Required tests

- End-to-end scan workflow from request to result delivery
- Rate limiting enforcement test
- Private range blocking validation

## Assumptions

- Admin approval process is out-of-band
- Default scan depth of 3 is acceptable for load balancing
- User-provided hosts are public by default
