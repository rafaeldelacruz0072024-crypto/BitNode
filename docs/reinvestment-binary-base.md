# Reinversión: solo binario sobre capital base

Regla solicitada el 20 de octubre de 2026:

- Capital reinvertido registrado en `finite_node_capital_choices.amount`: volumen binario.
- Capital promocional añadido en esta reinversión (5%): sin volumen ni comisión.
- Comisión directa de reinversión: cero. Las inversiones nuevas mantienen la regla vigente.
- Emparejamiento binario: se conserva el motor del 8%, nodo activo y exclusión corporativa.
- Ejemplo: base 200 + bono 10 = nodo 210; suma 200 puntos, no 210; un emparejamiento nuevo de 200 genera 16 al beneficiario elegible, nunca 20 de comisión directa.
- No se ejecuta backfill ni se recalculan operaciones históricas.

La migración `20261020155501_reinvestment_binary_base_only.sql` cambia la RPC conservando sus validaciones y añade un trigger AFTER INSERT a la elección de reinversión. Ambos caminos usan `REINVEST-BINARY-<new_contract_id>` como identidad canónica para evitar duplicar volumen al reintentar. Un identificador de reinversión sin base verificable falla de forma segura.

El importe de la elección es la base **de esta operación**, no el importe del nuevo contrato ya aumentado por el bono. No se alteran saldos, el bono del nodo ni la elegibilidad LATAM.

Prueba aislada: `node scripts/test-reinvestment-binary-base-sql.mjs <pglite-module-path>`.

Instalación verificada en producción el 20 de octubre de 2026: motor v2, base autoritativa, exclusión directa, identidad canónica, trigger binario habilitado y trigger del bono conservado. No se ejecutaron reinversiones de prueba ni backfill con fondos reales. Las pruebas de cálculo y reintentos se ejecutaron en PostgreSQL aislado.
