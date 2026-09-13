# Trackit X — Render Migration Architecture

## Current Architecture Overview

### Frontend Stack
- React Native with Expo (SDK 57)
- Expo Router (file-based routing)
- Custom design system components
- Typescript + ESLint + Jest

### Backend Stack (Supabase-hosted)
- PostgreSQL (via Supabase)
- Supabase Auth (email/password only)
- PostgREST API (auto-generated)
- Supabase Realtime (enabled but unused)
- Supabase Storage (enabled but unused)
- Edge Functions (configured but no source)

### Docker Dependencies (Local Dev)
- Requires Docker to run Supabase locally
- Supabase CLI manages local stack

## Detailed Discovery

### Frontend Architecture
- Framework: React Native + Expo 57.0.15
- Build System: Expo prebuild, metro bundler, typescript strict mode
- Routing: Expo Router with typed routes
- Authentication: Context-based, manages session restoration
- UI Layer: Custom design system with atomic components
- Platform Targets: iOS, Android, Web

### Backend Architecture (Current)

#### Supabase Configuration
- project_id = "trackit-x"
- [api] port = 54321, schemas = ["public", "graphql_public"]
- [db] port = 54322, major_version = 17
- [auth] enable_confirmations = true, minimum_password_length = 10
- [storage] buckets commented out
- [realtime] enabled = true

#### Database Schema
- Core Tables: public.organizations, public.organization_members
- Security: Row Level Security enforced
- Triggers: updated_at, owner protection

### Build/Deployment
- expo start for dev
- npm run typecheck / lint / test
- supabase start / supabase stop for local dev
- Web output: single bundle

## Render Migration Proposal

### Frontend on Render
- Web: Render Static Site
- Native: EAS Build remains

### Backend on Render
- PostgreSQL: Render-managed PostgreSQL
- Auth: Third-party (Auth0/Firebase) or Render Private Service
- API: Custom Node.js/Express on Render
- Storage: AWS S3/GCS + Render proxy for signed URLs
- Realtime: Render WebSocket service
- AI: Render Private Service for Gemini proxy

### Supabase Replacement Matrix
| Feature | Current | Render Alternative |
|---------|---------|-------------------|
| Auth | Supabase Auth | Auth0 / Firebase / Custom JWT |
| PostgREST | Auto-generated | Custom REST API |
| PostgreSQL | Supabase-hosted | Render-managed |
| Realtime | Configured | WebSocket |
| Storage | Configured | S3 + Proxy |
| Edge Functions | None | Render Private Services |

## Conclusion
Infrastructure discovery complete. Codebase well-structured for migration.
