import "./latam-login-flyer.css";

export function LatamLoginFlyer({ onView }: { onView: () => void }) {
  return (
    <div className="latam-login-flyer">
      <img
        className="latam-login-logo"
        src="/promotions/bitnode-official.png"
        alt="BitNode"
      />
      <span className="latam-login-kicker">PRE-POSICIONAMIENTO LATAM</span>
      <h2>
        Tu esfuerzo te lleva a <strong>Cartagena</strong>
      </h2>
      <p>
        Bootcamp Cartagena · <strong>10 cupos</strong>
      </p>
      <div className="latam-login-target">
        <small>META DE FACTURACIÓN DIRECTA</small>
        <strong>
          15,000 <span>USDT</span>
        </strong>
      </div>
      <div className="latam-login-prizes">
        <img
          src="/promotions/iphone-reference.png"
          alt="Teléfonos de referencia para la promoción"
        />
        <div>
          <p>
            <strong>Desde 10,000 y menos de 15,000 USDT</strong>
            <br />
            Participa en el sorteo de 3 iPhone 18 Pro
          </p>
          <p>
            <strong>15,000 USDT · Primeros 10 socios</strong>
            <br />
            Solo viaje al Bootcamp Cartagena · sin iPhone
          </p>
        </div>
      </div>
      <small className="latam-login-reference">
        Imagen de referencia; no representa una especificación oficial del
        modelo.
      </small>
      <p className="latam-login-dates">
        16 de octubre — 25 de noviembre de 2026
        <br />
        Hora de Ciudad de México
      </p>
      <small>
        Solo inversiones nuevas elegibles de referidos directos; no cuentan
        reinversiones, bonos binarios ni operaciones canceladas o revertidas.
      </small>
      <button type="button" onClick={onView}>
        Ver progreso y premios <span aria-hidden="true">→</span>
      </button>
      <small>
        No se acumulan ambos premios. Participación en el sorteo sujeta al rango
        al cierre; sorteo pendiente de realizarse y verificación final.
      </small>
    </div>
  );
}
