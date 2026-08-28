import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Users as UsersIcon, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { listConsoleUsers, setUserRole, deleteConsoleUser } from "@/lib/users.functions";

export const Route = createFileRoute("/_authenticated/users")({
  head: () => ({
    meta: [
      { title: "Users | Client Reporting Console" },
      {
        name: "description",
        content:
          "See everyone who can sign in to the reporting console, set their role and remove accounts.",
      },
      { property: "og:title", content: "Users | Client Reporting Console" },
      {
        property: "og:description",
        content: "Directory of console users with roles, last sign-in times and access controls.",
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

const ROLE_HELP: Record<string, string> = {
  analyst: "Full access — can import, decide, publish and manage users.",
  coach: "Can view and enter manual content, but not manage users.",
  viewer: "Read-only access to reports and metrics.",
  none: "No role — signed in but cannot write anything.",
};

function UsersScreen() {
  const queryClient = useQueryClient();
  const load = useServerFn(listConsoleUsers);
  const changeRole = useServerFn(setUserRole);
  const removeUser = useServerFn(deleteConsoleUser);

  const [pendingDelete, setPendingDelete] = useState<{ id: string; email: string } | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ["console-users"], queryFn: () => load() });

  const roleMutation = useMutation({
    mutationFn: (vars: { userId: string; role: string | null }) => changeRole({ data: vars }),
    onSuccess: () => {
      toast.success("Role updated");
      queryClient.invalidateQueries({ queryKey: ["console-users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (userId: string) => removeUser({ data: { userId } }),
    onSuccess: () => {
      toast.success("Account removed");
      setPendingDelete(null);
      queryClient.invalidateQueries({ queryKey: ["console-users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const users = data?.users ?? [];
  const canManage = data?.isAnalyst === true;

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
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
              : !canManage
                ? "Analyst role required to view the user directory."
                : `${users.length} account(s). Changing a role takes effect on their next request.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead className="w-44">Role</TableHead>
                <TableHead className="w-40">Last sign-in</TableHead>
                <TableHead className="w-28 text-right">Joined</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {!isLoading && users.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    No accounts to show.
                  </TableCell>
                </TableRow>
              )}
              {users.map((u) => {
                const current = u.roles[0] ?? "none";
                const isSelf = u.id === data?.currentUserId;
                return (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">
                      {u.email}
                      {isSelf && (
                        <Badge variant="outline" className="ml-2">
                          You
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={current}
                        disabled={!canManage || roleMutation.isPending}
                        onValueChange={(value) =>
                          roleMutation.mutate({
                            userId: u.id,
                            role: value === "none" ? null : value,
                          })
                        }
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="analyst">Analyst</SelectItem>
                          <SelectItem value="coach">Coach</SelectItem>
                          <SelectItem value="viewer">Viewer</SelectItem>
                          <SelectItem value="none">No role</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="mt-1 text-xs text-muted-foreground">{ROLE_HELP[current]}</p>
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
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={!canManage || isSelf}
                        title={isSelf ? "You cannot remove your own account" : "Remove account"}
                        onClick={() => setPendingDelete({ id: u.id, email: u.email })}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {pendingDelete?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              Their account and role are deleted, and they lose access immediately. Anything they
              previously imported or published stays in place. If they sign in again with a
              @werkandme.com Google account, a fresh account is created.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={() => pendingDelete && deleteMutation.mutate(pendingDelete.id)}
            >
              Remove account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
