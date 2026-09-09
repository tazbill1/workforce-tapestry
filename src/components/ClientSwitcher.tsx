import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Building2, Check, ChevronDown } from "lucide-react";

import { listMyClients } from "@/lib/imports.functions";
import { useActiveClient } from "@/lib/active-client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Always-visible reminder of whose data is on screen, and the one place to switch.
 */
export function ClientSwitcher() {
  const listFn = useServerFn(listMyClients);
  const { clientId, setClientId } = useActiveClient();
  const clients = useQuery({ queryKey: ["clients"], queryFn: () => listFn() });

  const active = (clients.data ?? []).find((c) => c.id === clientId) ?? null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={active ? "secondary" : "outline"}
          size="sm"
          className="h-9 max-w-[19rem] gap-2 border"
        >
          {active?.logo_url ? (
            <img src={active.logo_url} alt="" className="h-5 w-auto max-w-[3.5rem] object-contain" />
          ) : (
            <Building2 className="h-4 w-4 shrink-0" />
          )}
          <span className="truncate font-semibold">
            {active ? active.name : "No client selected"}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Working on</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {(clients.data ?? []).map((client) => (
          <DropdownMenuItem key={client.id} onSelect={() => setClientId(client.id)}>
            <div className="flex min-w-0 flex-col">
              <span className="truncate">
                {client.name}{" "}
                <span className="text-muted-foreground">({client.code})</span>
              </span>
              {(client as { expected_domains?: string[] }).expected_domains?.length ? (
                <span className="truncate text-xs text-muted-foreground">
                  {(client as { expected_domains?: string[] }).expected_domains!.join(", ")}
                </span>
              ) : null}
            </div>
            {client.id === clientId ? <Check className="ml-auto h-4 w-4 shrink-0" /> : null}
          </DropdownMenuItem>
        ))}
        {clients.data?.length === 0 ? (
          <DropdownMenuItem disabled>No clients yet</DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
