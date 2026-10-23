# meridies-listas

Listas oficiales de sanciones descargadas cada día laborable por GitHub Actions, para el cotejo de contrapartes de Meridies.

- **Fuentes:** SECO (Suiza), OFAC SDN + alias (EE. UU.), ONU (lista consolidada) y UE (Financial Sanctions Files).
- **Resultado:** rama `data` → `data/entries.json` (nombre, alias, lista, programa) y `data/meta.json` (fecha, recuentos, errores por fuente).
- **Cotejo:** `git clone --depth 1 --branch data https://github.com/PGM-netizen/meridies-listas && node meridies-listas/screen.mjs "Nombre a cotejar"`.
- **Privacidad:** este repositorio solo contiene datos públicos. Los nombres de clientes nunca se suben aquí; el cotejo se hace fuera.
- **Fallos:** si una fuente falla, se conservan sus entradas del día anterior y `meta.json` lo indica.

Una coincidencia es un indicio, no una conclusión: confírmala en la fuente oficial antes de decidir.
