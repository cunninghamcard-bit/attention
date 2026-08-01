-- name: CreateVault :one
INSERT INTO vaults (owner_id, name)
VALUES ($1, $2)
RETURNING *;

-- name: AddVaultMember :exec
INSERT INTO vault_members (vault_id, user_id, role)
VALUES ($1, $2, $3)
ON CONFLICT (vault_id, user_id) DO UPDATE SET role = EXCLUDED.role;

-- name: GetVaultMember :one
SELECT role FROM vault_members
WHERE vault_id = $1 AND user_id = $2;

-- name: ListVaultsForUser :many
SELECT v.*, m.role FROM vaults v
JOIN vault_members m ON m.vault_id = v.id
WHERE m.user_id = $1
ORDER BY v.created_at;
