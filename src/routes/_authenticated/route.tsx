import { createFileRoute, Outlet, redirect, Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { ensureDomainAccess } from "@/lib/access.functions";
import { FileSpreadsheet, GitMerge, BarChart3, FileText, LogOut, Building2, Sparkles, Users } from "lucide-react";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });

    const access = await ensureDomainAccess();
    if (!access.allowed) {
      await supabase.auth.signOut();
      sessionStorage.setItem(
        "auth_denied_email",
        access.email,
      );
      sessionStorage.setItem(
        "auth_denied",
        `Only @${access.domain} email addresses can access this console.`,
      );
      throw redirect({ to: "/auth" });
    }

    return { user: data.user };
  },
  component: AuthenticatedLayout,
});

const navItems = [
  { to: "/imports", label: "Imports", icon: FileSpreadsheet },
  { to: "/assembly", label: "Assembly", icon: GitMerge },
  { to: "/decisions", label: "Decisions", icon: GitMerge },
  { to: "/metrics", label: "Metrics", icon: BarChart3 },
  { to: "/report", label: "Report", icon: FileText },
  { to: "/ask", label: "Ask", icon: Sparkles },
  { to: "/clients", label: "Clients", icon: Building2 },
  { to: "/users", label: "Users", icon: Users },
];


function AuthenticatedLayout() {
  return (
    <div className="min-h-screen bg-background">
      <nav className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="flex h-14 items-center gap-2 px-4">
          <span className="mr-4 text-sm font-semibold tracking-tight">Client Reporting Console</span>
          {navItems.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              activeProps={{ className: "bg-accent text-foreground" }}
              inactiveProps={{ className: "text-muted-foreground hover:bg-accent hover:text-foreground" }}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          ))}
          <div className="ml-auto">
            <button
              type="button"
              onClick={() => supabase.auth.signOut()}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </div>
      </nav>
      <Outlet />
    </div>
  );
}
