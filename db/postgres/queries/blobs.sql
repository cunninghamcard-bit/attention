-- name: PutBlob :exec
INSERT INTO blobs (vault_id, hash, bytes, size)
VALUES ($1, $2, $3, $4)
ON CONFLICT (vault_id, hash) DO NOTHING;

-- name: GetBlob :one
SELECT bytes FROM blobs
WHERE vault_id = $1 AND hash = $2;

-- name: HasBlob :one
SELECT EXISTS (
    SELECT 1 FROM blobs WHERE vault_id = $1 AND hash = $2
);
