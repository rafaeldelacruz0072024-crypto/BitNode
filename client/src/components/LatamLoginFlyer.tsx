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
            <strong>Primeros 3 socios</strong>
            <br />
            Un iPhone 18 Pro Max cada uno + viaje
          </p>
          <p>
            <strong>Siguientes 7 socios</strong>
            <br />
            Viaje al Bootcamp Cartagena
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
      <small>Clasificación y entrega sujetas a verificación final.</small>
    </div>
  );
}
