CREATE TEMP TABLE edges AS
SELECT (sn.nspname||'.'||s.relname) COLLATE "C" AS src,
       (dn.nspname||'.'||d.relname) COLLATE "C" AS dst
FROM pg_constraint c
JOIN pg_class s ON s.oid = c.conrelid
JOIN pg_namespace sn ON sn.oid = s.relnamespace
JOIN pg_class d ON d.oid = c.confrelid
JOIN pg_namespace dn ON dn.oid = d.relnamespace
WHERE c.contype = 'f' AND sn.nspname NOT LIKE 'pg\_%' AND dn.nspname NOT LIKE 'pg\_%';

CREATE TEMP TABLE seed(nm text COLLATE "C");
INSERT INTO seed VALUES
