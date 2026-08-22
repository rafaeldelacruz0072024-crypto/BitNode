# Flujo de despliegue GitHub + Vercel

## Repositorio y producción

El repositorio de origen es `rafaeldelacruz0072024-crypto/BitNode`. La rama `main` representa producción y está conectada al proyecto Vercel `bit-node` del equipo Hobby. Cada cambio que llegue a `main` debe pasar pruebas, compilación y revisión antes del merge.

## Desarrollo y previews

Cada funcionalidad nueva debe desarrollarse en una rama con el formato `feature/<nombre-corto>`. Las correcciones deben usar `fix/<nombre-corto>` y las tareas de mantenimiento `chore/<nombre-corto>`. Un push a una rama distinta de `main` debe tratarse como preview de Vercel; la URL de preview debe usarse para revisar rutas, autenticación y variables antes de fusionar.

El flujo recomendado es: crear rama, ejecutar `pnpm test` y `pnpm build`, abrir pull request hacia `main`, revisar el preview de Vercel, comprobar logs y realizar el merge únicamente cuando no haya errores. No se deben guardar archivos `.env`, tokens, claves privadas ni secretos en GitHub.

## Producción y rollback

El despliegue de producción se origina únicamente desde `main`. Antes de fusionar cambios financieros se debe confirmar la migración Supabase correspondiente, revisar la compatibilidad de variables y conservar un checkpoint estable. Si un despliegue falla, primero se debe detener el merge posterior, revisar logs de Vercel y usar el rollback del deployment o revertir el commit problemático en GitHub. Las migraciones de base de datos no se revierten automáticamente: requieren una migración compensatoria revisada.

## Variables de entorno

Las variables deben configurarse en Vercel en los entornos Production, Preview y Development según corresponda, nunca en el repositorio. Las variables `VITE_*` pueden llegar al navegador y solo deben contener valores públicos; secretos como `JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, claves de pagos y secretos IPN deben permanecer exclusivamente server-side. Actualmente el proyecto Vercel `bit-node` no tiene variables de entorno configuradas, por lo que Auth, Supabase server-side y las rutas financieras requieren configuración antes de considerarse operativas.

## Estado verificado

GitHub contiene la estructura extraída del proyecto y el commit `f0a3e1f`. Vercel reconoce el repositorio, tiene un deployment de producción en estado `Ready` y asignó `bit-node.vercel.app`. La configuración actual confirma la conexión `main` → producción; la existencia de previews por ramas debe confirmarse al crear la primera rama `feature/*`.
