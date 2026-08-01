-- The data plane stores opaque loro-protocol payloads (snapshot/log per
-- room, content-addressed blobs); the control plane is accounts and vault
-- membership. No column anywhere carries CRDT semantics — the server never
-- interprets document bytes (docs/superpowers/specs/2026-08-02-data-layer-
-- server-design.md).

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    pass_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE vaults (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE vault_role AS ENUM ('owner', 'editor');

CREATE TABLE vault_members (
    vault_id UUID NOT NULL REFERENCES vaults (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role vault_role NOT NULL,
    PRIMARY KEY (vault_id, user_id)
);

-- One row per loro-protocol room. Same room id under a different CRDT type
-- is a different room (protocol.md), hence crdt_type in every key. The row
-- doubles as the per-room append lock: log writers take FOR UPDATE on it.
CREATE TABLE rooms (
    vault_id UUID NOT NULL REFERENCES vaults (id) ON DELETE CASCADE,
    room_id TEXT NOT NULL,
    crdt_type SMALLINT NOT NULL,
    snapshot BYTEA,
    snapshot_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (vault_id, room_id, crdt_type)
);

-- Append-only update log. n is storage order within the room, never wire
-- visible; compaction deletes rows at or below a client-uploaded snapshot's
-- watermark, so gaps are normal.
CREATE TABLE room_log (
    vault_id UUID NOT NULL,
    room_id TEXT NOT NULL,
    crdt_type SMALLINT NOT NULL,
    n BIGINT NOT NULL,
    bytes BYTEA NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (vault_id, room_id, crdt_type, n),
    FOREIGN KEY (vault_id, room_id, crdt_type)
        REFERENCES rooms (vault_id, room_id, crdt_type) ON DELETE CASCADE
);

-- Attachments, content-addressed and deduplicated per vault.
CREATE TABLE blobs (
    vault_id UUID NOT NULL REFERENCES vaults (id) ON DELETE CASCADE,
    hash TEXT NOT NULL,
    bytes BYTEA NOT NULL,
    size BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (vault_id, hash)
);
