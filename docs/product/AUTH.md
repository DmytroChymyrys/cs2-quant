# Authentication Specification

## Goal

Provide low-friction, production-ready authentication without letting auth complexity dominate the market-intelligence MVP.

## Initial flows

### Sign in

- Google OAuth
- email + password
- forgot-password link
- clear validation/error states

### Create account

- Google OAuth
- email + password
- minimal required profile fields
- link to sign in for existing users

### Password reset

- request reset
- generic success response that does not disclose whether an email is registered
- reset form using Better Auth-supported token flow
- success state returning user to sign in

## Provider scope

Initial: Google + email/password only.

Not in MVP:

- Steam login
- Discord login
- SMS
- passkeys
- MFA/2FA marketing
- enterprise SSO

## Session/account UI

Only display session/device details that Better Auth and the implemented persistence layer actually provide. Do not invent device names, IP histories, cryptographic properties, or session guarantees.

## Security copy

Avoid claims such as:

- bank-grade
- zero-disclosure
- cryptographic session layer
- military-grade
- fixed session expiration periods unless explicitly configured
- exact password reset lifetime unless explicitly configured

## Turnstile/rate limiting

Integrate Cloudflare Turnstile and durable rate limiting only in ways supported by the actual deployment/configuration. UI should support `RATE LIMITED` and verification/challenge states, but these are behavior states, not marketing claims.

## Authorization

Authentication answers who the user is. Entitlements answer what the user may access. Keep these concerns separate.
