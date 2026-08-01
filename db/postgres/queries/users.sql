-- name: CreateUser :one
INSERT INTO users (email, pass_hash)
VALUES ($1, $2)
RETURNING id, email, created_at;

-- name: GetUserByEmail :one
SELECT * FROM users
WHERE email = $1;

-- name: GetUser :one
SELECT id, email, created_at FROM users
WHERE id = $1;
