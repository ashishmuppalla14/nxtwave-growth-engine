-- Idempotent schema. Safe to run repeatedly (the API also applies it on startup).
-- Run manually in Supabase: Dashboard -> SQL Editor -> paste -> Run.
create table if not exists ambassadors (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  college text not null check (char_length(college) between 2 and 120),
  code text not null unique check (code ~ '^[A-Z0-9]{3,20}$'),
  simulated boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists registrations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  email text not null check (char_length(email) <= 254),
  college text not null check (char_length(college) between 2 and 120),
  source text not null check (source in ('College Clubs','Student Ambassadors','WhatsApp/Telegram','Organic Social')),
  referral_code text,
  ambassador_id uuid references ambassadors(id),
  simulated boolean not null default false,
  consent_at timestamptz,
  created_at timestamptz not null default now()
);

-- Case-insensitive duplicate-email prevention enforced by the database itself.
create unique index if not exists registrations_email_lower_key on registrations (lower(email));
create index if not exists registrations_ambassador_idx on registrations (ambassador_id);

-- Supabase exposes tables through its public REST API. Enabling RLS with no policies
-- blocks that path (anon/authenticated keys); the backend connects with the database
-- role, which is not affected.
alter table ambassadors enable row level security;
alter table registrations enable row level security;
