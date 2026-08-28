import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Users as UsersIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { listConsoleUsers } from "@/lib/users.functions";

export const Route = createFileRoute("/_authenticated/users")({
  head: () => ({
    meta: [
      { title: "Users | Client Reporting Console" },
      {
        name: "description",
        content:
          "See everyone who can sign in to the reporting console, their role and when they last signed in.",
      },
      { property: "og:title", content: "Users | Client Reporting Console" },
      {
        property: "og:description",
        content: "Directory of console users with roles and last sign-in times.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: UsersScreen,
});

function relative(iso: string | null) {
  if (!iso) return "Never";
  const diff = Date.now() - Date.parse(iso);
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function UsersScreen() {
  const load = useServerFn(listConsoleUsers);
  const { data, isLoading } = useQuery({ queryKey: ["console-users"], queryFn: () => load() });

  const users = data?.users ?? [];

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <UsersIcon className="h-6 w-6" />
          Users
        </h1>
        <p className="text-sm text-muted-foreground">
          Everyone with an account. All signed-in users can currently see every client — accounts are
          created automatically the first time someone signs in with a @werkandme.com Google account.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>All users</CardTitle>
          <CardDescription>
            {isLoading
              ? "Loading…"
              : data?.isAnalyst === false
                ? "Analyst role required to view the user directory."
                : `${users.length} account(s)`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead className="w-32">Role</TableHead>
                <TableHead className="w-40">Last sign-in</TableHead>
                <TableHead className="w-32 text-right">Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!isLoading && users.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">
                    No accounts to show.
                  </TableCell>
                </TableRow>
              )}
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.email}</TableCell>
                  <TableCell>
                    {u.roles.length === 0 ? (
                      <Badge variant="outline">No role</Badge>
                    ) : (
                      u.roles.map((r) => (
                        <Badge key={r} variant="secondary" className="mr-1 capitalize">
                          {r}
                        </Badge>
                      ))
                    )}
                  </TableCell>
                  <TableCell>
                    <span className={u.lastSignInAt ? "" : "text-muted-foreground"}>
                      {relative(u.lastSignInAt)}
                    </span>
                    {u.lastSignInAt && (
                      <div className="text-xs text-muted-foreground">
                        {new Date(u.lastSignInAt).toLocaleString()}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </main>
  );
}
