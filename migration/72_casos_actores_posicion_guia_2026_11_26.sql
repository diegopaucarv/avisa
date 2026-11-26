-- =============================================================================
-- 72 · Posicionamiento del actor en el caso según la Guía (§8.2.4)
--
-- Fecha: 2026-11-26
--
-- Por qué
-- -------
-- La interfaz pasó a usar el vocabulario de la Guía para el posicionamiento del
-- actor —`Dialogante`, `Legitimante`, `Conflictivo`—, que es el mismo de
-- `core.cat_perfiles_actor` y de la ficha del directorio. La tabla
-- `core.casos_actores.posicion` seguía atada al vocabulario heredado
-- (`Apoyo`, `Oposicion`, `Neutral`, `No_dialogante`) por el CHECK
-- `casos_actores_posicion_check`.
--
-- Qué hace
-- --------
-- **Amplía** el dominio del CHECK: admite los tres valores nuevos y sigue
-- admitiendo los cuatro antiguos como **legado**. No convierte ni borra datos:
-- las filas históricas conservan su valor y la lectura los sigue pintando.
--
-- No se hace `DROP COLUMN` ni `UPDATE`: solo se cambia la restricción.
--
-- Nota sobre la regla «solo columnas nuevas»
-- ------------------------------------------
-- Es la única excepción del lote: una restricción no se puede «agregar» sin
-- retirar la anterior, porque dos CHECK sobre la misma columna se acumulan y el
-- antiguo seguiría rechazando los valores nuevos. Se retira únicamente la
-- restricción, nunca un dato.
--
-- Requiere, en el mismo despliegue, el mapa `POSICIONES` de
-- `lib/db/repos/cases.ts` aceptando ambos vocabularios (tarea 4.6). Como el
-- CHECK solo se amplía, aplicarlo antes del código no rompe nada.
--
-- Idempotente: puede reejecutarse sin efectos.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'core.casos_actores'::regclass
       AND conname = 'casos_actores_posicion_guia_check'
  ) THEN
    ALTER TABLE core.casos_actores
      ADD CONSTRAINT casos_actores_posicion_guia_check
      CHECK (
        posicion IS NULL
        OR posicion IN (
          -- Guía §8.2.4: el vocabulario que usa la interfaz.
          'Dialogante', 'Legitimante', 'Conflictivo',
          -- Legado: se conserva para no invalidar las filas históricas.
          'Apoyo', 'Oposicion', 'Neutral', 'No_dialogante'
        )
      );
  END IF;

  -- Se retira el CHECK anterior solo si el nuevo ya existe: si el `ADD` anterior
  -- falló, la tabla queda como estaba en vez de descubrir el dominio.
  IF EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'core.casos_actores'::regclass
       AND conname = 'casos_actores_posicion_check'
  ) AND EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'core.casos_actores'::regclass
       AND conname = 'casos_actores_posicion_guia_check'
  ) THEN
    ALTER TABLE core.casos_actores
      DROP CONSTRAINT casos_actores_posicion_check;
  END IF;
END
$$;

COMMENT ON CONSTRAINT casos_actores_posicion_guia_check ON core.casos_actores IS
  'Posicionamiento del actor en el caso: vocabulario de la Guía §8.2.4, con los valores heredados admitidos como legado.';
