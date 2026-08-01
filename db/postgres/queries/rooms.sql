-- name: UpsertRoom :exec
INSERT INTO rooms (vault_id, room_id, crdt_type)
VALUES ($1, $2, $3)
ON CONFLICT (vault_id, room_id, crdt_type) DO NOTHING;

-- name: GetRoom :one
SELECT * FROM rooms
WHERE vault_id = $1 AND room_id = $2 AND crdt_type = $3;

-- The room row is the append lock: callers take it inside a transaction
-- before assigning the next n. :one so a missing room surfaces as
-- ErrNoRows — an Exec would swallow the zero-row case silently.
-- name: LockRoom :one
SELECT 1 FROM rooms
WHERE vault_id = $1 AND room_id = $2 AND crdt_type = $3
FOR UPDATE;

-- name: AppendRoomLog :one
INSERT INTO room_log (vault_id, room_id, crdt_type, n, bytes)
VALUES (
    $1, $2, $3,
    (
        SELECT COALESCE(MAX(n), 0) + 1 FROM room_log
        WHERE vault_id = $1 AND room_id = $2 AND crdt_type = $3
    ),
    $4
)
RETURNING n;

-- name: ScanRoomLog :many
SELECT n, bytes FROM room_log
WHERE vault_id = $1 AND room_id = $2 AND crdt_type = $3 AND n > $4
ORDER BY n;

-- name: SetRoomSnapshot :exec
UPDATE rooms
SET snapshot = $4, snapshot_at = now()
WHERE vault_id = $1 AND room_id = $2 AND crdt_type = $3;

-- name: DeleteRoomLogThrough :execrows
DELETE FROM room_log
WHERE vault_id = $1 AND room_id = $2 AND crdt_type = $3 AND n <= $4;

-- name: ListRooms :many
SELECT room_id, crdt_type FROM rooms
WHERE vault_id = $1
ORDER BY room_id, crdt_type;
