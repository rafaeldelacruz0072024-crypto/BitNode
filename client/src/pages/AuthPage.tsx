import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, Loader2, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { BrandMark } from "@/components/BrandMark";

export default function AuthPage() {
  const [, navigate] = useLocation();
  const referral = useMemo(() => {
    const match = window.location.pathname.match(
      /^\/r\/([^/]+)\/(izquierda|derecha)\/?$/i
    );
    if (!match) return null;
    return {
      code: decodeURIComponent(match[1]),
      side: match[2].toLowerCase() as "izquierda" | "derecha",
      leg: match[2].toLowerCase() === "izquierda" ? "left" : "right",
    };
  }, []);
  const [mode, setMode] = useState<"login" | "signup">(
    referral ? "signup" : "login"
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("gentecash");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const referralApplied = useRef(false);

  const applyReferral = async (userId: string, profileName: string) => {
    if (!supabase || !referral || referralApplied.current) return;
    referralApplied.current = true;
    const { error: profileError } = await supabase.rpc("create_profile", {
      p_username: profileName.trim() || "usuario",
      p_referral_code: null,
      p_sponsor_referral_code: referral.code,
    });
    if (profileError) {
      referralApplied.current = false;
      throw profileError;
    }
    const { error: placementError } = await supabase.rpc("place_network_node", {
      p_user_id: userId,
      p_sponsor_id: null,
      p_preferred_leg: referral.leg,
    });
    if (placementError) {
      referralApplied.current = false;
      throw placementError;
    }
  };

  useEffect(() => {
    if (!referral || !supabase) return;
    supabase.auth.getSession().then(async ({ data }) => {
      const session = data.session;
      if (!session) return;
      try {
        await applyReferral(
          session.user.id,
          String(session.user.user_metadata?.username || username)
        );
        navigate("/dashboard/network");
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "No se pudo registrar la posición binaria."
        );
      }
    });
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!supabase)
      return setError("El servicio de acceso no está disponible en este entorno.");
    if (!email.trim() || !email.includes("@"))
      return setError("Introduce un correo válido.");
    if (password.length < 8)
      return setError("La contraseña debe tener al menos 8 caracteres.");
    setLoading(true);
    const result =
      mode === "login"
        ? await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
          })
        : await supabase.auth.signUp({
            email: email.trim(),
            password,
            options: {
              data: {
                username: username.trim() || "usuario",
                sponsor_referral_code: referral?.code,
                preferred_leg: referral?.leg,
              },
              emailRedirectTo: referral ? window.location.href : undefined,
            },
          });
    setLoading(false);
    if (result.error) return setError(result.error.message);
    if (mode === "signup" && !result.data.session) {
      setMessage(
        `Cuenta creada. Confirma tu correo para completar la posición ${referral?.side || "binaria"}.`
      );
      return;
    }
    if (referral && result.data.user) {
      try {
        await applyReferral(result.data.user.id, username);
      } catch (cause) {
        return setError(
          cause instanceof Error
            ? cause.message
            : "No se pudo registrar la posición binaria."
        );
      }
    }
    navigate("/dashboard");
  };

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <Link className="auth-brand" href="/" aria-label="BitNode inicio">
          <BrandMark className="brand-mark" />
        </Link>
        <div className="auth-kicker">
          <ShieldCheck size={15} /> ACCESO SEGURO
        </div>
        <h1>{mode === "login" ? "Entra a tu panel." : "Crea tu cuenta."}</h1>
        <p>
          {referral
            ? `Invitación de ${referral.code} · Pierna ${referral.side}.`
            : mode === "login"
              ? "Accede a tus nodos, balances y movimientos verificados."
              : "Tu cuenta quedará vinculada a un usuario autenticado."}
        </p>
        <form onSubmit={submit} noValidate>
          {mode === "signup" && (
            <label>
              Usuario
              <input
                value={username}
                onChange={event => setUsername(event.target.value)}
                autoComplete="username"
              />
            </label>
          )}
          <label>
            Correo electrónico
            <input
              type="email"
              value={email}
              onChange={event => setEmail(event.target.value)}
              autoComplete="email"
            />
          </label>
          <label>
            Contraseña
            <input
              type="password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
            />
          </label>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          {message && (
            <div className="form-success" role="status">
              {message}
            </div>
          )}
          <button className="dash-primary auth-submit" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="spin" size={16} /> Procesando
              </>
            ) : (
              <>
                {mode === "login" ? "Iniciar sesión" : "Crear cuenta"}{" "}
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>
        <button
          className="auth-switch"
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login");
            setError("");
            setMessage("");
          }}
        >
          {mode === "login"
            ? "¿No tienes cuenta? Crear una"
            : "¿Ya tienes cuenta? Iniciar sesión"}
        </button>
        <Link className="auth-back" href="/">
          ← Volver a BitNode
        </Link>
      </section>
    </main>
  );
}
