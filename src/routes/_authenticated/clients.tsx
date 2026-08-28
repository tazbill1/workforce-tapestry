import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Building2, Image as ImageIcon, Loader2, Trash2, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  createClient,
  grantClientAccess,
  listClientsAdmin,
  revokeClientAccess,
  setClientActive,
  setClientLogo,
} from "@/lib/clients.functions";
import { LOGO_MAX_H, LOGO_MAX_W, resizeLogo } from "@/lib/logo-resize";

export const Route = createFileRoute("/_authenticated/clients")({
  head: () => ({
    meta: [
      { title: "Clients | Client Reporting Console" },
      {
        name: "description",
        content:
          "Add reporting clients and control which analysts, coaches and viewers can see each client's data.",
      },
      { property: "og:title", content: "Clients | Client Reporting Console" },
      {
        property: "og:description",
        content: "Manage client records and per-user client access for the reporting console.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ClientsScreen,
});

function ClientsScreen() {
  const queryClient = useQueryClient();
  const load = useServerFn(listClientsAdmin);
  const add = useServerFn(createClient);
  const toggle = useServerFn(setClientActive);
  const grant = useServerFn(grantClientAccess);
  const revoke = useServerFn(revokeClientAccess);
  const saveLogo = useServerFn(setClientLogo);

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [grantEmail, setGrantEmail] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery({ queryKey: ["clients-admin"], queryFn: () => load() });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["clients-admin"] });

  const addMutation = useMutation({
    mutationFn: (input: { name: string; code: string }) => add({ data: input }),
    onSuccess: () => {
      toast.success("Client added");
      setName("");
      setCode("");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleMutation = useMutation({
    mutationFn: (input: { clientId: string; active: boolean }) => toggle({ data: input }),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const grantMutation = useMutation({
    mutationFn: (input: { clientId: string; email: string }) => grant({ data: input }),
    onSuccess: () => {
      toast.success("Access granted");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revokeMutation = useMutation({
    mutationFn: (input: { grantId: string }) => revoke({ data: input }),
    onSuccess: () => {
      toast.success("Access removed");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const logoMutation = useMutation({
    mutationFn: (input: { clientId: string; logoUrl: string | null }) => saveLogo({ data: input }),
    onSuccess: () => {
      toast.success("Logo saved");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const onLogoFile = async (clientId: string, file: File | undefined) => {
    if (!file) return;
    try {
      const logoUrl = await resizeLogo(file);
      logoMutation.mutate({ clientId, logoUrl });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const isAnalyst = data?.isAnalyst ?? false;

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Building2 className="h-6 w-6" />
          Clients
        </h1>
        <p className="text-sm text-muted-foreground">
          Add a client, then grant users access. Analysts see every client automatically; coaches and
          viewers only see the clients granted here.
        </p>
      </header>

      {isAnalyst && (
        <Card>
          <CardHeader>
            <CardTitle>Add a client</CardTitle>
            <CardDescription>Code is used in storage paths and stays fixed.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                addMutation.mutate({ name, code });
              }}
            >
              <div className="grid gap-1.5">
                <Label htmlFor="client-name">Name</Label>
                <Input
                  id="client-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Werk Auto Michigan"
                  required
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="client-code">Code</Label>
                <Input
                  id="client-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="WEAUTO_MI"
                  required
                />
              </div>
              <Button type="submit" disabled={addMutation.isPending}>
                {addMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add client
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>All clients</CardTitle>
          <CardDescription>
            {isLoading ? "Loading…" : `${data?.clients.length ?? 0} client(s)`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {(data?.clients ?? []).map((client) => {
            const grants = (data?.grants ?? []).filter((g) => g.client_id === client.id);
            return (
              <div key={client.id} className="space-y-3 rounded-lg border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{client.name}</span>
                  <Badge variant="secondary">{client.code}</Badge>
                  <Badge variant={client.active ? "default" : "outline"}>
                    {client.active ? "Active" : "Inactive"}
                  </Badge>
                  {isAnalyst && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto"
                      onClick={() =>
                        toggleMutation.mutate({ clientId: client.id, active: !client.active })
                      }
                    >
                      {client.active ? "Deactivate" : "Reactivate"}
                    </Button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-4 rounded-md border bg-muted/40 p-3">
                  {client.logo_url ? (
                    <img
                      src={client.logo_url}
                      alt={`${client.name} logo`}
                      className="h-12 w-auto max-w-[200px] object-contain"
                    />
                  ) : (
                    <span className="flex h-12 items-center text-sm text-muted-foreground">
                      No logo yet
                    </span>
                  )}
                  {isAnalyst && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Label
                        htmlFor={`logo-${client.id}`}
                        className="cursor-pointer rounded-md border bg-background px-3 py-2 text-sm font-medium hover:bg-accent"
                      >
                        <ImageIcon className="mr-2 inline h-4 w-4" />
                        {client.logo_url ? "Replace logo" : "Upload logo"}
                      </Label>
                      <Input
                        id={`logo-${client.id}`}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          void onLogoFile(client.id, e.target.files?.[0]);
                          e.target.value = "";
                        }}
                      />
                      {client.logo_url && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => logoMutation.mutate({ clientId: client.id, logoUrl: null })}
                        >
                          Remove
                        </Button>
                      )}
                      <span className="text-xs text-muted-foreground">
                        Any size — resized to fit reports (max {LOGO_MAX_W}×{LOGO_MAX_H}px).
                      </span>
                    </div>
                  )}
                </div>

              </div>
            );
          })}
        </CardContent>
      </Card>
    </main>
  );
}
