# NOWPayments: decisiones de integración

## Fuentes consultadas

- https://nowpayments.io/api
- https://nowpayments.io/help/what-is/what-is-ipn
- https://nowpayments.zendesk.com/hc/en-us/articles/21395546303389-IPN-and-how-to-setup
- https://documenter.getpostman.com/view/7907941/2s93JusNJt#4391e27f-1c54-499f-8623-36c7cd322542

## Decisiones técnicas

NOWPayments ofrece un entorno de sandbox para probar la integración. El flujo de depósito recomendado es: comprobar disponibilidad, seleccionar divisa, obtener mínimo/estimación y crear el pago o invoice desde el servidor; la interfaz muestra la dirección o URL de pago y el estado se actualiza mediante IPN o consulta de estado.

La API key debe permanecer en el servidor. Los callbacks IPN llegan por POST a una URL pública y contienen el header `x-nowpayments-sig`. La firma debe verificarse con HMAC-SHA512 sobre el JSON ordenado por claves, usando el IPN secret. El endpoint no puede depender de login de navegador ni de localhost y debe responder rápidamente.

Para BitNode se usará inicialmente el flujo de invoice: el servidor crea el invoice con `price_amount`, `price_currency`, `pay_currency`, `order_id`, `order_description`, `ipn_callback_url` y `success_url`; el cliente redirige al usuario a la URL devuelta. Los estados remotos se reflejarán en la tabla local de transacciones después de validar la firma IPN.

Los retiros reales se mantendrán separados de los depósitos: requieren wallet, red, monto bruto, comisión, neto, límite diario, estado auditable y posterior integración con el API de payouts. Ningún saldo se acreditará únicamente por una redirección del navegador; se requerirá estado confirmado por callback o consulta verificada.
