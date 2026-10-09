# SARA IA: base de conocimiento de soporte

Actualizada el 8 de octubre de 2026. Destino: agente de IA del espacio Bitnode en Crisp. Solo información general; no contiene secretos ni datos de clientes.

## Alcance y límites

El chat de soporte y la suscripción de automatización SARA IA son productos distintos. El chat no consulta cuentas, contratos, saldos ni transacciones en tiempo real y no ejecuta operaciones. Las fuentes locales describen la implementación; no prueban que todas las migraciones estén aplicadas en producción. La pantalla y validación vigente de la cuenta prevalecen para su elegibilidad.

No inventar porcentajes, promociones vigentes, garantías de rentabilidad ni tiempos de respuesta. No dar asesoría personalizada de inversión. Nunca pedir contraseña, OTP, clave privada, seed phrase o claves API. No revelar información de otras cuentas. Transferir a personal cuando el usuario lo pida, haya frustración, falten fuentes fiables o el caso requiera revisar pagos, saldos, acceso o seguridad. No afirmar que se transfirió o resolvió sin confirmación del sistema.

## Temas cargados en Preguntas y respuestas de Crisp

1. **Suscripción SARA IA.** 25 USD, pago en USDT mediante NOWPayments, renovación manual. Cada pago confirmado añade 30 días calendario; si se renueva antes de vencer, la implementación añade el periodo al vencimiento existente. Requiere nodo de 21 días activo. Automatiza las cuatro tareas de lunes a viernes mientras sea elegible. Al vencer o perder elegibilidad, no asumir automatización: realizar tareas manualmente según disponibilidad. Cobro sin activación: revisión humana, no segundo pago.
2. **Nodos y porcentajes.** Nodo Diario flexible; plazos fijos de 7, 14 y 21 días. Pasivo únicamente lunes a viernes, sujeto a requisitos. Mínimo, mitad inferior variable y máximo dependen de política vigente. Mitad inferior: entre mínimo y punto medio. Ejemplos condicionales: 1–1.5% → 1–1.25%; 2–3% → 2–2.5%; 3–4% → 3–3.5%; 4–5% → 4–4.5%. No confirmar política activa ni rendimiento futuro sin evidencia.
3. **Tareas y reinicio.** Habilitación inicial 24 horas después de primera compra de nodo; seguir contador de cuenta, no medianoche ni fecha de registro. Completar cuatro tareas dentro del plazo. Incumplimiento puede reiniciar avance/días y ajustar rendimientos; capital se conserva y puede seguir bloqueado. No prometer ausencia de ajustes al saldo. Recoger fecha/hora/zona horaria, error y captura redactada para revisión humana.
4. **Reinversión y reclamación.** En Mis nodos/Historial, revisar opciones al finalizar ciclo. Reclamar capital no es lo mismo que retiro externo. Promoción del 5% sobre capital elegible: 200 + 10 = 210 USDT de nuevo capital si aplica. No es saldo disponible inmediato. Reinversión promocional no genera comisiones para patrocinador; solo nuevas inversiones elegibles. No asegurar vigencia de campaña. Error al reclamar o bono faltante: revisión humana con ID de nodo.
5. **Depósitos cripto.** Generar orden en Depositar; seguir moneda, red, dirección, importe y vencimiento de esa orden. No reutilizar órdenes/direcciones antiguas ni inventar direcciones en chat. Captura no prueba acreditación. Revisar Historial y hash público. Ante pago ausente, vencido, incompleto o red incorrecta: personal con ID de orden, fecha, red/moneda y hash; no solicitar segundo pago ni garantizar recuperación.
6. **Retiros.** Revisar saldo disponible y origen, no solo total del dashboard. USDT BEP20/BNB Chain hacia wallet registrada. Validación de servidor: 10–1,000 USDT por solicitud y tope de 1,000 USDT solicitados por día, sujeto a reglas vigentes. Fee 5%, mínimo 1 USDT (10 bruto → 1 fee → 9 neto). Reglas publicadas: binario/rango y ROI de plazos fijos, miércoles 8 AM–3 PM Ciudad de México; directa madura 24 horas; ROI Diario no espera miércoles. No trasladar esas ventanas a reclamación de capital. Solicitud pendiente reserva fondos. Elegibilidad real depende del servidor; bloqueos, diferencias, wallet incorrecta o pago no recibido pasan a personal.
7. **Red y comisiones.** Patrocinador directo puede diferir del padre de colocación binaria. Usar Mi red, Centrar raíz y Explorar rama. No ser hijo inmediato no prueba ausencia de patrocinio. Información publicada: directo 10% por nuevas activaciones elegibles; binario 8% sobre nuevo volumen emparejado. Aplican requisitos, incluido nodo activo. No inventar tabla de rangos/topes. Referido ausente/comisión faltante: personal con usernames relevantes y captura redactada; no prometer recolocación.
8. **Soporte técnico y humano.** Recoger sección, error exacto, navegador/dispositivo y momento. Revisar conexión, actualizar página y navegador. En móvil la lista del menú desliza y Cerrar sesión queda al pie. No borrar datos/cerrar sesión sin advertir sobre medios de acceso. Recuperación solo desde acceso oficial. Recursos en Marketing y materiales. Solicitud humana: escalar sin insistir. Fraude/acceso no reconocido: no enviar más fondos y buscar asistencia humana; no afirmar que la cuenta ya fue protegida.

## Fuentes revisadas

- `server/saraIa.ts`: precio, redes de pago admitidas, elegibilidad y estado.
- `supabase/migrations/20261003000934_sara_ia_30_calendar_days.sql`: duración y renovación acumulativa.
- `supabase/migrations/20261002201950_sara_ia_subscription_and_autopilot.sql`: ejecución hábil y habilitación inicial.
- `client/src/pages/Dashboard.tsx`: contador, tareas, promoción y reclamación.
- `client/src/pages/Home.tsx`: reglas publicadas de nodos, bonos y ventanas.
- `server/withdrawals.ts`, `shared/withdrawalFee.ts`: red, límites y fee.
- `client/src/components/SaraSupport.tsx`: chat Crisp separado de automatización, reinicio de sesión al cambiar cuenta.
- `supabase/migrations/20261008165422_reinvestment_no_commissions.sql`: regla de reinversión sin comisiones (su presencia local no prueba aplicación remota).

## Mantenimiento

Actualizar las respuestas en Crisp cuando cambien reglas, campañas o interfaz. No importar indiscriminadamente SQL, logs, documentos antiguos o bases de datos de clientes. `commission-design.md` contiene una descripción narrativa antigua de binario al 10% que contradice su propia tabla del 8% y la interfaz actual: no usar ese párrafo como fuente de entrenamiento. Las vigencias y configuración real requieren comprobación actual; no convertir ejemplos en promesas.
