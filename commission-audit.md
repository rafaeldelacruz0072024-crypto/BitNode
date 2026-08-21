# Auditoría de comisiones de red

## Resultado

La aplicación muestra dos porcentajes de referencia en la landing pública: **bono de inicio rápido/directo del 10%** y **bono binario del 10%**. Estos valores aparecen en el contenido visual de `client/src/pages/Home.tsx`; no provienen de una tabla de configuración ni de una función de cálculo.

## Directo o inicio rápido

La interfaz describe la regla como: cuando un referido directo activa un contrato, el usuario recibe el 10% del monto. La fórmula ilustrativa es:

`bono directo = monto del contrato del referido directo × 0.10`

El ejemplo visible usa $1,000 y muestra un bono de $100. Este ejemplo es copy/UI, no una operación ejecutable.

## Binario

La interfaz describe dos piernas y empareja el volumen menor. La fórmula ilustrativa es:

`volumen emparejado = mínimo(volumen pierna A, volumen pierna B)`

`bono binario = volumen emparejado × 0.10`

El ejemplo visible usa $5,000 en una pierna y $3,000 en la otra, empareja $3,000 y muestra un bono de $300. Tampoco existe una función que genere este cálculo.

## Estado actual del código

`client/src/lib/localUserStore.ts` solo almacena los campos `quickBonus`, `binaryBonus` y `rankBonus`, inicializados en cero. `Dashboard.tsx` los presenta en las tarjetas Inicio rápido, Binario y Rangos, y suma sus valores para mostrar bonos acumulados en Mi red. La activación de contratos únicamente descuenta el mínimo del balance, crea el contrato local y registra un movimiento; no recorre la red, no calcula comisiones y no acredita ningún bono.

No hay actualmente tablas Supabase específicas para relaciones de red, piernas binarias, eventos de comisión o liquidaciones. Las transacciones existentes registran depósitos, retiros, contratos y rendimiento, pero no existe persistencia remota específica para comisiones directas o binarias.

## Pendientes para una implementación real

Antes de activar estas comisiones habría que definir reglas de elegibilidad, usuario patrocinador, estructura izquierda/derecha, volumen válido, límites, frecuencia de liquidación, reversos, auditoría y políticas RLS. El cálculo debe ejecutarse server-side y registrar cada comisión como evento inmutable; no debe depender del estado local del navegador ni de valores enviados por el cliente.
