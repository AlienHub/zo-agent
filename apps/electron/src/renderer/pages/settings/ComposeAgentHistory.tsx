import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { History, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useSetAtom } from "jotai";
import { replaceLoadedSessionAtom } from "@/atoms/sessions";
import { useNavigation } from "@/contexts/NavigationContext";
import { routes } from "@/lib/navigate";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ComposeAgent } from "@craft-agent/shared/agent-compose/types";
import type { ComposeHistoryItem } from "@craft-agent/shared/agent-compose/history";

export function ComposeAgentHistory({ agent, workspaceId, disabled }: {
  agent: ComposeAgent; workspaceId: string | null; disabled?: boolean;
}) {
  const { t } = useTranslation();
  const { navigate } = useNavigation();
  const replaceSession = useSetAtom(replaceLoadedSessionAtom);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ComposeHistoryItem[]>([]);
  const [nextOffset, setNextOffset] = useState<number>();
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState<string>();
  const [error, setError] = useState("");
  const generation = useRef(0);
  const label = (key: string) => t(`settings.agentCompose.history.${key}`);
  const load = useCallback(async (offset = 0) => {
    const requestGeneration = ++generation.current;
    setLoading(true); setError("");
    try {
      const result = await window.electronAPI.agentCompose({ action: "history", offset,
        binding: { nodeId: agent.nodeId, projectId: agent.projectId, agentName: agent.agentName } });
      if (generation.current !== requestGeneration) return;
      if (!result.history) throw new Error(t("settings.agentCompose.history.loadError"));
      const page = result.history;
      setItems((previous) => {
        const groups = new Map((offset ? previous : []).map((item) => [item.key, item]));
        for (const item of page.items) {
          const existing = groups.get(item.key);
          groups.set(item.key, existing ? { ...existing,
            runIds: [...new Set([...existing.runIds, ...item.runIds])], active: existing.active || item.active,
            updatedAt: Math.max(existing.updatedAt, item.updatedAt) } : item);
        }
        return [...groups.values()].sort((a, b) => b.updatedAt - a.updatedAt);
      });
      setNextOffset(page.nextOffset);
    } catch (e) { if (generation.current === requestGeneration) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (generation.current === requestGeneration) setLoading(false); }
  }, [agent.nodeId, agent.projectId, agent.agentName, t]);
  useEffect(() => {
    if (open) void load();
    return () => { generation.current++; };
  }, [open, load]);
  const importItem = async (item: ComposeHistoryItem) => {
    if (!workspaceId || importing) return;
    setImporting(item.key); setError("");
    try {
      const result = await window.electronAPI.agentCompose({ action: "importHistory", workspaceId,
        binding: { nodeId: agent.nodeId, projectId: agent.projectId, agentName: agent.agentName }, target: item.target });
      if (!result.importedHistory) throw new Error(label("importError"));
      // The created-event hydrate is asynchronous. Register the returned session
      // before navigating, otherwise list auto-selection may select an old chat.
      const session = await window.electronAPI.getSessionMessages(result.importedHistory.sessionId);
      if (!session) throw new Error(label("importError"));
      replaceSession(session);
      if (result.importedHistory.warnings.length) toast.info(label("partialDetails"));
      setOpen(false);
      void navigate(routes.view.allSessions(result.importedHistory.sessionId));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setImporting(undefined); }
  };
  return <>
    <IconButton aria-label={`${label("title")} · ${agent.name}`} disabled={disabled || !workspaceId}
      icon={<History className="size-3.5" />} onClick={() => setOpen(true)} />
    <Dialog open={open} onOpenChange={(value) => { if (!importing) setOpen(value); }}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{label("title")} · {agent.name}</DialogTitle>
          <DialogDescription>{label("description")}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between gap-3">
          <p className="text-label-sm text-tertiary">{label("grouping")}</p>
          <IconButton aria-label={label("refresh")} disabled={loading || !!importing} onClick={() => void load()}
            icon={<RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />} />
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="min-h-0 overflow-y-auto rounded-xl border border-border">
          {!items.length && <p role="status" className="px-4 py-8 text-center text-sm text-secondary">{label(loading ? "loading" : "empty")}</p>}
          {items.map((item) => <div key={item.key} className="flex min-w-0 items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm" title={item.title}>{item.title}</p>
              <p className="mt-1 text-label-sm text-tertiary">
                {item.updatedAt ? new Date(item.updatedAt).toLocaleString() : "—"}
                {" · "}{t("settings.agentCompose.history.runCount", { count: item.runIds.length })}
                {item.active && <> · {label("running")}</>}
              </p>
            </div>
            <Button size="sm" variant="outline" disabled={!!importing || item.active} onClick={() => void importItem(item)}>
              {label(importing === item.key ? "importing" : "open")}
            </Button>
          </div>)}
        </div>
        {nextOffset !== undefined && <Button variant="ghost" disabled={loading || !!importing} onClick={() => void load(nextOffset)}>{label(loading ? "loading" : "loadMore")}</Button>}
      </DialogContent>
    </Dialog>
  </>;
}
