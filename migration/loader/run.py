"""CLI del cargador del legado a v9.

Uso:

    python -m migration.loader.run                  # todas las fases, una transacción
    python -m migration.loader.run --only 0         # sólo el staging
    python -m migration.loader.run --from 6 --to 9  # reanudar un tramo
    python -m migration.loader.run --per-phase-commit
    python -m migration.loader.run --verify         # validaciones del plan §7

Por defecto TODO corre en una sola transacción: si una fase falla, la base queda
exactamente como estaba. Con 4 643 filas de origen el costo es despreciable y la
garantía —nunca una carga a medias— vale más.

`--per-phase-commit` existe para depurar una fase concreta: cada fase confirma
por separado y el estado intermedio queda visible.
"""

from __future__ import annotations

import argparse
import asyncio
import importlib
import sys
from pathlib import Path
from time import perf_counter

# Permite tanto `python -m migration.loader.run` como `python migration/loader/run.py`.
REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend import db  # noqa: E402
from migration.loader import legacy, registry  # noqa: E402
from migration.loader.bootstrap import ADMIN_ID, ensure_admin_user  # noqa: E402
from migration.loader.context import LoadContext  # noqa: E402


def _select(args: argparse.Namespace) -> list[int]:
    disponibles = sorted(registry.BY_NUMBER)
    if args.only:
        pedidas = sorted(set(args.only))
        faltan = [n for n in pedidas if n not in registry.BY_NUMBER]
        if faltan:
            raise SystemExit(f"fases inexistentes: {faltan}; válidas: {disponibles}")
        return pedidas
    desde = args.frm if args.frm is not None else disponibles[0]
    hasta = args.to if args.to is not None else disponibles[-1]
    return [n for n in disponibles if desde <= n <= hasta]


def _import_phase(number: int):
    module_name, label = registry.BY_NUMBER[number]
    full = f"migration.loader.phases.{module_name}"
    try:
        return importlib.import_module(full), label
    except ModuleNotFoundError as exc:
        if exc.name == full:
            raise SystemExit(
                f"la fase {number:02d} todavía no está implementada ({full}).\n"
                f"Implementadas: {_implemented()}"
            ) from exc
        raise


def _implemented() -> list[int]:
    listas = []
    for number, module_name, _ in registry.PHASES:
        full = f"migration.loader.phases.{module_name}"
        try:
            importlib.import_module(full)
        except ModuleNotFoundError as exc:
            if exc.name == full:
                continue
            raise
        listas.append(number)
    return listas


def _mask(dsn: str) -> str:
    """Oculta la contraseña antes de imprimir el DSN."""
    if "@" not in dsn:
        return dsn
    head, _, tail = dsn.rpartition("@")
    if "://" in head:
        scheme, _, cred = head.partition("://")
        user, _, _ = cred.partition(":")
        return f"{scheme}://{user}:***@{tail}"
    return f"***@{tail}"


async def _run(args: argparse.Namespace) -> int:
    dsn = db.resolve_dsn(args.dsn)
    hojas = legacy.read_workbook(args.xlsx)
    numeros = _select(args)

    print(f"workbook : {len(hojas)} hojas")
    print(f"base     : {_mask(dsn)}")
    print(f"fases    : {', '.join(f'{n:02d}' for n in numeros)}")
    print(
        f"modo     : {'una transacción' if not args.per_phase_commit else 'commit por fase'}"
    )
    print()

    conn = await db.connect(dsn)
    ctx = LoadContext(conn=conn, admin_id=ADMIN_ID, sheets=hojas)

    try:
        if args.per_phase_commit:
            async with db.session(conn, user_id=ADMIN_ID):
                await ensure_admin_user(conn, ADMIN_ID)
            for number in numeros:
                module, label = _import_phase(number)
                ctx.fase = number
                inicio = perf_counter()
                async with db.session(conn, user_id=ADMIN_ID):
                    await module.run(ctx)
                print(f"  {number:02d} {label:<42} {perf_counter() - inicio:6.2f}s")
        else:
            async with db.session(conn, user_id=ADMIN_ID):
                await ensure_admin_user(conn, ADMIN_ID)
                for number in numeros:
                    module, label = _import_phase(number)
                    ctx.fase = number
                    inicio = perf_counter()
                    await module.run(ctx)
                    print(f"  {number:02d} {label:<42} {perf_counter() - inicio:6.2f}s")
    finally:
        await conn.close()

    _print_summary(ctx)
    return 0


def _print_summary(ctx: LoadContext) -> None:
    print()
    print("=== filas escritas =====================================================")
    if not ctx.counts:
        print("  (ninguna)")
    for tabla in sorted(ctx.counts):
        print(f"  {tabla:<44} {ctx.counts[tabla]:>7}")

    if ctx.conflictos:
        print()
        print(
            "=== conflictos en core.migracion_conflicto ============================="
        )
        for categoria in sorted(ctx.conflictos):
            print(f"  {categoria:<44} {ctx.conflictos[categoria]:>7}")

    print()
    print("listo")


async def _verify(args: argparse.Namespace) -> int:
    try:
        checks = importlib.import_module("migration.loader.checks")
    except ModuleNotFoundError:
        raise SystemExit("migration/loader/checks.py no existe todavía")
    conn = await db.connect(db.resolve_dsn(args.dsn))
    try:
        async with db.session(conn, user_id=ADMIN_ID):
            return await checks.run(conn)
    finally:
        await conn.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m migration.loader.run",
        description="Carga el legado AVISA 2026 en el esquema v9.",
    )
    parser.add_argument("--from", dest="frm", type=int, help="primera fase")
    parser.add_argument("--to", dest="to", type=int, help="última fase")
    parser.add_argument(
        "--only",
        type=int,
        action="append",
        help="fase concreta (repetible)",
    )
    parser.add_argument("--dsn", help="DSN de PostgreSQL (por defecto DATABASE_URL)")
    parser.add_argument("--xlsx", help="workbook del legado")
    parser.add_argument(
        "--per-phase-commit",
        action="store_true",
        help="confirma cada fase por separado (para depurar)",
    )
    parser.add_argument(
        "--verify",
        action="store_true",
        help="ejecuta las validaciones de la carga (plan §7)",
    )
    args = parser.parse_args(argv)

    if args.verify:
        return asyncio.run(_verify(args))
    return asyncio.run(_run(args))


if __name__ == "__main__":
    raise SystemExit(main())
