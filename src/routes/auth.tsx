import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { ALLOWED_EMAIL_DOMAIN } from "@/lib/access.functions";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in | Client Reporting Console" },
      {
        name: "description",
        content:
          "Sign in to the internal client reporting console to upload rosters and review period-over-period changes.",
      },
      { property: "og:title", content: "Sign in | Client Reporting Console" },
      {
        property: "og:description",
        content: "Internal reporting console for multi-client roster imports and analysis.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [busy, setBusy] = useState(false);
  const [deniedMessage, setDeniedMessage] = useState<string | null>(null);
  const [deniedEmail, setDeniedEmail] = useState<string | null>(null);

  useEffect(() => {
    const denied = sessionStorage.getItem("auth_denied");
    const deniedEmailStored = sessionStorage.getItem("auth_denied_email");
    if (denied) {
      sessionStorage.removeItem("auth_denied");
      sessionStorage.removeItem("auth_denied_email");
      setDeniedMessage(denied);
      setDeniedEmail(deniedEmailStored);
      toast.error(denied);
    }
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/imports" });
    });
  }, [navigate]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (mode === "signup" && !normalized.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`)) {
      setDeniedMessage(`Only @${ALLOWED_EMAIL_DOMAIN} email addresses can sign up.`);
      setDeniedEmail(normalized);
      toast.error(`Only @${ALLOWED_EMAIL_DOMAIN} email addresses can sign up.`);
      return;
    }
    setBusy(true);
    const { error } =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email: normalized, password })
        : await supabase.auth.signUp({
            email: normalized,
            password,
            options: { emailRedirectTo: `${window.location.origin}/auth` },
          });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (mode === "signup") {
      toast.success("Check your email to confirm your account, then sign in.");
      setMode("signin");
      return;
    }
    navigate({ to: "/imports" });
  };

  const signInWithGoogle = async () => {
    setBusy(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      setBusy(false);
      toast.error(result.error.message ?? "Google sign-in failed.");
      return;
    }
    if (result.redirected) return;
    navigate({ to: "/imports" });
  };



  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Client Reporting Console</CardTitle>
          <CardDescription>
            Internal access for the @{ALLOWED_EMAIL_DOMAIN} team. Sign in with Google or create an
            account with your work email.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {deniedMessage && (
            <Alert variant="destructive">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>Access blocked</AlertTitle>
              <AlertDescription className="space-y-1">
                <p>{deniedMessage}</p>
                {deniedEmail && (
                  <p className="text-xs opacity-90">
                    You tried: <span className="font-medium">{deniedEmail}</span>
                  </p>
                )}
                <p className="text-xs opacity-90">
                  Please sign in with your <span className="font-medium">@{ALLOWED_EMAIL_DOMAIN}</span>{" "}
                  work email, or ask an admin to invite you.
                </p>
              </AlertDescription>
            </Alert>
          )}
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Work email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder={`you@${ALLOWED_EMAIL_DOMAIN}`}
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy
                ? mode === "signin"
                  ? "Signing in…"
                  : "Creating account…"
                : mode === "signin"
                  ? "Sign in"
                  : "Create account"}
            </Button>
          </form>
          <button
            type="button"
            className="mt-3 w-full text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          >
            {mode === "signin"
              ? `New here? Create an account with your @${ALLOWED_EMAIL_DOMAIN} email`
              : "Already have an account? Sign in"}
          </button>

          <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={busy}
            onClick={signInWithGoogle}
          >
            Continue with Google
          </Button>
        </CardContent>

      </Card>
    </main>
  );
}
