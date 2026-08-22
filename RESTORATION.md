# Restauración de BitNode

## Estado restaurado

El proyecto fue restaurado al commit estable `63ff3a1`, correspondiente a la réplica pública de BitNode inmediatamente anterior a la incorporación del dashboard interno administrativo. El rollback administrado generó la versión `8f642960` del proyecto local.

La restauración no ejecutó SQL ni modificó tablas, políticas RLS, usuarios, perfiles, transacciones, contratos o registros de Supabase. Los datos remotos permanecen fuera del rollback de código.

## Qué conserva este estado

La landing pública conserva la navegación por contratos, programa de red, actividad de la granja, FAQ, CTA de registro, diseño oscuro editorial, marca BitNode y comportamiento responsive. La compilación TypeScript (`pnpm check`) y el build de producción (`pnpm build`) finalizaron correctamente. La landing fue verificada visualmente en el preview local.

## Qué fue retirado

Este estado no incluye las rutas `/dashboard` ni `/dashboard/:section`, el sidebar del usuario, autenticación Supabase, historial remoto, retiros protegidos, activación de contratos, ledger de comisiones, motor directo/binario ni el bundle serverless desarrollado posteriormente para Vercel. La ruta `/dashboard` fue verificada y devuelve 404, como corresponde al estado anterior al dashboard interno.

El proyecto restaurado tampoco contiene un script `test` en `package.json`; por ello no se declara una suite Vitest ejecutada en este estado. La validación disponible y ejecutada es `pnpm check` más `pnpm build`, junto con la verificación manual de la landing y de la ruta inexistente del dashboard.

## Recuperación futura

Si se desea recuperar autenticación, dashboard, comisiones o despliegue serverless, deben reintroducirse desde los checkpoints posteriores de forma selectiva, sin restaurar el panel administrativo completo por accidente. Los checkpoints posteriores permanecen disponibles para una recuperación parcial o una comparación.
